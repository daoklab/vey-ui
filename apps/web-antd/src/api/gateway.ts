const API = import.meta.env.VITE_GATEWAY_API ?? '/gateway-api';
const AUTH_API = '/api';

export async function loginGateway(username: string, password: string) {
  const response = await fetch(`${AUTH_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '登录失败');
  return result as { accessToken: string };
}

export async function fetchGatewayConfig(token: string) {
  const response = await fetch(`${API}/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '读取配置失败');
  return result as { path: string; content: string };
}

export async function validateGatewayConfig(token: string, content: string) {
  const response = await fetch(`${API}/config/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '配置校验失败');
  return result as { valid: boolean; message: string };
}

export async function saveGatewayConfig(token: string, content: string) {
  const response = await fetch(`${API}/config`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '保存配置失败');
  return result as { message: string };
}

export interface GatewaySnapshot {
  connected: boolean;
  checkedAt: string;
  version?: string;
  servers: string[];
  discovers: string[];
  backends: string[];
  serverStats: Record<
    string,
    {
      online: boolean;
      aliveTasks: number;
      totalConnections: number;
      totalTasks: number;
      reloadable: boolean;
    }
  >;
  discoverReloadable?: Record<string, boolean>;
  backendReloadable?: Record<string, boolean>;
  backendConnections: Record<string, number>;
  error?: string;
}

export async function fetchGatewaySnapshot(token: string) {
  const response = await fetch(`${API}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`运维代理请求失败 (${response.status})`);
  return response.json() as Promise<GatewaySnapshot>;
}

export async function reloadGatewayResource(
  token: string,
  kind: string,
  name?: string,
) {
  const response = await fetch(`${API}/operations/reload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, name }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error ?? `操作失败 (${response.status})`);
  return result as { message: string };
}

// ---------- 全量管理：进程生命周期操作 ----------

export interface GatewayLifecycleActionSpec {
  action: string;
  needsName: boolean;
  message: string;
}

export interface GatewayLifecycleResult {
  ok: boolean;
  action: string;
  name?: string;
  message: string;
  output?: string;
}

async function gatewayRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error ?? `VEY Gateway 请求失败 (${response.status})`);
  return data as T;
}

export function fetchGatewayLifecycle(token: string) {
  return gatewayRequest<{ ok: boolean; actions: GatewayLifecycleActionSpec[] }>(
    token,
    '/gateway/lifecycle',
  );
}

export function runGatewayLifecycle(
  token: string,
  action: string,
  name?: string,
) {
  return gatewayRequest<GatewayLifecycleResult>(token, '/gateway/lifecycle', {
    method: 'POST',
    body: JSON.stringify({ action, name }),
  });
}

// ---------- 全量管理：结构化资源 CRUD（server / discover / backend） ----------

export type GatewayResourceKind = 'backend' | 'discover' | 'server';

export type GatewaySectionLayout =
  | { form: 'directory'; entries: string[] }
  | { form: 'inline'; entries: Record<string, unknown>[] }
  | { form: 'unknown' };

export interface GatewayResourceSummary {
  name: string;
  spec?: Record<string, unknown>;
  path?: string;
}

export interface GatewayResourceResult {
  ok: boolean;
  message: string;
}

export function fetchGatewayResources(token: string) {
  return gatewayRequest<{
    ok: boolean;
    sections: Record<GatewayResourceKind, GatewaySectionLayout>;
  }>(token, '/gateway/resources');
}

export function fetchGatewayResourceCollection(
  token: string,
  kind: GatewayResourceKind,
) {
  return gatewayRequest<{
    ok: boolean;
    kind: GatewayResourceKind;
    form: 'directory' | 'inline';
    resources: GatewayResourceSummary[];
  }>(token, `/gateway/resources/${kind}`);
}

export function fetchGatewayResourceItem(
  token: string,
  kind: GatewayResourceKind,
  name: string,
) {
  return gatewayRequest<{
    ok: boolean;
    kind: GatewayResourceKind;
    name: string;
    form: 'directory' | 'inline';
    spec: Record<string, unknown>;
    specYaml: string;
  }>(token, `/gateway/resources/${kind}/${encodeURIComponent(name)}`);
}

export function createGatewayResource(
  token: string,
  kind: GatewayResourceKind,
  name: string,
  spec: Record<string, unknown>,
) {
  return gatewayRequest<GatewayResourceResult>(
    token,
    `/gateway/resources/${kind}`,
    { method: 'POST', body: JSON.stringify({ name, spec }) },
  );
}

export function createGatewayResourceYaml(
  token: string,
  kind: GatewayResourceKind,
  name: string,
  specYaml: string,
) {
  return gatewayRequest<GatewayResourceResult>(
    token,
    `/gateway/resources/${kind}`,
    { method: 'POST', body: JSON.stringify({ name, specYaml }) },
  );
}

export function updateGatewayResource(
  token: string,
  kind: GatewayResourceKind,
  name: string,
  spec: Record<string, unknown>,
) {
  return gatewayRequest<GatewayResourceResult>(
    token,
    `/gateway/resources/${kind}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify({ spec }) },
  );
}

export function updateGatewayResourceYaml(
  token: string,
  kind: GatewayResourceKind,
  name: string,
  specYaml: string,
) {
  return gatewayRequest<GatewayResourceResult>(
    token,
    `/gateway/resources/${kind}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify({ specYaml }) },
  );
}

export function deleteGatewayResource(
  token: string,
  kind: GatewayResourceKind,
  name: string,
) {
  return gatewayRequest<GatewayResourceResult>(
    token,
    `/gateway/resources/${kind}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}
