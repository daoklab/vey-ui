import { execFile } from 'node:child_process';
/*
 * SPDX-License-Identifier: Apache-2.0
 * Management endpoints for the auxiliary VEY components: statsd, keyless,
 * dcgen, iploc daemons plus the mkcert certificate CLI and bench load
 * generator.
 *
 * Daemons with a ctl binary (statsd/keyless) expose process lifecycle and
 * resource-level actions over their local Cap'n Proto control socket. Daemons
 * without a ctl binary (dcgen/iploc) only support configuration file management
 * and `--test-config` validation. CLI tools (mkcert/bench) are orchestrated as
 * one-shot commands. Every endpoint is implemented from the real subcommand
 * surface of the respective binary; nothing is invented.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import {
  atomicWrite,
  fileExists,
  parseYaml,
  readConfigText,
  safeError,
} from './lib.mjs';

const execFileAsyncP = promisify(execFile);
const binDefault = (name) =>
  new URL(`../../vey/target/release-lto/${name}`, import.meta.url).pathname;

function envOr(name, fallback) {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

const NAME_RE = /^[\w.-]{1,128}$/;
const IDENT_RE = /^[a-zA-Z0-9_.-]+$/;

/** Per-component registry. `ctl: null` means the daemon has no ctl tool. */
const COMPONENTS = {
  statsd: {
    name: 'vey-statsd',
    title: 'statsd 指标采集',
    kind: 'daemon',
    bin: envOr('VEY_STATSD_BIN', binDefault('vey-statsd')),
    ctl: envOr('VEY_STATSD_CTL', binDefault('vey-statsd-ctl')),
    configFile: envOr('VEY_STATSD_CONFIG', '/tmp/vey-statsd-console.yaml'),
    controlDir: envOr(
      'VEY_STATSD_CONTROL_DIR',
      '/tmp/vey-statsd-console-control',
    ),
    group: envOr('VEY_STATSD_GROUP', ''),
    pid: envOr('VEY_STATSD_PID', '0'),
    config: true,
    resources: ['importer', 'collector', 'exporter'],
    actions: {
      daemon: ['version', 'offline', 'reload', 'cancel-shutdown'],
      list: ['importer', 'collector', 'exporter'],
      'reload-importer': { needName: true },
      'reload-collector': { needName: true },
      'reload-exporter': { needName: true },
    },
  },
  keyless: {
    name: 'vey-keyless',
    title: 'keyless 隐私密钥服务',
    kind: 'daemon',
    bin: envOr('VEY_KEYLESS_BIN', binDefault('vey-keyless')),
    ctl: envOr('VEY_KEYLESS_CTL', binDefault('vey-keyless-ctl')),
    configFile: envOr('VEY_KEYLESS_CONFIG', '/tmp/vey-keyless-console.yaml'),
    controlDir: envOr(
      'VEY_KEYLESS_CONTROL_DIR',
      '/tmp/vey-keyless-console-control',
    ),
    group: envOr('VEY_KEYLESS_GROUP', ''),
    pid: envOr('VEY_KEYLESS_PID', '0'),
    config: true,
    resources: ['server', 'key'],
    actions: {
      daemon: ['version', 'offline', 'reload', 'cancel-shutdown'],
      list: ['server', 'key'],
      'publish-key': { needFile: true },
      'check-key': { needFile: true },
      'server-status': { needName: true },
      'server-add-metrics-tag': {
        needName: true,
        needTag: true,
        needValue: true,
      },
      'server-get-listen-addr': { needName: true },
      'check-dup': { needDir: true, needExt: true },
    },
  },
  dcgen: {
    name: 'vey-dcgen',
    title: 'dcgen 域名收集生成',
    kind: 'daemon',
    bin: envOr('VEY_DCGEN_BIN', binDefault('vey-dcgen')),
    ctl: null,
    configFile: envOr('VEY_DCGEN_CONFIG', '/tmp/vey-dcgen-console.yaml'),
    controlDir: envOr(
      'VEY_DCGEN_CONTROL_DIR',
      '/tmp/vey-dcgen-console-control',
    ),
    group: '',
    pid: '0',
    config: true,
    resources: [],
    actions: { daemon: ['version'] },
  },
  iploc: {
    name: 'vey-iploc',
    title: 'iploc IP 定位服务',
    kind: 'daemon',
    bin: envOr('VEY_IPLOC_BIN', binDefault('vey-iploc')),
    ctl: null,
    configFile: envOr('VEY_IPLOC_CONFIG', '/tmp/vey-iploc-console.yaml'),
    controlDir: envOr(
      'VEY_IPLOC_CONTROL_DIR',
      '/tmp/vey-iploc-console-control',
    ),
    group: '',
    pid: '0',
    config: true,
    resources: [],
    actions: { daemon: ['version'] },
  },
  mkcert: {
    name: 'vey-mkcert',
    title: 'mkcert 证书生成',
    kind: 'cli',
    bin: envOr('VEY_MKCERT_BIN', binDefault('vey-mkcert')),
    ctl: null,
    config: false,
    resources: [],
    actions: { daemon: ['version'] },
    certTypes: [
      'root',
      'intermediate',
      'tls-server',
      'tls-client',
      'tlcp-server-sign',
      'tlcp-server-enc',
      'tlcp-client-sign',
      'tlcp-client-enc',
    ],
    algorithms: [
      'rsa',
      'ec224',
      'ec256',
      'ec384',
      'ec521',
      'sm2',
      'ed25519',
      'ed448',
      'x25519',
      'x448',
    ],
  },
  bench: {
    name: 'vey-bench',
    title: 'bench 性能压测',
    kind: 'cli',
    bin: envOr('VEY_BENCH_BIN', binDefault('vey-bench')),
    ctl: null,
    config: false,
    resources: [],
    actions: { daemon: ['version'] },
    targets: [
      'h1',
      'h2',
      'h3',
      'openssl',
      'rustls',
      'dns',
      'keyless',
      'thrift',
      'websocket',
    ],
  },
};

const CERT_FLAG = {
  root: '--root',
  intermediate: '--intermediate',
  'tls-server': '--tls-server',
  'tls-client': '--tls-client',
  'tlcp-server-sign': '--tlcp-server-sign',
  'tlcp-server-enc': '--tlcp-server-enc',
  'tlcp-client-sign': '--tlcp-client-sign',
  'tlcp-client-enc': '--tlcp-client-enc',
};

function componentOf(name) {
  if (!Object.hasOwn(COMPONENTS, name)) return null;
  return { ...COMPONENTS[name], slug: name };
}

async function binVersion(binPath) {
  for (const args of [['--version'], ['version']]) {
    try {
      const { stdout } = await execFileAsyncP(binPath, args, {
        timeout: 8000,
        maxBuffer: 64 * 1024,
      });
      const line = stdout.trim().split(/\r?\n/)[0] ?? '';
      if (line) return line;
    } catch {
      // fall through to the next argument shape
    }
  }
  return 'unknown';
}

async function daemonConnected(comp) {
  if (!comp.ctl) return null;
  const { readdir } = await import('node:fs/promises');
  try {
    const files = await readdir(comp.controlDir);
    const suffix =
      comp.pid && comp.pid !== '0'
        ? `_${comp.pid}.sock`
        : comp.group
          ? `${comp.group}.sock`
          : '_.sock';
    return files.some(
      (file) =>
        file.endsWith('.sock') &&
        (comp.pid && comp.pid !== '0' ? file.includes(`_${comp.pid}`) : true) &&
        (comp.group ? file.includes(comp.group) : true),
    );
  } catch {
    return false;
  }
}

async function collectComponentDetail(comp) {
  const binPresent = await fileExists(comp.bin);
  let version = null;
  if (binPresent) {
    try {
      version = await binVersion(comp.bin);
    } catch {
      version = null;
    }
  }
  let ctlPresent = false;
  let connected = null;
  if (comp.ctl) {
    ctlPresent = await fileExists(comp.ctl);
    connected = ctlPresent ? await daemonConnected(comp) : false;
  }
  const configPresent = comp.config ? await fileExists(comp.configFile) : false;
  return {
    slug: comp.slug,
    name: comp.name,
    title: comp.title,
    kind: comp.kind,
    bin: comp.bin,
    binPresent,
    version,
    ctl: comp.ctl,
    ctlPresent,
    connected,
    configFile: comp.config ? comp.configFile : null,
    configPresent,
    resources: comp.resources,
    actions: comp.actions,
    certTypes: comp.certTypes ?? null,
    algorithms: comp.algorithms ?? null,
    targets: comp.targets ?? null,
  };
}

function validateWith(comp) {
  return async (content) => {
    const bin = comp.bin;
    if (!bin) throw new Error(`组件 ${comp.name} 没有可执行文件`);
    const candidate = `${comp.configFile}.console-check.yaml`;
    await writeFile(candidate, content, { mode: 0o600 });
    try {
      // statsd/keyless accept --control-dir (DaemonArgs); dcgen/iploc do not.
      const args = ['--test-config'];
      if (comp.ctl) args.push('--control-dir', comp.controlDir);
      args.push('--config-file', candidate);
      await execFileAsyncP(bin, args, {
        timeout: 30_000,
        maxBuffer: 256 * 1024,
      });
    } finally {
      await import('node:fs/promises').then(({ unlink }) =>
        unlink(candidate).catch(() => {}),
      );
    }
  };
}

export function createComponentsAdmin({ json, readBody }) {
  async function handle(req, res, url) {
    const segments = url.pathname
      .slice('/components'.length)
      .split('/')
      .filter(Boolean);

    if (segments.length === 0) {
      if (req.method === 'GET') {
        const entries = await Promise.all(
          Object.keys(COMPONENTS).map((slug) =>
            collectComponentDetail(componentOf(slug)),
          ),
        );
        return json(res, 200, { components: entries });
      }
      return json(res, 405, { error: '不支持的方法' });
    }

    const [slug, ...rest] = segments;
    const comp = componentOf(slug);
    if (!comp) return json(res, 404, { error: `未知组件 ${slug}` });

    // /components/{slug} detail
    if (rest.length === 0) {
      if (req.method === 'GET')
        return json(res, 200, await collectComponentDetail(comp));
      return json(res, 405, { error: '不支持的方法' });
    }

    const action = rest[0];

    // ---- configuration endpoints (daemon components with config files) ----
    if (action === 'config') {
      if (!comp.config)
        return json(res, 400, { error: `${comp.name} 没有配置文件` });
      if (rest.length === 1 && req.method === 'GET') {
        const text = await readConfigText(comp.configFile);
        if (text === null)
          return json(res, 200, {
            present: false,
            path: comp.configFile,
            content: '',
          });
        let doc = null;
        let parseError = null;
        try {
          doc = parseYaml(text) ?? null;
        } catch (error) {
          parseError = safeError(error);
        }
        return json(res, 200, {
          present: true,
          path: comp.configFile,
          content: text,
          doc,
          parseError,
        });
      }
      if (rest.length === 1 && req.method === 'PUT') {
        const body = await readBody(req, 1024 * 1024);
        const content = typeof body.content === 'string' ? body.content : null;
        if (content === null || content.length > 1024 * 1024)
          return json(res, 400, { error: '配置内容无效或超过 1 MB' });
        await validateWith(comp)(content);
        await atomicWrite(comp.configFile, content);
        if (comp.ctl) {
          try {
            await execFileAsyncP(
              comp.ctl,
              [
                '--control-dir',
                comp.controlDir,
                '--daemon-pid',
                comp.pid,
                'reload',
              ],
              { timeout: 8000, maxBuffer: 64 * 1024 },
            );
            return json(res, 200, {
              saved: true,
              reloaded: true,
              message: `${comp.name} 配置已保存并重新加载`,
            });
          } catch (error) {
            return json(res, 503, {
              saved: true,
              reloaded: false,
              error: `配置已保存，但热加载失败：${safeError(error)}`,
            });
          }
        }
        return json(res, 200, {
          saved: true,
          reloaded: false,
          message: `${comp.name} 配置已保存`,
        });
      }
      if (
        rest.length === 2 &&
        rest[1] === 'validate' &&
        req.method === 'POST'
      ) {
        const body = await readBody(req, 1024 * 1024);
        const content = typeof body.content === 'string' ? body.content : '';
        try {
          await validateWith(comp)(content);
          return json(res, 200, {
            valid: true,
            message: `${comp.name} 配置校验通过`,
          });
        } catch (error) {
          return json(res, 422, { valid: false, error: safeError(error) });
        }
      }
      return json(res, 404, { error: '接口不存在' });
    }

    // ---- daemon lifecycle & component actions ----
    if (action === 'action' && req.method === 'POST') {
      const body = await readBody(req);
      const actionName = String(body.action ?? '');
      const daemonActions = Array.isArray(comp.actions.daemon)
        ? comp.actions.daemon
        : [];
      if (!daemonActions.includes(actionName) && !comp.actions[actionName]) {
        return json(res, 400, {
          error: `组件 ${comp.name} 不支持操作 ${actionName}`,
        });
      }
      const name = typeof body.name === 'string' ? body.name : '';
      if (name && !NAME_RE.test(name))
        return json(res, 400, {
          error: '资源名称只能包含字母、数字、点、下划线和短横线',
        });

      // Simple daemon commands without a control socket only know their version.
      if (!comp.ctl) {
        if (actionName !== 'version')
          return json(res, 400, {
            error: `组件 ${comp.name} 没有控制套接字，仅支持 version 操作`,
          });
        const version = await binVersion(comp.bin);
        return json(res, 200, { version });
      }

      const ctl = comp.ctl;
      const baseArgs = [
        '--control-dir',
        comp.controlDir,
        '--daemon-pid',
        comp.pid,
      ];
      const runCtl = async (args) =>
        (
          await execFileAsyncP(ctl, [...baseArgs, ...args], {
            timeout: 8000,
            maxBuffer: 128 * 1024,
          })
        ).stdout.trim();
      const parseList = (text) => {
        if (!text) return [];
        try {
          const decoded = JSON.parse(text);
          return Array.isArray(decoded)
            ? decoded.map(String)
            : [String(decoded)];
        } catch {
          return text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        }
      };

      switch (actionName) {
        case 'version': {
          try {
            return json(res, 200, { version: await runCtl(['version']) });
          } catch {
            return json(res, 200, {
              version: await binVersion(comp.bin),
              connected: false,
            });
          }
        }
        case 'offline': {
          await runCtl(['offline']);
          return json(res, 200, { message: `${comp.name} 已进入离线模式` });
        }
        case 'reload': {
          await runCtl(['reload']);
          return json(res, 200, { message: `${comp.name} 已重新加载` });
        }
        case 'cancel-shutdown': {
          await runCtl(['cancel-shutdown']);
          return json(res, 200, { message: `已取消 ${comp.name} 的关闭流程` });
        }
        case 'list': {
          const resource = String(body.resource ?? body.type ?? '');
          if (!comp.actions.list.includes(resource))
            return json(res, 400, {
              error: `组件 ${comp.name} 不支持列出 ${resource}`,
            });
          return json(res, 200, {
            resource,
            items: parseList(await runCtl(['list', resource])),
          });
        }
        case 'reload-importer':
        case 'reload-collector':
        case 'reload-exporter': {
          if (!name) return json(res, 400, { error: '缺少资源名称 name' });
          await runCtl([actionName, name]);
          return json(res, 200, {
            message: `${actionName.replace('reload-', '')} ${name} 已重新加载`,
          });
        }
        case 'publish-key':
        case 'check-key': {
          const file = String(body.file ?? '');
          if (!file) return json(res, 400, { error: `缺少密钥文件 file` });
          const output = await runCtl([actionName, file]);
          return json(res, 200, {
            message:
              actionName === 'publish-key' ? '密钥已发布' : '密钥校验完成',
            output,
          });
        }
        case 'server-status': {
          if (!name) return json(res, 400, { error: '缺少服务器名称 name' });
          const output = await runCtl(['server', name, 'status']);
          const stats = {};
          for (const line of output.split(/\r?\n/)) {
            const match = /^(\w[\w ]+):\s*(.+)$/.exec(line.trim());
            if (match)
              stats[match[1].trim().replaceAll(/\s+/g, '_')] = match[2].trim();
          }
          return json(res, 200, { server: name, output, stats });
        }
        case 'server-add-metrics-tag': {
          if (!name) return json(res, 400, { error: '缺少服务器名称 name' });
          const tag = String(body.tag ?? body.name ?? '');
          const value = String(body.value ?? '');
          if (!tag || !value)
            return json(res, 400, { error: '缺少 tag/value' });
          await runCtl([
            'server',
            name,
            'add-metrics-tag',
            '--name',
            tag,
            '--value',
            value,
          ]);
          return json(res, 200, {
            message: `已为 ${name} 添加指标标签 ${tag}=${value}`,
          });
        }
        case 'server-get-listen-addr': {
          if (!name) return json(res, 400, { error: '缺少服务器名称 name' });
          const output = await runCtl(['server', name, 'get-listen-addr']);
          const addr =
            /^addr:\s*(.+)$/i.exec(output.trim())?.[1]?.trim() ?? output.trim();
          return json(res, 200, { server: name, addr });
        }
        case 'check-dup': {
          const dir = String(body.dir ?? '');
          const ext = String(body.ext ?? '');
          if (!dir) return json(res, 400, { error: '缺少目录 dir' });
          const args = ['check-dup', dir];
          if (ext) {
            if (!IDENT_RE.test(ext))
              return json(res, 400, { error: '扩展名格式无效' });
            args.push('--ext', ext);
          }
          const output = await runCtl(args);
          return json(res, 200, { message: '重复密钥检查完成', output });
        }
        default: {
          return json(res, 400, {
            error: `组件 ${comp.name} 不支持操作 ${actionName}`,
          });
        }
      }
    }

    // ---- mkcert certificate generation ----
    if (
      comp.slug === 'mkcert' &&
      action === 'generate' &&
      req.method === 'POST'
    ) {
      const body = await readBody(req, 256 * 1024);
      const args = [];
      const type = String(body.type ?? '');
      const mimic =
        typeof body.mimic === 'string' && body.mimic ? body.mimic : null;

      if (mimic) {
        args.push('--mimic', mimic);
      } else {
        if (!CERT_FLAG[type])
          return json(res, 400, {
            error: `证书类型无效，可选：${Object.keys(CERT_FLAG).join('、')}`,
          });
        args.push(CERT_FLAG[type]);
        if (type === 'root') {
          if (!body.commonName)
            return json(res, 400, {
              error: 'root 证书需要 commonName（通用名）',
            });
        } else if (type === 'intermediate') {
          if (!body.caCert || !body.caKey)
            return json(res, 400, {
              error: 'intermediate 证书需要 caCert 与 caKey',
            });
          if (!body.commonName)
            return json(res, 400, {
              error: 'intermediate 证书需要 commonName',
            });
          args.push(
            '--ca-cert',
            String(body.caCert),
            '--ca-key',
            String(body.caKey),
          );
        } else {
          if (!body.caCert || !body.caKey)
            return json(res, 400, { error: '末端证书需要 caCert 与 caKey' });
          const hosts = Array.isArray(body.host)
            ? body.host.map(String).filter(Boolean)
            : typeof body.host === 'string' && body.host
              ? [body.host]
              : [];
          if (hosts.length === 0)
            return json(res, 400, { error: '末端证书需要至少一个 host' });
          args.push(
            '--ca-cert',
            String(body.caCert),
            '--ca-key',
            String(body.caKey),
          );
          for (const host of hosts) args.push('--host', host);
        }
        for (const field of [
          'country',
          'organization',
          'organizationUnit',
          'commonName',
        ]) {
          if (body[field])
            args.push(
              `--${field === 'organizationUnit' ? 'organization-unit' : field === 'commonName' ? 'common-name' : field}`,
              String(body[field]),
            );
        }
        if (body.pathLength !== undefined && body.pathLength !== null) {
          const length = Number(body.pathLength);
          if (!Number.isInteger(length) || length < 0)
            return json(res, 400, { error: 'pathLength 必须是非负整数' });
          args.push('--path-length', String(length));
        }
      }

      const algorithm = String(body.algorithm ?? 'ec256');
      const algorithmSet = new Set(comp.algorithms);
      if (!algorithmSet.has(algorithm))
        return json(res, 400, {
          error: `算法无效，可选：${comp.algorithms.join('、')}`,
        });
      if (algorithm === 'rsa') {
        const bits = Number(body.rsaBits ?? 2048);
        if (!Number.isInteger(bits) || bits < 512 || bits > 8192)
          return json(res, 400, { error: 'rsaBits 必须在 512-8192 之间' });
        args.push('--rsa', String(bits));
      } else {
        args.push(`--${algorithm}`);
      }

      let outputCert =
        typeof body.outputCert === 'string' && body.outputCert
          ? body.outputCert
          : null;
      let outputKey =
        typeof body.outputKey === 'string' && body.outputKey
          ? body.outputKey
          : null;
      let tempDir = null;
      if (!outputCert || !outputKey) {
        tempDir = await mkdtemp(join(tmpdir(), 'vey-mkcert-'));
        const label = `${type || 'mimic'}-${Date.now()}`;
        outputCert = join(tempDir, `${label}.crt.pem`);
        outputKey = join(tempDir, `${label}.key.pem`);
      }
      args.push(
        '--output-cert',
        String(outputCert),
        '--output-key',
        String(outputKey),
      );

      try {
        await execFileAsyncP(comp.bin, args, {
          timeout: 60_000,
          maxBuffer: 256 * 1024,
        });
      } catch (error) {
        if (tempDir)
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        return json(res, 422, { error: safeError(error) });
      }
      const certText = await readFile(outputCert, 'utf8');
      const keyText = await readFile(outputKey, 'utf8');
      if (tempDir)
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return json(res, 200, {
        message: `证书已生成（${type || 'mimic'}，${algorithm}）`,
        type,
        algorithm,
        files: {
          cert: {
            path: outputCert,
            name: basename(outputCert),
            content: certText,
          },
          key: { path: outputKey, name: basename(outputKey), content: keyText },
        },
      });
    }

    // ---- bench run (limited) ----
    if (comp.slug === 'bench' && action === 'run' && req.method === 'POST') {
      const body = await readBody(req);
      const target = String(body.target ?? '');
      if (!comp.targets.includes(target))
        return json(res, 400, {
          error: `压测目标无效，可选：${comp.targets.join('、')}`,
        });
      let argv = body.argv;
      if (!Array.isArray(argv) || argv.length === 0) {
        const url = typeof body.url === 'string' && body.url ? body.url : null;
        if (!url) return json(res, 400, { error: '请提供 URL 或 argv 参数' });
        argv = [url];
      }
      if (argv.length > 16) return json(res, 400, { error: '参数过多' });
      for (const arg of argv) {
        if (typeof arg !== 'string' || arg.length > 2048)
          return json(res, 400, { error: '参数格式无效' });
        if (arg.startsWith('-'))
          return json(res, 400, {
            error: 'argv 只接受位置参数；请在请求中使用专用字段',
          });
      }
      const requests = Number(body.requests ?? 1);
      if (!Number.isInteger(requests) || requests < 1 || requests > 10_000)
        return json(res, 400, { error: 'requests 必须在 1-10000 之间' });
      const timeLimit =
        body.timeLimit === undefined || body.timeLimit === null
          ? null
          : Number(body.timeLimit);
      if (
        timeLimit !== null &&
        (!Number.isFinite(timeLimit) || timeLimit <= 0 || timeLimit > 300)
      )
        return json(res, 400, { error: 'timeLimit 必须在 1-300 秒之间' });
      const concurrency = Number(body.concurrency ?? 1);
      if (
        !Number.isInteger(concurrency) ||
        concurrency < 1 ||
        concurrency > 256
      )
        return json(res, 400, { error: 'concurrency 必须在 1-256 之间' });
      const args = [
        target,
        '--no-progress-bar',
        '--no-summary',
        '-c',
        String(concurrency),
        '-n',
        String(requests),
      ];
      if (timeLimit !== null) args.push('-t', String(timeLimit));
      for (const arg of argv) args.push(arg);
      try {
        const { stdout, stderr } = await execFileAsyncP(comp.bin, args, {
          timeout: Math.min(360_000, (timeLimit ?? 60) * 1000 + 30_000),
          maxBuffer: 4 * 1024 * 1024,
        });
        return json(res, 200, {
          target,
          requests,
          concurrency,
          timeLimit,
          output: (stdout || stderr).trim(),
        });
      } catch (error) {
        return json(res, 422, { error: safeError(error) });
      }
    }

    return json(res, 404, { error: '接口不存在' });
  }

  return handle;
}
