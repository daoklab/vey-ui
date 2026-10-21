# VEY Gateway Console

The console uses the upstream [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) Vue 3/Ant Design application at `apps/web-antd` and is scoped to the `vey-gateway` daemon.

## Development

Requirements: Node.js 22.18+ and pnpm 11, as required by the upstream workspace.

```bash
corepack enable
pnpm install
pnpm dev:antd
```

The UI is served at `http://localhost:5666`. `/gateway-api` is proxied to `http://127.0.0.1:8787` by default. Set `VITE_GATEWAY_BRIDGE_URL` to change the bridge target.

Start the local bridge in a second terminal. The development-only flag enables automatic login form prefill from the owner-only credential file; the bridge itself binds to loopback, and the Vite dev server also binds to loopback.

```bash
VEY_CONSOLE_DEV_CREDENTIALS=true node bridge/server.mjs
```

## Local authentication and management

The console uses the Vben login screen with a local administrator account (`admin`). On first bridge start, a random password is generated and saved to `~/.vey-gateway-console-credentials` with owner-only file permissions. In local development, the login form can prefill those credentials; outside development, automatic prefill is disabled. Sessions expire after eight hours.

The existing daemon exposes management through its permission-checked local Cap’n Proto control socket, consumed by `vey-gateway-ctl`. The loopback bridge provides:

- `GET /snapshot` -> `{ connected, checkedAt, version, servers, discovers, backends, serverStats, backendConnections }`
- `POST /operations/reload` with `{ kind: "server"|"discover"|"backend", name }`
- `GET /config`, `POST /config/validate`, and `PUT /config` for reading, native `vey-gateway --test-config` validation, and save plus daemon reload

All control and configuration routes require the local bearer session. The bridge forwards only fixed operations supported by VEY. It has no generic shell endpoint and binds to loopback. Configuration changes are validated before writing; failed reload restores the previous file. External include files remain deployment-managed.

The bridge targets the configured Gateway binary, control socket, PID, and YAML path through `VEY_GATEWAY_BIN`, `VEY_CONTROL_DIR`, `VEY_GATEWAY_PID`, and `VEY_GATEWAY_CONFIG`. Defaults point to this workspace's local example instance.

## VEY Proxy console

The **VEY Proxy** menu provides form-based controls for dynamic users, VEY user expiration and per-user destination ACLs, multiple HTTP/SOCKS proxy listeners, raw local process logs and audit policy, plus a **System Configuration** page. Its system drawer writes VEY's native `runtime.thread_number` and `server_offline_delay`, local controller receive/send timeouts, Hickory resolver server list/timeouts/retries, and `direct_fixed` outbound resolution strategy/IPv6 behavior, alongside Syslog output. Settings are converted to VEY's native YAML and validated by `vey-proxy --test-config` before saving; when the bridge owns the proxy process, it then restarts it to apply changes. All configured listeners currently share the default user group. VEY supports expiry on individual users, but has no native listener/server expiry setting.

The system form intentionally exposes commonly managed runtime and network settings, not every VEY configuration feature: worker tuning, StatsD, custom resolver/escaper implementations, and arbitrary site/auditor plugin configuration remain outside the visual editor.

Start the bridge with `VEY_PROXY_AUTO_START=true` to initialize and run the local proxy example instance. Proxy configuration, user data, and the Cap’n Proto socket default to `/tmp/vey-proxy-console/` and `/tmp/vey-proxy-console-control/`; override them with `VEY_PROXY_CONFIG`, `VEY_PROXY_USERS_FILE`, `VEY_PROXY_SETTINGS_FILE`, `VEY_PROXY_CONTROL_DIR`, and `VEY_PROXY_AUDIT_LOG`. HTTP and SOCKS listeners bind to loopback by default. Syslog is disabled by default and requires an external receiver when enabled.

The log page shows the last 1000 raw stdout/stderr lines from the locally managed proxy and provides audit policy controls. VEY itself exposes logging drivers rather than a historical log query API; externally managed proxy processes are not captured by this local view.
