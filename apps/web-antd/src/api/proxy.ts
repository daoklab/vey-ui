const API = import.meta.env.VITE_GATEWAY_API ?? '/gateway-api';

async function request<T>(
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
    throw new Error(data.error ?? `VEY Proxy 请求失败 (${response.status})`);
  return data as T;
}

export interface ProxyUser {
  username: string;
  password?: string;
  hasPassword: boolean;
  hostMode: 'allowlist' | 'blocklist' | 'unrestricted';
  exactHosts: string[];
  domainSuffixes: string[];
  portMode: 'allowlist' | 'blocklist' | 'unrestricted';
  ports: number[];
  auditRatio: null | number;
  expire: null | string;
}

export interface ProxySettings {
  system: {
    threadNumber: number;
    serverOfflineDelay: number;
    controllerRecvTimeout: number;
    controllerSendTimeout: number;
    resolverServers: string[];
    resolverRequestTimeout: number;
    resolverTries: number;
    resolveStrategy: 'Ipv4First' | 'Ipv4Only' | 'Ipv6First' | 'Ipv6Only';
    noIpv6: boolean;
  };
  listeners: {
    name: string;
    type: 'http_proxy' | 'socks_proxy';
    address: string;
    enableUdpAssociate: boolean;
  }[];
  syslog: {
    enabled: boolean;
    targetType: 'udp' | 'unix';
    target: string;
    format: 'rfc3164' | 'rfc5424';
    enterpriseId: number;
    messageId: string;
    emitHostname: boolean;
  };
  audit: {
    accessLogs: boolean;
    auditLogs: boolean;
    protocolInspection: boolean;
    taskAuditRatio: number;
    logUriMaxChars: number;
  };
}

export const fetchProxyUsers = (token: string) =>
  request<{ users: ProxyUser[] }>(token, '/proxy/users');
export const saveProxyUsers = (token: string, users: ProxyUser[]) =>
  request<{ users: ProxyUser[]; message: string }>(token, '/proxy/users', {
    method: 'PUT',
    body: JSON.stringify({ users }),
  });
export const fetchProxySettings = (token: string) =>
  request<ProxySettings>(token, '/proxy/settings');
export const saveProxySettings = (token: string, settings: ProxySettings) =>
  request<{ message: string; restarted: boolean }>(token, '/proxy/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
export const fetchProxyAuditLog = (token: string) =>
  request<{ lines: string[]; path: string; updatedAt: string }>(
    token,
    '/proxy/audit-log',
  );
export interface ProxyStatusResponse {
  connected: boolean;
  checkedAt: string;
  version: string;
  groups: string[];
  servers: string[];
  serverStats: Record<
    string,
    { online: boolean; aliveTasks: number; totalConnections: number }
  >;
  resolvers: string[];
  escapers: string[];
  auditors: string[];
  siteGroups: string[];
}

export const fetchProxyStatus = (token: string) =>
  request<ProxyStatusResponse>(token, '/proxy/status');

// ---------- 全量管理：配置分区资源 CRUD ----------

export type ProxyResourceSection =
  | 'auditor'
  | 'escaper'
  | 'resolver'
  | 'server'
  | 'site_group'
  | 'user_group';

export interface ProxyResourcesResponse {
  ok: boolean;
  sections: Record<string, string[]>;
}

export interface ProxyResourceCollection {
  ok: boolean;
  section: ProxyResourceSection;
  items: Record<string, unknown>[];
}

export interface ProxyResourceResult {
  ok: boolean;
  message: string;
}

export const fetchProxyResources = (token: string) =>
  request<ProxyResourcesResponse>(token, '/proxy/resources');
export const fetchProxySectionItems = (
  token: string,
  section: ProxyResourceSection,
) => request<ProxyResourceCollection>(token, `/proxy/resources/${section}`);
export const fetchProxyResourceItem = (
  token: string,
  section: ProxyResourceSection,
  name: string,
) =>
  request<{
    ok: boolean;
    section: ProxyResourceSection;
    name: string;
    spec: Record<string, unknown>;
    specYaml: string;
  }>(token, `/proxy/resources/${section}/${encodeURIComponent(name)}`);
export const createProxyResource = (
  token: string,
  section: ProxyResourceSection,
  name: string,
  spec: Record<string, unknown>,
) =>
  request<ProxyResourceResult>(token, `/proxy/resources/${section}`, {
    method: 'POST',
    body: JSON.stringify({ name, spec }),
  });
export const createProxyResourceYaml = (
  token: string,
  section: ProxyResourceSection,
  name: string,
  specYaml: string,
) =>
  request<ProxyResourceResult>(token, `/proxy/resources/${section}`, {
    method: 'POST',
    body: JSON.stringify({ name, specYaml }),
  });
export const updateProxyResource = (
  token: string,
  section: ProxyResourceSection,
  name: string,
  spec: Record<string, unknown>,
) =>
  request<ProxyResourceResult>(
    token,
    `/proxy/resources/${section}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify({ spec }) },
  );
export const updateProxyResourceYaml = (
  token: string,
  section: ProxyResourceSection,
  name: string,
  specYaml: string,
) =>
  request<ProxyResourceResult>(
    token,
    `/proxy/resources/${section}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify({ specYaml }) },
  );
export const deleteProxyResource = (
  token: string,
  section: ProxyResourceSection,
  name: string,
) =>
  request<ProxyResourceResult>(
    token,
    `/proxy/resources/${section}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );

// ---------- 全量管理：用户分组（静态/动态用户、发布） ----------

export interface ProxyUserGroupUsers {
  ok: boolean;
  group: string;
  kind: 'dynamic' | 'static';
  lines: string[];
  raw: string;
}

export const fetchUserGroupUsers = (
  token: string,
  group: string,
  kind: 'dynamic' | 'static',
) =>
  request<ProxyUserGroupUsers>(
    token,
    `/proxy/user-groups/${encodeURIComponent(group)}/users?kind=${kind}`,
  );
export const publishUserGroup = (
  token: string,
  group: string,
  contents: string,
) =>
  request<{ ok: boolean; group: string; output: string[] }>(
    token,
    `/proxy/user-groups/${encodeURIComponent(group)}/publish`,
    { method: 'POST', body: JSON.stringify({ contents }) },
  );

// ---------- 全量管理：解析器诊断与站点组运行态 ----------

export interface ProxyResolverQueryResult {
  ok: boolean;
  name: string;
  domain: string;
  raw?: string[];
  records?: Array<{ kind: string; value: string }>;
}

export interface ProxySiteGroupUpstreamRow {
  [key: string]: string;
}

export interface ProxySiteGroupResult {
  ok: boolean;
  group: string;
  site: string;
  upstreams?: ProxySiteGroupUpstreamRow[];
  addr?: string;
  weight?: number;
  message?: string;
}

export const queryProxyResolver = (
  token: string,
  name: string,
  domain: string,
  options?: { strategy?: string; resolutionDelay?: number },
) =>
  request<ProxyResolverQueryResult>(token, '/proxy/resolver/query', {
    method: 'POST',
    body: JSON.stringify({ name, domain, ...options }),
  });
export const listSiteGroupUpstream = (
  token: string,
  group: string,
  site: string,
) =>
  request<ProxySiteGroupResult>(
    token,
    `/proxy/site-groups/${encodeURIComponent(group)}/list-upstream`,
    { method: 'POST', body: JSON.stringify({ site }) },
  );
export const setSiteGroupWeight = (
  token: string,
  group: string,
  site: string,
  addr: string,
  weight: number,
) =>
  request<ProxySiteGroupResult>(
    token,
    `/proxy/site-groups/${encodeURIComponent(group)}/set-weight`,
    { method: 'POST', body: JSON.stringify({ site, addr, weight }) },
  );
