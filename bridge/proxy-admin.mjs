import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { parseYaml, stringifyYaml } from './lib.mjs';

const execFileAsync = promisify(execFile);
const proxyBin =
  process.env.VEY_PROXY_BIN ??
  new URL('../../vey/target/release-lto/vey-proxy', import.meta.url).pathname;
const proxyCtl =
  process.env.VEY_PROXY_CTL ??
  new URL('../../vey/target/release-lto/vey-proxy-ctl', import.meta.url)
    .pathname;
const configFile =
  process.env.VEY_PROXY_CONFIG ?? '/tmp/vey-proxy-console/main.yaml';
const controlDir =
  process.env.VEY_PROXY_CONTROL_DIR ?? '/tmp/vey-proxy-console-control';
const usersFile =
  process.env.VEY_PROXY_USERS_FILE ?? '/tmp/vey-proxy-console/users.json';
const settingsFile =
  process.env.VEY_PROXY_SETTINGS_FILE ?? '/tmp/vey-proxy-console/settings.json';
const auditLogFile =
  process.env.VEY_PROXY_AUDIT_LOG ?? '/tmp/vey-proxy-console/audit.log';
const configuredPid = process.env.VEY_PROXY_PID ?? '0';
const daemonGroup = process.env.VEY_PROXY_GROUP ?? '';

const defaults = {
  system: {
    threadNumber: 2,
    serverOfflineDelay: 4,
    controllerRecvTimeout: 30,
    controllerSendTimeout: 1,
    resolverServers: ['1.1.1.1', '8.8.8.8'],
    resolverRequestTimeout: 10,
    resolverTries: 2,
    resolveStrategy: 'Ipv4First',
    noIpv6: true,
  },
  listeners: [
    { name: 'http', type: 'http_proxy', address: '127.0.0.1:13128' },
    {
      name: 'socks',
      type: 'socks_proxy',
      address: '127.0.0.1:11080',
      enableUdpAssociate: true,
    },
  ],
  syslog: {
    enabled: false,
    targetType: 'udp',
    target: '127.0.0.1:514',
    format: 'rfc5424',
    enterpriseId: 0,
    messageId: 'vey-proxy',
    emitHostname: true,
  },
  audit: {
    accessLogs: true,
    auditLogs: true,
    protocolInspection: false,
    taskAuditRatio: 1,
    logUriMaxChars: 1024,
  },
};

function boundedString(value, name, max = 512) {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${name}格式无效`);
  return value.trim();
}

function getArray(value, name, max = 200) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${name}格式无效`);
  return value;
}

function parseRuleRecords(rule, permitKey, forbidKey) {
  if (!rule || typeof rule !== 'object') return [];
  if (Array.isArray(rule[permitKey])) return rule[permitKey];
  if (rule[permitKey] !== undefined) return [rule[permitKey]];
  if (Array.isArray(rule[forbidKey])) return rule[forbidKey];
  if (rule[forbidKey] !== undefined) return [rule[forbidKey]];
  return [];
}

function userView(user) {
  const hostFilter = user.dst_host_filter_set ?? {};
  const exact = hostFilter.exact_match ?? hostFilter.exact ?? [];
  const suffix =
    hostFilter.suffix_match ??
    hostFilter.suffix ??
    hostFilter.child_match ??
    hostFilter.child ??
    [];
  const portFilter = user.dst_port_filter;
  const exactHosts = [
    ...parseRuleRecords(exact, 'permit', 'forbid'),
    ...(Array.isArray(hostFilter.exact) ? hostFilter.exact : []),
  ].map(String);
  const domainSuffixes = [
    ...parseRuleRecords(suffix, 'permit', 'forbid'),
    ...(Array.isArray(hostFilter.child) ? hostFilter.child : []),
  ].map(String);
  const ports = [
    ...parseRuleRecords(portFilter, 'permit', 'forbid'),
    ...(Array.isArray(portFilter) ? portFilter : []),
  ].map(String);
  const hostAction =
    exact.default ??
    suffix.default ??
    (exact.permit !== undefined || suffix.permit !== undefined
      ? 'forbid'
      : exact.forbid !== undefined || suffix.forbid !== undefined
        ? 'permit'
        : undefined);
  const portAction = portFilter?.default;
  return {
    username: user.name,
    hasPassword: Boolean(user.token),
    hostMode:
      hostAction === 'forbid'
        ? 'allowlist'
        : hostAction === 'permit'
          ? 'blocklist'
          : 'unrestricted',
    exactHosts,
    domainSuffixes,
    portMode:
      portAction === 'forbid'
        ? 'allowlist'
        : portAction === 'permit'
          ? 'blocklist'
          : 'unrestricted',
    ports,
    auditRatio: user.audit?.task_audit_ratio ?? null,
    expire: user.expire ?? null,
  };
}

function aclRule(mode, permitKey, forbidKey, entries) {
  if (mode === 'unrestricted') return undefined;
  const unique = [
    ...new Set(entries.map((value) => String(value).trim()).filter(Boolean)),
  ];
  if (mode === 'allowlist' && unique.length === 0)
    throw new Error('白名单不能为空；空白名单会拒绝所有目标');
  if (unique.length === 0) return undefined;
  return {
    default: mode === 'allowlist' ? 'forbid' : 'permit',
    [mode === 'allowlist' ? permitKey : forbidKey]: unique,
  };
}

function hostFilterRule(mode, exactHosts, suffixes) {
  const normalized = (entries) => [
    ...new Set(entries.map((value) => String(value).trim()).filter(Boolean)),
  ];
  const exact = normalized(exactHosts);
  const suffix = normalized(suffixes);
  if (mode === 'unrestricted' || (exact.length === 0 && suffix.length === 0))
    return undefined;
  if (mode === 'allowlist' && exact.length === 0 && suffix.length === 0)
    throw new Error('白名单不能为空；空白白名单会拒绝所有目标');
  const defaultAction = mode === 'allowlist' ? 'forbid' : 'permit';
  const matchedAction = mode === 'allowlist' ? 'permit' : 'forbid';
  return {
    ...(exact.length > 0
      ? { exact_match: { default: defaultAction, [matchedAction]: exact } }
      : {}),
    ...(suffix.length > 0
      ? { suffix_match: { default: defaultAction, [matchedAction]: suffix } }
      : {}),
  };
}

function makeFastHash(password) {
  const salt = randomBytes(8);
  const data = Buffer.concat([Buffer.from(password), salt]);
  return {
    salt: salt.toString('hex'),
    md5: createHash('md5').update(data).digest('hex'),
    sha1: createHash('sha1').update(data).digest('hex'),
  };
}

function buildUserRecord(input, existing) {
  const username = boundedString(input.username, '用户名', 64);
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username))
    throw new Error(
      `用户名 ${username} 只能包含字母、数字、点、下划线和短横线`,
    );
  const password = typeof input.password === 'string' ? input.password : '';
  if (!existing && password.length < 8)
    throw new Error(`${username} 的新密码至少需要 8 个字符`);
  if (password && password.length < 8)
    throw new Error(`${username} 的密码至少需要 8 个字符`);
  const result = {
    name: username,
    token: password ? makeFastHash(password) : existing?.token,
  };
  if (!result.token) throw new Error(`${username} 尚无密码，请设置密码`);

  const exactHosts = getArray(input.exactHosts ?? [], '精确域名').map((x) =>
    boundedString(x, '精确域名', 253),
  );
  const suffixes = getArray(input.domainSuffixes ?? [], '域名后缀').map((x) =>
    boundedString(x, '域名后缀', 253).replace(/^\*\./, ''),
  );
  const hostMode = input.hostMode ?? 'unrestricted';
  if (!['allowlist', 'blocklist', 'unrestricted'].includes(hostMode))
    throw new Error('目标域名策略无效');
  if (
    hostMode === 'allowlist' &&
    exactHosts.length === 0 &&
    suffixes.length === 0
  )
    throw new Error('白名单不能为空；空白白名单会拒绝所有目标');
  const hostRule = hostFilterRule(hostMode, exactHosts, suffixes);
  if (hostRule) result.dst_host_filter_set = hostRule;

  const ports = getArray(input.ports ?? [], '目标端口', 1024).map((x) =>
    Number(x),
  );
  if (ports.some((x) => !Number.isInteger(x) || x < 1 || x > 65_535))
    throw new Error(`${username} 的端口范围无效`);
  const portMode = input.portMode ?? 'unrestricted';
  if (!['allowlist', 'blocklist', 'unrestricted'].includes(portMode))
    throw new Error('目标端口策略无效');
  const portRule = aclRule(portMode, 'permit', 'forbid', ports);
  if (portRule) result.dst_port_filter = portRule;

  if (
    input.auditRatio !== null &&
    input.auditRatio !== undefined &&
    input.auditRatio !== ''
  ) {
    const ratio = Number(input.auditRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
      throw new Error(`${username} 的审计采样率需在 0 到 1 之间`);
    result.audit = { task_audit_ratio: ratio };
  }
  if (input.expire) {
    const date = new Date(input.expire);
    if (!Number.isFinite(date.getTime()))
      throw new Error(`${username} 的过期时间无效`);
    result.expire = date.toISOString();
  }
  return result;
}

function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('代理设置格式无效');
  const listeners = getArray(input.listeners, '代理监听器', 32).map(
    (listener) => {
      const name = boundedString(listener.name, '监听器名称', 32);
      const type = listener.type;
      if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(name))
        throw new Error('代理入口名称格式无效');
      if (!['http_proxy', 'socks_proxy'].includes(type))
        throw new Error('当前控制台支持 HTTP Proxy 与 SOCKS5 入口');
      const address = boundedString(listener.address, '监听地址', 256);
      const port = Number(address.slice(address.lastIndexOf(':') + 1));
      if (!Number.isInteger(port) || port < 1 || port > 65_535)
        throw new Error(`${name} 监听端口无效`);
      return {
        name,
        type,
        address,
        enableUdpAssociate:
          type === 'socks_proxy' && listener.enableUdpAssociate !== false,
      };
    },
  );
  if (new Set(listeners.map((x) => x.name)).size !== listeners.length)
    throw new Error('代理入口名称重复');
  const syslog = { ...defaults.syslog, ...input.syslog };
  if (!['udp', 'unix'].includes(syslog.targetType))
    throw new Error('Syslog 目标类型无效');
  syslog.target = boundedString(syslog.target, 'Syslog 目标地址', 512);
  if (syslog.enabled && !syslog.target)
    throw new Error('启用 Syslog 时必须填写目标地址');
  if (!['rfc3164', 'rfc5424'].includes(syslog.format))
    throw new Error('Syslog 格式无效');
  syslog.enterpriseId = Number(syslog.enterpriseId);
  if (
    !Number.isInteger(syslog.enterpriseId) ||
    syslog.enterpriseId < 0 ||
    syslog.enterpriseId > 4_294_967_295
  )
    throw new Error('Enterprise ID 无效');
  syslog.messageId = boundedString(syslog.messageId, 'Syslog Message ID', 48);
  const audit = { ...defaults.audit, ...input.audit };
  audit.taskAuditRatio = Number(audit.taskAuditRatio);
  audit.logUriMaxChars = Number(audit.logUriMaxChars);
  if (
    !Number.isFinite(audit.taskAuditRatio) ||
    audit.taskAuditRatio < 0 ||
    audit.taskAuditRatio > 1
  )
    throw new Error('审计采样率需在 0 到 1 之间');
  if (
    !Number.isInteger(audit.logUriMaxChars) ||
    audit.logUriMaxChars < 0 ||
    audit.logUriMaxChars > 16_384
  )
    throw new Error('URI 日志长度上限无效');
  const system = { ...defaults.system, ...input.system };
  for (const key of [
    'threadNumber',
    'serverOfflineDelay',
    'controllerRecvTimeout',
    'controllerSendTimeout',
    'resolverRequestTimeout',
    'resolverTries',
  ]) {
    system[key] = Number(system[key]);
    const min = key === 'threadNumber' ? 0 : 1;
    const max =
      key === 'resolverTries' ? 10 : key === 'threadNumber' ? 256 : 3600;
    if (
      !Number.isInteger(system[key]) ||
      system[key] < min ||
      system[key] > max
    )
      throw new Error(`系统配置 ${key} 超出允许范围`);
  }
  system.resolverServers = getArray(
    system.resolverServers,
    'DNS 服务器',
    16,
  ).map((server) => boundedString(server, 'DNS 服务器地址', 64));
  if (
    system.resolverServers.length === 0 ||
    system.resolverServers.some((server) => !isIP(server))
  )
    throw new Error('至少填写一个有效的 IPv4 或 IPv6 DNS 服务器地址');
  if (
    !['Ipv4First', 'Ipv4Only', 'Ipv6First', 'Ipv6Only'].includes(
      system.resolveStrategy,
    )
  )
    throw new Error('DNS 解析策略无效');
  if (system.noIpv6 && system.resolveStrategy === 'Ipv6Only')
    throw new Error('禁用 IPv6 时不能选择仅 IPv6 解析');
  if (listeners.length === 0) throw new Error('至少需要配置一个代理入口');
  return { system, listeners, syslog, audit };
}

function buildMainConfig(settings) {
  const logger = settings.syslog.enabled
    ? {
        syslog: {
          ...(settings.syslog.targetType === 'udp'
            ? { target_udp: { address: settings.syslog.target } }
            : { target_unix: { path: settings.syslog.target } }),
          ...(settings.syslog.format === 'rfc5424'
            ? {
                format_rfc5424: {
                  enterprise_id: settings.syslog.enterpriseId,
                  message_id: settings.syslog.messageId,
                },
              }
            : {}),
          emit_hostname: settings.syslog.emitHostname,
        },
      }
    : 'stdout';
  const config = {
    runtime: {
      thread_number: settings.system.threadNumber,
      server_offline_delay: `${settings.system.serverOfflineDelay}s`,
    },
    controller: {
      local: {
        recv_timeout: settings.system.controllerRecvTimeout,
        send_timeout: settings.system.controllerSendTimeout,
      },
    },
    server: settings.listeners.map((listener) => ({
      name: listener.name,
      escaper: 'default',
      user_group: 'default',
      ...(settings.audit.accessLogs || settings.audit.auditLogs
        ? { auditor: 'default' }
        : {}),
      type: listener.type,
      listen: { address: listener.address },
      ...(listener.type === 'http_proxy'
        ? { log_uri_max_chars: settings.audit.logUriMaxChars }
        : {}),
      ...(listener.type === 'socks_proxy'
        ? { enable_udp_associate: listener.enableUdpAssociate }
        : {}),
    })),
    resolver: [
      {
        name: 'default',
        type: 'hickory',
        server: settings.system.resolverServers,
        request_timeout: `${settings.system.resolverRequestTimeout}s`,
        each_tries: settings.system.resolverTries,
      },
    ],
    escaper: [
      {
        name: 'default',
        type: 'direct_fixed',
        resolver: 'default',
        resolve_strategy: settings.system.resolveStrategy,
        no_ipv6: settings.system.noIpv6,
      },
    ],
    user_group: [
      {
        name: 'default',
        source: { type: 'file', path: usersFile },
        cache: usersFile,
        refresh_interval: '24h',
      },
    ],
    ...(settings.audit.accessLogs || settings.audit.auditLogs
      ? {
          auditor: [
            {
              name: 'default',
              task_audit_ratio: settings.audit.taskAuditRatio,
              log_uri_max_chars: settings.audit.logUriMaxChars,
              ...(settings.audit.protocolInspection
                ? { protocol_inspection: {} }
                : {}),
            },
          ],
        }
      : {}),
    log: {
      default: logger,
      task: settings.audit.accessLogs ? 'stdout' : 'discard',
      audit: settings.audit.auditLogs ? 'stdout' : 'discard',
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}

function parseList(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// vey-proxy top-level config sections that hold per-resource arrays.
const RESOURCE_SECTIONS = [
  'server',
  'escaper',
  'resolver',
  'auditor',
  'site_group',
  'user_group',
];
const RESOURCE_RELOAD = {
  server: 'reload-server',
  escaper: 'reload-escaper',
  resolver: 'reload-resolver',
  auditor: 'reload-auditor',
  site_group: 'reload-site-group',
  user_group: 'reload-user-group',
};
const RESOURCE_NAME_RE = /^[\w.-]{1,128}$/;

async function readProxyDoc() {
  let text;
  try {
    text = await readFile(configFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { doc: {}, text: '' };
    throw error;
  }
  let doc;
  try {
    doc = parseYaml(text) ?? {};
  } catch (error) {
    throw new Error(`代理配置不是合法 YAML：${error.message}`, {
      cause: error,
    });
  }
  if (typeof doc !== 'object' || Array.isArray(doc))
    throw new Error('代理配置根节点应为映射');
  return { doc, text };
}

function asSpec(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('资源配置必须是 YAML 映射对象');
  return value;
}

/**
 * Accept a resource spec either as an object (`body.spec`) or as raw YAML
 * text (`body.specYaml`), mirroring the gateway admin endpoints. The bridge
 * parses YAML so the browser bundle does not need its own YAML parser.
 */
function specFromBody(body) {
  if (body.specYaml !== undefined) {
    const text = String(body.specYaml);
    if (!text || text.length > 256 * 1024)
      return { error: '资源 YAML 内容无效或过大' };
    let parsed;
    try {
      parsed = parseYaml(text);
    } catch (error) {
      return { error: `资源 YAML 解析失败：${error.message}` };
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { error: '资源 YAML 内容必须是映射对象' };
    }
    return { spec: parsed };
  }
  try {
    return { spec: asSpec(body.spec) };
  } catch (error) {
    return { error: error.message };
  }
}

async function validateProxyText(afterText) {
  const candidate = `${configFile}.console-check.yaml`;
  await atomicWrite(candidate, afterText);
  try {
    await execFileAsync(
      proxyBin,
      [
        '--test-config',
        '--control-dir',
        controlDir,
        '--config-file',
        candidate,
      ],
      { timeout: 30_000, maxBuffer: 256 * 1024 },
    );
  } catch (error) {
    throw new Error(
      error.stderr?.trim() || error.message || 'VEY Proxy 配置校验失败',
      { cause: error },
    );
  } finally {
    await (await import('node:fs/promises')).unlink(candidate).catch(() => {});
  }
}

const proxySectionCtlName = (section) =>
  section === 'site_group'
    ? 'site-group'
    : section === 'user_group'
      ? 'user-group'
      : section;

function parseUpstreamTsv(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines.shift() ?? '';
  const keys = header.split('\t').map((key) => key.trim());
  return lines.map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(
      keys.map((key, index) => [key || `col${index}`, cells[index] ?? '']),
    );
  });
}

function parseQueryResult(stdout) {
  const lines = parseList(stdout);
  const records = [];
  for (const line of lines) {
    const match = /^(\S+)\s*(.*)$/.exec(line);
    if (!match) continue;
    if (match[2]) records.push({ kind: match[1], value: match[2] });
    else records.push({ kind: 'text', value: match[1] });
  }
  return { raw: lines, records };
}

export function createProxyAdmin({
  json,
  readBody,
  getProxyPid,
  restartProxy,
}) {
  const ctlArgs = (args) => [
    '--control-dir',
    controlDir,
    '--daemon-pid',
    String(getProxyPid() || configuredPid),
    ...args,
  ];
  const runCtl = async (args) =>
    (
      await execFileAsync(proxyCtl, ctlArgs(args), {
        timeout: 8000,
        maxBuffer: 128 * 1024,
      })
    ).stdout.trim();

  async function mutateResource(section, name, spec, { remove = false } = {}) {
    if (!RESOURCE_RELOAD[section])
      throw new Error(`不支持的配置分区 ${section}`);
    if (!RESOURCE_NAME_RE.test(name))
      throw new Error('资源名称只能包含字母、数字、点、下划线和短横线');
    const { doc } = await readProxyDoc();
    const list = Array.isArray(doc[section]) ? [...doc[section]] : [];
    const index = list.findIndex(
      (item) => item && typeof item === 'object' && item.name === name,
    );
    if (remove) {
      if (index === -1) throw new Error(`资源 ${name} 不存在`);
      list.splice(index, 1);
    } else if (index === -1) {
      list.push(spec);
    } else {
      list[index] = spec;
    }
    doc[section] = list;
    const afterText = stringifyYaml(doc);
    await validateProxyText(afterText);
    await atomicWrite(configFile, afterText);
    try {
      await runCtl([RESOURCE_RELOAD[section], name]);
    } catch {
      // Some sections (e.g. freshly added servers) need a full reload or a
      // process restart. Fall back to a daemon reload; keep the saved config
      // either way and report the state without corrupting the file.
      try {
        await runCtl(['reload']);
      } catch (reloadError) {
        throw new Error(`配置已保存，但热加载失败：${reloadError.message}`, {
          cause: reloadError,
        });
      }
    }
    return {
      message: remove
        ? `${section} ${name} 已删除并热加载`
        : `${section} ${name} 已保存并热加载`,
    };
  }

  return async function handleProxyAdmin(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/proxy/status') {
      try {
        const groups = parseList(await runCtl(['list', 'user-group']));
        const servers = parseList(await runCtl(['list', 'server']));
        const [version, serverStats, otherLists] = await Promise.all([
          runCtl(['version']),
          Promise.all(
            servers.map(async (name) => {
              try {
                const text = await runCtl(['server', name, 'status']);
                const read = (key) =>
                  new RegExp(`^${key}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim();
                return [
                  name,
                  {
                    online: read('online') === 'true',
                    aliveTasks: Number(read('alive tasks') ?? 0),
                    totalConnections: Number(read('total conn') ?? 0),
                  },
                ];
              } catch {
                return [
                  name,
                  { online: false, aliveTasks: 0, totalConnections: 0 },
                ];
              }
            }),
          ),
          Promise.all(
            ['resolver', 'escaper', 'auditor', 'site-group'].map(
              async (ctlName) => {
                try {
                  return [ctlName, parseList(await runCtl(['list', ctlName]))];
                } catch {
                  return [ctlName, []];
                }
              },
            ),
          ),
        ]);
        const resources = Object.fromEntries(otherLists);
        return json(res, 200, {
          connected: true,
          checkedAt: new Date().toISOString(),
          version,
          groups,
          servers,
          serverStats: Object.fromEntries(serverStats),
          resolvers: resources.resolver ?? [],
          escapers: resources.escaper ?? [],
          auditors: resources.auditor ?? [],
          siteGroups: resources['site-group'] ?? [],
        });
      } catch (error) {
        return json(res, 200, {
          connected: false,
          checkedAt: new Date().toISOString(),
          version: '',
          groups: [],
          servers: [],
          serverStats: {},
          resolvers: [],
          escapers: [],
          auditors: [],
          siteGroups: [],
          error: error.message,
        });
      }
    }

    if (req.method === 'GET' && url.pathname === '/proxy/users') {
      let users = [];
      try {
        users = JSON.parse(await readFile(usersFile, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        await runCtl(['list', 'user-group']);
        const dynamicUsers = parseList(
          await runCtl(['user-group', 'default', 'list-dynamic-user']),
        );
        const available = new Set(
          dynamicUsers.map((line) => line.trim()).filter(Boolean),
        );
        users = users.filter((user) => available.has(user.name));
      } catch (error) {
        return json(res, 503, {
          error: `vey-proxy 控制接口不可用：${error.message}`,
        });
      }
      return json(res, 200, { users: users.map(userView) });
    }

    if (req.method === 'PUT' && url.pathname === '/proxy/users') {
      const body = await readBody(req, 1_000_000);
      const inputUsers = getArray(body.users, '用户列表', 500);
      const oldUsers = JSON.parse(
        await readFile(usersFile, 'utf8').catch((error) =>
          error.code === 'ENOENT' ? '[]' : Promise.reject(error),
        ),
      );
      try {
        await runCtl(['list', 'user-group']);
      } catch (error) {
        return json(res, 503, {
          error: `vey-proxy 控制接口不可用：${error.message}`,
        });
      }
      const oldByName = new Map(oldUsers.map((user) => [user.name, user]));
      const names = inputUsers.map((user) =>
        boundedString(user.username, '用户名', 64),
      );
      if (new Set(names).size !== names.length)
        throw new Error('用户名不能重复');
      const users = inputUsers.map((user) =>
        buildUserRecord(user, oldByName.get(user.username)),
      );
      await atomicWrite(usersFile, `${JSON.stringify(users, null, 2)}\n`);
      try {
        await runCtl(['user-group', 'default', 'publish-user', usersFile]);
      } catch (error) {
        await atomicWrite(usersFile, `${JSON.stringify(oldUsers, null, 2)}\n`);
        throw error;
      }
      return json(res, 200, {
        users: users.map(userView),
        message: '用户与访问策略已保存并热更新',
      });
    }

    if (req.method === 'GET' && url.pathname === '/proxy/settings') {
      try {
        let settings;
        try {
          settings = validateSettings(
            JSON.parse(await readFile(settingsFile, 'utf8')),
          );
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          settings = defaults;
        }
        const output = await runCtl(['version']);
        if (!output) throw new Error('vey-proxy 控制接口不可用');
        return json(res, 200, settings);
      } catch (error) {
        return json(res, 503, {
          error: `无法读取运行中的 vey-proxy：${error.message}`,
        });
      }
    }

    if (req.method === 'GET' && url.pathname === '/proxy/audit-log') {
      let content = '';
      try {
        content = await readFile(auditLogFile, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-1000);
      return json(res, 200, {
        lines,
        path: auditLogFile,
        updatedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'PUT' && url.pathname === '/proxy/settings') {
      const settings = validateSettings(await readBody(req, 64 * 1024));
      const oldSettings = await readFile(settingsFile, 'utf8').catch((error) =>
        error.code === 'ENOENT' ? null : Promise.reject(error),
      );
      const oldConfig = await readFile(configFile, 'utf8').catch((error) =>
        error.code === 'ENOENT' ? null : Promise.reject(error),
      );
      try {
        await runCtl(['list', 'server']);
      } catch (error) {
        return json(res, 503, {
          error: `vey-proxy 控制接口不可用：${error.message}`,
        });
      }
      await atomicWrite(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
      await atomicWrite(configFile, buildMainConfig(settings));
      try {
        await execFileAsync(
          proxyBin,
          [
            '--test-config',
            '--control-dir',
            controlDir,
            '--config-file',
            configFile,
          ],
          { timeout: 30_000, maxBuffer: 256 * 1024 },
        );
      } catch (error) {
        if (oldSettings === null)
          await (
            await import('node:fs/promises')
          )
            .unlink(settingsFile)
            .catch(() => {});
        else await atomicWrite(settingsFile, oldSettings);
        if (oldConfig === null)
          await (
            await import('node:fs/promises')
          )
            .unlink(configFile)
            .catch(() => {});
        else await atomicWrite(configFile, oldConfig);
        return json(res, 422, {
          error:
            error.stderr?.trim() || error.message || 'VEY Proxy 配置校验失败',
        });
      }
      const restarted = await restartProxy();
      return json(res, 200, {
        message: restarted
          ? '代理入口、Syslog 与审计配置已保存并重启生效'
          : '配置校验通过并已保存；当前代理由外部进程管理，请重启 vey-proxy 使 Syslog 设置生效',
        restarted,
      });
    }

    // --- Full management: resource inventory & per-section listing ---
    if (req.method === 'GET' && url.pathname === '/proxy/resources') {
      const sections = {};
      for (const section of RESOURCE_SECTIONS) {
        try {
          sections[section] = parseList(
            await runCtl(['list', proxySectionCtlName(section)]),
          );
        } catch (error) {
          sections[section] = [];
          sections[`${section}Error`] = error.message;
        }
      }
      return json(res, 200, { ok: true, sections });
    }

    const sectionMatch =
      /^\/proxy\/resources\/(server|escaper|resolver|auditor|site_group|user_group)$/.exec(
        url.pathname,
      );
    const itemMatch =
      /^\/proxy\/resources\/(server|escaper|resolver|auditor|site_group|user_group)\/([\w.-]+)$/.exec(
        url.pathname,
      );

    if (req.method === 'GET' && sectionMatch) {
      const section = sectionMatch[1];
      const { doc } = await readProxyDoc();
      const items = Array.isArray(doc[section]) ? doc[section] : [];
      return json(res, 200, { ok: true, section, items });
    }

    if (req.method === 'GET' && itemMatch) {
      const section = itemMatch[1];
      const name = itemMatch[2];
      const { doc } = await readProxyDoc();
      const items = Array.isArray(doc[section]) ? doc[section] : [];
      const item =
        items.find(
          (entry) => entry && typeof entry === 'object' && entry.name === name,
        ) ?? null;
      if (!item) return json(res, 404, { error: `${section} ${name} 不存在` });
      return json(res, 200, {
        ok: true,
        section,
        name,
        spec: item,
        specYaml: stringifyYaml(item),
      });
    }

    if (req.method === 'POST' && sectionMatch) {
      const section = sectionMatch[1];
      const body = await readBody(req, 256 * 1024);
      const name = String(body.name ?? '');
      if (!RESOURCE_NAME_RE.test(name))
        return json(res, 400, {
          error: '资源名称只能包含字母、数字、点、下划线和短横线',
        });
      const { doc } = await readProxyDoc();
      const items = Array.isArray(doc[section]) ? doc[section] : [];
      if (
        items.some(
          (entry) => entry && typeof entry === 'object' && entry.name === name,
        )
      ) {
        return json(res, 409, { error: `${section} ${name} 已存在` });
      }
      try {
        const parsed = specFromBody(body);
        if (parsed.error) return json(res, 400, { error: parsed.error });
        const spec = { name, ...parsed.spec };
        const result = await mutateResource(section, name, spec);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 503, { error: error.message });
      }
    }

    if (req.method === 'PUT' && itemMatch) {
      const section = itemMatch[1];
      const name = itemMatch[2];
      const body = await readBody(req, 256 * 1024);
      const { doc } = await readProxyDoc();
      const items = Array.isArray(doc[section]) ? doc[section] : [];
      if (
        !items.some(
          (entry) => entry && typeof entry === 'object' && entry.name === name,
        )
      ) {
        return json(res, 404, { error: `${section} ${name} 不存在` });
      }
      try {
        const parsed = specFromBody(body);
        if (parsed.error) return json(res, 400, { error: parsed.error });
        const spec = { name, ...parsed.spec };
        const result = await mutateResource(section, name, spec);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 503, { error: error.message });
      }
    }

    if (req.method === 'DELETE' && itemMatch) {
      const section = itemMatch[1];
      const name = itemMatch[2];
      try {
        const result = await mutateResource(section, name, null, {
          remove: true,
        });
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 503, { error: error.message });
      }
    }

    // --- user-group full management (static/dynamic users, publish) ---
    const userGroupMatch =
      /^\/proxy\/user-groups\/([\w.-]+)\/(users|publish)$/.exec(url.pathname);
    if (
      req.method === 'GET' &&
      userGroupMatch &&
      userGroupMatch[2] === 'users'
    ) {
      const group = userGroupMatch[1];
      const kind = new URL(req.url, 'http://placeholder').searchParams.get(
        'kind',
      );
      const subcommand =
        kind === 'static' ? 'list-static-user' : 'list-dynamic-user';
      try {
        const output = await runCtl(['user-group', group, subcommand]);
        return json(res, 200, {
          ok: true,
          group,
          kind: kind === 'static' ? 'static' : 'dynamic',
          lines: parseList(output),
          raw: output,
        });
      } catch (error) {
        return json(res, 503, {
          error: `查询 ${group} 用户失败：${error.message}`,
        });
      }
    }
    if (
      req.method === 'POST' &&
      userGroupMatch &&
      userGroupMatch[2] === 'publish'
    ) {
      const group = userGroupMatch[1];
      const body = await readBody(req, 2 * 1024 * 1024);
      const contents =
        typeof body.contents === 'string'
          ? body.contents
          : JSON.stringify(body.users ?? body.contents ?? {});
      try {
        JSON.parse(contents);
      } catch {
        return json(res, 400, { error: '待发布内容必须是合法 JSON' });
      }
      const file = `${usersFile}.${Date.now()}.publish.json`;
      try {
        await atomicWrite(file, contents);
        const output = await runCtl([
          'user-group',
          group,
          'publish-user',
          file,
        ]);
        return json(res, 200, { ok: true, group, output: parseList(output) });
      } catch (error) {
        return json(res, 503, { error: `发布用户失败：${error.message}` });
      } finally {
        await (await import('node:fs/promises')).unlink(file).catch(() => {});
      }
    }

    // --- resolver diagnostics ---
    if (req.method === 'POST' && url.pathname === '/proxy/resolver/query') {
      const body = await readBody(req, 64 * 1024);
      const name = String(body.name ?? '');
      const domain = String(body.domain ?? '');
      if (!RESOURCE_NAME_RE.test(name))
        return json(res, 400, { error: '解析器名称无效' });
      if (!domain || domain.length > 253)
        return json(res, 400, { error: '域名无效' });
      const args = ['resolver', name, 'query', domain];
      if (body.strategy) args.push('--strategy', String(body.strategy));
      if (body.resolutionDelay !== undefined)
        args.push('--resolution-delay', String(body.resolutionDelay));
      try {
        const output = await runCtl(args);
        return json(res, 200, {
          ok: true,
          name,
          domain,
          ...parseQueryResult(output),
        });
      } catch (error) {
        return json(res, 503, { error: `DNS 查询失败：${error.message}` });
      }
    }

    // --- site-group runtime upstream management ---
    const siteGroupMatch =
      /^\/proxy\/site-groups\/([\w.-]+)\/(list-upstream|set-weight)$/.exec(
        url.pathname,
      );
    if (req.method === 'POST' && siteGroupMatch) {
      const group = siteGroupMatch[1];
      const action = siteGroupMatch[2];
      const body = await readBody(req, 64 * 1024);
      const site = String(body.site ?? '');
      if (!site || site.length > 256)
        return json(res, 400, { error: 'site 标识无效' });
      try {
        if (action === 'list-upstream') {
          const output = await runCtl([
            'site-group',
            group,
            'list-upstream',
            site,
          ]);
          return json(res, 200, {
            ok: true,
            group,
            site,
            upstreams: parseUpstreamTsv(output),
          });
        }
        const addr = String(body.addr ?? '');
        const weight = Number(body.weight);
        if (!/^[\w.\-[\]:]+:\d+$/.test(addr))
          return json(res, 400, { error: '上游地址格式无效（期望 IP:PORT）' });
        if (!Number.isFinite(weight) || weight < 0)
          return json(res, 400, { error: '权重必须是大于等于 0 的数字' });
        await runCtl([
          'site-group',
          group,
          'set-upstream-weight',
          site,
          addr,
          String(weight),
        ]);
        return json(res, 200, {
          ok: true,
          group,
          site,
          addr,
          weight,
          message: '上游权重已更新',
        });
      } catch (error) {
        return json(res, 503, { error: `站点组操作失败：${error.message}` });
      }
    }

    return false;
  };
}

export async function initializeProxyRuntime() {
  await mkdir(dirname(configFile), { recursive: true });
  const settings = validateSettings(
    JSON.parse(
      await readFile(settingsFile, 'utf8').catch((error) =>
        error.code === 'ENOENT'
          ? JSON.stringify(defaults)
          : Promise.reject(error),
      ),
    ),
  );
  await readFile(usersFile, 'utf8').catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    await atomicWrite(usersFile, '[]\n');
  });
  await readFile(configFile, 'utf8').catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    await atomicWrite(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    await atomicWrite(configFile, buildMainConfig(settings));
  });
}

export { buildMainConfig, defaults as defaultProxySettings };
