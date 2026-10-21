import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:layout-dashboard',
      order: -1,
      title: 'VEY 网关',
    },
    name: 'Dashboard',
    path: '/dashboard',
    children: [
      {
        name: 'GatewayOverview',
        path: 'overview',
        component: () => import('#/views/dashboard/overview/index.vue'),
        meta: {
          affixTab: true,
          icon: 'lucide:activity',
          title: '运行概览',
        },
      },
      {
        name: 'GatewayLifecycle',
        path: 'lifecycle',
        component: () => import('#/views/dashboard/lifecycle/index.vue'),
        meta: {
          icon: 'lucide:power',
          title: '运行控制',
        },
      },
      {
        name: 'GatewayResources',
        path: 'resources',
        component: () => import('#/views/dashboard/resources/index.vue'),
        meta: {
          icon: 'lucide:network',
          title: '网关资源',
        },
      },
      {
        name: 'GatewayConfiguration',
        path: 'configuration',
        component: () => import('#/views/dashboard/configuration/index.vue'),
        meta: {
          icon: 'lucide:file-code-2',
          title: '配置管理',
        },
      },
    ],
  },
];

export default routes;
