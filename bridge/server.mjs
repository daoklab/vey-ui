import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createComponentsAdmin } from './components-admin.mjs';
import { createGatewayAdmin } from './gateway-admin.mjs';
import { createProxyAdmin, initializeProxyRuntime } from './proxy-admin.mjs';

const execFileAsync = promisify(execFile);
const host = process.env.VEY_BRIDGE_HOST ?? '127.0.0.1';
const port = Number(process.env.VEY_BRIDGE_PORT ?? 8787);
const ctl =
  process.env.VEY_GATEWAY_CTL ??
  new URL('../../vey/target/release-lto/vey-gateway-ctl', import.meta.url)
    .pathname;
const controlDir = process.env.VEY_CONTROL_DIR ?? '/tmp/vey';
const group = process.env.VEY_GATEWAY_GROUP;
const pid = process.env.VEY_GATEWAY_PID ?? '0';
const configFile =
  process.env.VEY_GATEWAY_CONFIG ?? '/tmp/vey-gateway-console.yaml';
const gatewayBin =
  process.env.VEY_GATEWAY_BIN ??
  new URL('../../vey/target/release-lto/vey-gateway', import.meta.url).pathname;
const timeout = Number(process.env.VEY_CTL_TIMEOUT_MS ?? 5000);
const credentialFile =
  process.env.VEY_CONSOLE_CREDENTIALS_FILE ??
  '/Users/xianglin/.vey-gateway-console-credentials';
const exposeDevCredentials = process.env.VEY_CONSOLE_DEV_CREDENTIALS === 'true';
const proxyConfig =
  process.env.VEY_PROXY_CONFIG ?? '/tmp/vey-proxy-console/main.yaml';
const proxyControlDir =
  process.env.VEY_PROXY_CONTROL_DIR ?? '/tmp/vey-proxy-console-control';
const proxyBin =
  process.env.VEY_PROXY_BIN ??
  new URL('../../vey/target/release-lto/vey-proxy', import.meta.url).pathname;
const proxyAuditLog =
  process.env.VEY_PROXY_AUDIT_LOG ?? '/tmp/vey-proxy-console/audit.log';
let proxyChild;
let managedProxyPid = 0;
let password = process.env.VEY_CONSOLE_PASSWORD;
if (!password) {
  try {
    password = (await readFile(credentialFile, 'utf8')).trim();
  } catch {
    password = randomBytes(24).toString('base64url');
    await writeFile(credentialFile, `${password}\n`, { mode: 0o600 });
    await chmod(credentialFile, 0o600);
  }
}
const sessions = new Map();

function ctlArgs(args) {
  return [
    '--control-dir',
    controlDir,
    '--daemon-group',
    group ?? '',
    '--daemon-pid',
    pid,
    ...args,
  ];
}
async function runCtl(args) {
  const { stdout } = await execFileAsync(ctl, ctlArgs(args), {
    timeout,
    maxBuffer: 64 * 1024,
  });
  return stdout.trim();
}
async function list(resource) {
  const value = await runCtl(['list', resource]);
  if (!value) return [];
  try {
    const decoded = JSON.parse(value);
    return Array.isArray(decoded) ? decoded.map(String) : [String(decoded)];
  } catch {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
}
const extraCorsOrigins = new Set(
  (process.env.VEY_CONSOLE_CORS_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
function corsAllow(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}
function corsHeaders(req) {
  const origin = req.headers.origin;
  // 生产构建的本地控制台通常由任意 loopback 端口的静态服务器托管，
  // 允许其直连 bridge；其余来源只放行显式配置的 VEY_CONSOLE_CORS_ORIGIN。
  if (
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)
  ) {
    return corsAllow(origin);
  }
  if (origin && extraCorsOrigins.has(origin)) {
    return corsAllow(origin);
  }
  // 同源请求（无 Origin）或未放行来源：保持原有本地控制台默认来源
  return corsAllow('http://localhost:5666');
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...corsHeaders(res.req),
  });
  res.end(body);
  return true;
}
function authorized(req) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) return false;
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  return true;
}
function readBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        settled = true;
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(data || '{}'));
      } catch {
        settled = true;
        reject(new Error('JSON 格式无效'));
      }
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function restartProxy() {
  if (proxyChild && proxyChild.exitCode === null) {
    const child = proxyChild;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    proxyChild = undefined;
  } else {
    const adoptedPid = Number(process.env.VEY_PROXY_PID ?? 0);
    if (!adoptedPid) return false;
    let command = '';
    try {
      command = (
        await execFileAsync('ps', ['-p', String(adoptedPid), '-o', 'command='])
      ).stdout.trim();
    } catch {
      return false;
    }
    if (!command.includes(proxyBin) || !command.includes(proxyConfig))
      throw new Error(
        '配置已保存，但运行进程与控制台配置不匹配，未重启以避免停止其他服务',
      );
    process.kill(adoptedPid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(adoptedPid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
      process.kill(adoptedPid, 'SIGKILL');
    } catch {}
  }
  await startProxy();
  return true;
}

async function startProxy() {
  await mkdir(dirname(proxyAuditLog), { recursive: true });
  const child = spawn(
    proxyBin,
    ['--control-dir', proxyControlDir, '--config-file', proxyConfig],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proxyChild = child;
  managedProxyPid = child.pid ?? 0;
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      if (lines.length > 0)
        appendFile(proxyAuditLog, `${lines.join('\n')}\n`).catch((error) =>
          console.error(`VEY Proxy log write failed: ${error.message}`),
        );
    });
    stream.on('end', () => {
      if (pending) appendFile(proxyAuditLog, `${pending}\n`).catch(() => {});
    });
  }
  child.once('error', (error) =>
    console.error(`VEY Proxy failed to start: ${error.message}`),
  );
  child.once('exit', (code) => {
    if (proxyChild === child) {
      proxyChild = undefined;
      managedProxyPid = 0;
    }
    console.log(`VEY Proxy exited (${code})`);
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (child.exitCode !== null)
    throw new Error('VEY Proxy 启动失败，请检查配置与监听端口');
}

const proxyAdmin = createProxyAdmin({
  json,
  readBody,
  getProxyPid: () => managedProxyPid || Number(process.env.VEY_PROXY_PID ?? 0),
  restartProxy,
});
const gatewayAdmin = createGatewayAdmin({
  json,
  readBody,
  runCtl,
  configFile,
  controlDir,
  gatewayBin,
});
const componentsAdmin = createComponentsAdmin({ json, readBody });

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health')
      return json(res, 200, { ok: true });
    if (
      req.method === 'GET' &&
      url.pathname === '/auth/dev-credentials' &&
      exposeDevCredentials
    ) {
      return json(res, 200, { username: 'admin', password });
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readBody(req);
      const supplied = Buffer.from(String(body.password ?? ''));
      const expected = Buffer.from(password);
      if (
        body.username !== 'admin' ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return json(res, 401, { error: '用户名或密码错误' });
      const accessToken = randomBytes(32).toString('base64url');
      sessions.set(accessToken, Date.now() + 8 * 60 * 60 * 1000);
      return json(res, 200, { code: 0, data: { accessToken } });
    }
    if (req.method === 'GET' && url.pathname === '/user/info') {
      if (!authorized(req))
        return json(res, 401, { error: '登录已过期，请重新登录' });
      return json(res, 200, {
        code: 0,
        data: {
          userId: 'local-admin',
          username: 'admin',
          realName: 'VEY 管理员',
          avatar: '',
          desc: '本机 VEY Gateway 管理员',
          roles: ['admin'],
          homePath: '/dashboard/overview',
        },
      });
    }
    if (req.method === 'GET' && url.pathname === '/auth/codes') {
      if (!authorized(req))
        return json(res, 401, { error: '登录已过期，请重新登录' });
      return json(res, 200, { code: 0, data: ['vey:gateway:control'] });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (token) sessions.delete(token);
      return json(res, 200, { code: 0, data: { success: true } });
    }
    if (!authorized(req))
      return json(res, 401, { error: '请先登录 VEY 控制台' });
    if (url.pathname.startsWith('/proxy/')) {
      if (await proxyAdmin(req, res, url)) return;
      return json(res, 404, { error: 'VEY Proxy 接口不存在' });
    }
    if (url.pathname.startsWith('/gateway/')) {
      if (await gatewayAdmin(req, res, url)) return;
      return json(res, 404, { error: 'VEY Gateway 接口不存在' });
    }
    if (
      url.pathname === '/components' ||
      url.pathname.startsWith('/components/')
    ) {
      if (await componentsAdmin(req, res, url)) return;
      return json(res, 404, { error: 'VEY 组件接口不存在' });
    }
    if (req.method === 'GET' && url.pathname === '/config') {
      return json(res, 200, {
        path: configFile,
        content: await readFile(configFile, 'utf8'),
      });
    }
    if (req.method === 'POST' && url.pathname === '/config/validate') {
      const { content } = await readBody(req);
      if (typeof content !== 'string' || content.length > 1024 * 1024)
        return json(res, 400, { error: '配置内容无效或超过 1 MB' });
      const candidate = `${configFile}.console-check.yaml`;
      await writeFile(candidate, content, { mode: 0o600 });
      try {
        await execFileAsync(
          gatewayBin,
          [
            '--test-config',
            '--control-dir',
            controlDir,
            '--config-file',
            candidate,
          ],
          { timeout: 15_000, maxBuffer: 256 * 1024 },
        );
      } catch (error) {
        return json(res, 422, {
          error: error.stderr?.trim() || error.message || 'VEY 配置校验失败',
        });
      } finally {
        await import('node:fs/promises').then(({ unlink }) =>
          unlink(candidate).catch(() => {}),
        );
      }
      return json(res, 200, { valid: true, message: 'VEY 配置校验通过' });
    }
    if (req.method === 'PUT' && url.pathname === '/config') {
      const { content } = await readBody(req);
      if (typeof content !== 'string' || content.length > 1024 * 1024)
        return json(res, 400, { error: '配置内容无效或超过 1 MB' });
      const candidate = `${configFile}.console-check.yaml`;
      await writeFile(candidate, content, { mode: 0o600 });
      try {
        await execFileAsync(
          gatewayBin,
          [
            '--test-config',
            '--control-dir',
            controlDir,
            '--config-file',
            candidate,
          ],
          { timeout: 15_000, maxBuffer: 256 * 1024 },
        );
      } catch (error) {
        return json(res, 422, {
          error: error.stderr?.trim() || error.message || 'VEY 配置校验失败',
        });
      } finally {
        await import('node:fs/promises').then(({ unlink }) =>
          unlink(candidate).catch(() => {}),
        );
      }
      const oldConfig = await readFile(configFile);
      const staged = resolve(
        dirname(configFile),
        `.${Date.now()}-${Math.random().toString(16).slice(2)}.yaml`,
      );
      await writeFile(staged, content, { mode: 0o600 });
      await rename(staged, configFile);
      try {
        await runCtl(['reload']);
      } catch (error) {
        await writeFile(configFile, oldConfig, { mode: 0o600 });
        try {
          await runCtl(['reload']);
        } catch {}
        return json(res, 503, {
          error: `配置已回滚，Gateway reload 失败：${error.message}`,
        });
      }
      return json(res, 200, { message: '配置已保存并重新加载' });
    }
    if (req.method === 'GET' && url.pathname === '/snapshot') {
      const [version, servers, discovers, backends] = await Promise.all([
        runCtl(['version']),
        list('server'),
        list('discover'),
        list('backend'),
      ]);
      const serverStats = {};
      const positions = configFile
        ? await readConfigPositions(configFile)
        : { server: new Set(), discover: new Set(), backend: new Set() };
      await Promise.all(
        servers.map(async (name) => {
          try {
            const text = await runCtl(['server', name, 'status']);
            const read = (key) =>
              new RegExp(`^${key}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim();
            serverStats[name] = {
              online: read('online') === 'true',
              aliveTasks: Number(read('alive tasks') ?? 0),
              totalConnections: Number(read('total conn') ?? 0),
              totalTasks: Number(read('total task') ?? 0),
              reloadable: positions.server.has(name),
            };
          } catch {
            serverStats[name] = {
              online: false,
              aliveTasks: 0,
              totalConnections: 0,
              totalTasks: 0,
              reloadable: positions.server.has(name),
            };
          }
        }),
      );
      const backendConnections = {};
      await Promise.all(
        backends.map(async (name) => {
          try {
            backendConnections[name] = Number(
              await runCtl(['backend', name, 'alive-connection']),
            );
          } catch {
            backendConnections[name] = 0;
          }
        }),
      );
      return json(res, 200, {
        connected: true,
        checkedAt: new Date().toISOString(),
        version,
        servers,
        discovers,
        backends,
        serverStats,
        backendConnections,
        discoverReloadable: Object.fromEntries(
          discovers.map((name) => [name, positions.discover.has(name)]),
        ),
        backendReloadable: Object.fromEntries(
          backends.map((name) => [name, positions.backend.has(name)]),
        ),
      });
    }
    if (req.method === 'POST' && url.pathname === '/operations/reload') {
      const { kind, name } = await readBody(req);
      const commands = {
        daemon: ['reload'],
        server: ['reload-server'],
        discover: ['reload-discover'],
        backend: ['reload-backend'],
      };
      if (
        !Object.hasOwn(commands, kind) ||
        (kind !== 'daemon' &&
          (typeof name !== 'string' || !/^[\w.-]{1,128}$/.test(name)))
      )
        return json(res, 400, { error: '操作类型或资源名称无效' });
      await runCtl(
        kind === 'daemon' ? commands[kind] : [...commands[kind], name],
      );
      return json(res, 200, {
        message: `${kind === 'daemon' ? 'Gateway' : `${kind} ${name}`} 已重新加载`,
      });
    }
    return json(res, 404, { error: '接口不存在' });
  } catch (error) {
    return json(res, 503, {
      error: error instanceof Error ? error.message : 'VEY 控制请求失败',
    });
  }
});

async function readConfigPositions(file) {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(file, 'utf8');
  const sections = {
    server: new Set(),
    discover: new Set(),
    backend: new Set(),
  };
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const top = /^(server|discover|backend):\s*(.*?)\s*$/.exec(line);
    if (top) {
      // Inline YAML maps have no source position and vey-gateway-ctl cannot
      // reload them individually. Only path-backed resources support reload.
      section = top[2] && !top[2].startsWith('#') ? top[1] : '';
      continue;
    }
    if (/^[^\s#][^:]*:/.test(line)) {
      section = '';
      continue;
    }
    const match = /^\s+-\s+name:\s*([\w.-]+)\s*(?:#.*)?$/.exec(line);
    if (match && section) sections[section].add(match[1]);
  }
  return sections;
}
server.listen(port, host, () =>
  console.log(
    `VEY bridge listening on http://${host}:${port}; ctl=${ctl}; controlDir=${controlDir}`,
  ),
);
if (process.env.VEY_PROXY_AUTO_START === 'true') {
  initializeProxyRuntime()
    .then(startProxy)
    .catch((error) =>
      console.error(`VEY Proxy startup failed: ${error.message}`),
    );
}
