import { defineConfig } from '@vben/vite-config';

import { loadEnv } from 'vite';

export default defineConfig(async (config) => {
  // 读取 .env.* 中的 VITE_GATEWAY_BRIDGE_URL，动态决定本地 vey-gateway 运维桥接器目标，避免硬编码
  const env = loadEnv(config?.mode ?? 'development', process.cwd(), '');
  const bridge = env.VITE_GATEWAY_BRIDGE_URL || 'http://127.0.0.1:8787';
  return {
    application: {},
    vite: {
      server: {
        host: '127.0.0.1',
        proxy: {
          '/gateway-api': {
            changeOrigin: true,
            target: bridge,
            rewrite: (path) => path.replace(/^\/gateway-api/, ''),
          },
          '/api': {
            changeOrigin: true,
            target: bridge,
            ws: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
          },
        },
      },
    },
  };
});
