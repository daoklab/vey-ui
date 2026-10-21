import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: { icon: 'lucide:shield-check', order: 1, title: 'VEY 代理' },
    name: 'ProxyConsole',
    path: '/proxy',
    children: [
      {
        name: 'ProxyUsers',
        path: 'users',
        component: () => import('#/views/proxy/users/index.vue'),
        meta: { icon: 'lucide:users', title: '用户与访问策略' },
      },
      {
        name: 'ProxyListeners',
        path: 'listeners',
        component: () => import('#/views/proxy/listeners/index.vue'),
        meta: { icon: 'lucide:radio-tower', title: '代理入口' },
      },
      {
        name: 'ProxyAudit',
        path: 'audit',
        component: () => import('#/views/proxy/audit/index.vue'),
        meta: { icon: 'lucide:clipboard-list', title: '日志审计' },
      },
      {
        name: 'ProxySystemSettings',
        path: 'system-settings',
        component: () => import('#/views/proxy/system-settings/index.vue'),
        meta: { icon: 'lucide:settings-2', title: '系统配置' },
      },
      {
        name: 'ProxyStatus',
        path: 'status',
        component: () => import('#/views/proxy/status/index.vue'),
        meta: { icon: 'lucide:activity', title: '运行状态' },
      },
      {
        name: 'ProxyEscapers',
        path: 'escapers',
        component: () => import('#/views/proxy/escapers/index.vue'),
        meta: { icon: 'lucide:shuffle', title: '出口管理' },
      },
      {
        name: 'ProxyResolvers',
        path: 'resolvers',
        component: () => import('#/views/proxy/resolvers/index.vue'),
        meta: { icon: 'lucide:search-check', title: '解析器' },
      },
      {
        name: 'ProxySiteGroups',
        path: 'site-groups',
        component: () => import('#/views/proxy/site-groups/index.vue'),
        meta: { icon: 'lucide:layers', title: '站点组' },
      },
      {
        name: 'ProxyTls',
        path: 'tls',
        component: () => import('#/views/proxy/tls/index.vue'),
        meta: { icon: 'lucide:shield-alert', title: '审计与 TLS' },
      },
      {
        name: 'ProxyUserGroups',
        path: 'user-groups',
        component: () => import('#/views/proxy/user-groups/index.vue'),
        meta: { icon: 'lucide:users-round', title: '用户分组' },
      },
    ],
  },
];

export default routes;
