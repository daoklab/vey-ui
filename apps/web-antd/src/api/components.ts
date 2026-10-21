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
    throw new Error(data.error ?? `VEY 组件请求失败 (${response.status})`);
  return data as T;
}

// ---------- 类型定义 ----------

export interface VeyComponentActionSpec {
  needName?: boolean | Record<string, unknown>;
  needFile?: boolean;
  needTag?: boolean;
  needValue?: boolean;
  needDir?: boolean;
  needExt?: boolean;
}

export interface VeyComponent {
  slug: string;
  name: string;
  title: string;
  kind: 'cli' | 'daemon';
  bin: string;
  binPresent: boolean;
  version: null | string;
  ctl: null | string;
  ctlPresent: boolean;
  connected: boolean | null;
  configFile: null | string;
  configPresent: boolean;
  resources: string[];
  actions: {
    daemon: string[];
    list?: string[];
    [key: string]: string[] | undefined | VeyComponentActionSpec;
  };
  certTypes?: null | string[];
  algorithms?: null | string[];
  targets?: null | string[];
}

export interface VeyComponentConfig {
  present: boolean;
  path: string;
  content: string;
  doc?: unknown;
  parseError?: null | string;
}

export interface VeyComponentConfigSaveResult {
  saved: boolean;
  reloaded: boolean;
  message?: string;
  error?: string;
}

export interface VeyComponentValidateResult {
  valid: boolean;
  message?: string;
  error?: string;
}

export interface ComponentActionRequest {
  action: string;
  name?: string;
  resource?: string;
  type?: string;
  file?: string;
  dir?: string;
  ext?: string;
  tag?: string;
  value?: string;
}

export interface ComponentActionResult {
  message?: string;
  output?: string;
  version?: string;
  connected?: boolean;
  resource?: string;
  items?: string[];
  server?: string;
  addr?: string;
  stats?: Record<string, string>;
}

export interface MkcertGenerateRequest {
  type: string;
  mimic?: string;
  commonName?: string;
  caCert?: string;
  caKey?: string;
  host?: string | string[];
  country?: string;
  organization?: string;
  organizationUnit?: string;
  pathLength?: number;
  algorithm?: string;
  rsaBits?: number;
  outputCert?: string;
  outputKey?: string;
}

export interface MkcertGenerateResult {
  message: string;
  type: string;
  algorithm: string;
  files: {
    cert: { path: string; name: string; content: string };
    key: { path: string; name: string; content: string };
  };
}

export interface BenchRunRequest {
  target: string;
  url?: string;
  argv?: string[];
  requests?: number;
  timeLimit?: null | number;
  concurrency?: number;
}

export interface BenchRunResult {
  target: string;
  requests: number;
  concurrency: number;
  timeLimit: null | number;
  output: string;
}

// ---------- API ----------

export const fetchComponents = (token: string) =>
  request<{ components: VeyComponent[] }>(token, '/components');
export const fetchComponent = (token: string, slug: string) =>
  request<VeyComponent>(token, `/components/${encodeURIComponent(slug)}`);
export const fetchComponentConfig = (token: string, slug: string) =>
  request<VeyComponentConfig>(
    token,
    `/components/${encodeURIComponent(slug)}/config`,
  );
export const saveComponentConfig = (
  token: string,
  slug: string,
  content: string,
) =>
  request<VeyComponentConfigSaveResult>(
    token,
    `/components/${encodeURIComponent(slug)}/config`,
    { method: 'PUT', body: JSON.stringify({ content }) },
  );
export const validateComponentConfig = (
  token: string,
  slug: string,
  content: string,
) =>
  request<VeyComponentValidateResult>(
    token,
    `/components/${encodeURIComponent(slug)}/config/validate`,
    { method: 'POST', body: JSON.stringify({ content }) },
  );
export const runComponentAction = (
  token: string,
  slug: string,
  body: ComponentActionRequest,
) =>
  request<ComponentActionResult>(
    token,
    `/components/${encodeURIComponent(slug)}/action`,
    { method: 'POST', body: JSON.stringify(body) },
  );
export const generateMkcert = (token: string, payload: MkcertGenerateRequest) =>
  request<MkcertGenerateResult>(token, '/components/mkcert/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const runBench = (token: string, payload: BenchRunRequest) =>
  request<BenchRunResult>(token, '/components/bench/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
