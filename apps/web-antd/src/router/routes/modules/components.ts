import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: { icon: 'lucide:boxes', order: 2, title: 'VEY 组件' },
    name: 'VeyComponents',
    path: '/components',
    children: [
      {
        name: 'ComponentsOverview',
        path: 'overview',
        component: () => import('#/views/components/overview/index.vue'),
        meta: { icon: 'lucide:layout-grid', title: '组件总览' },
      },
      {
        name: 'ComponentStatsd',
        path: 'statsd',
        component: () => import('#/views/components/statsd/index.vue'),
        meta: { icon: 'lucide:gauge', title: 'statsd 指标采集' },
      },
      {
        name: 'ComponentKeyless',
        path: 'keyless',
        component: () => import('#/views/components/keyless/index.vue'),
        meta: { icon: 'lucide:key-round', title: 'keyless 密钥服务' },
      },
      {
        name: 'ComponentDcgen',
        path: 'dcgen',
        component: () => import('#/views/components/dcgen/index.vue'),
        meta: { icon: 'lucide:globe', title: 'dcgen 域名收集' },
      },
      {
        name: 'ComponentIploc',
        path: 'iploc',
        component: () => import('#/views/components/iploc/index.vue'),
        meta: { icon: 'lucide:map-pin', title: 'iploc IP 定位' },
      },
      {
        name: 'ComponentMkcert',
        path: 'mkcert',
        component: () => import('#/views/components/mkcert/index.vue'),
        meta: { icon: 'lucide:file-badge', title: 'mkcert 证书生成' },
      },
      {
        name: 'ComponentBench',
        path: 'bench',
        component: () => import('#/views/components/bench/index.vue'),
        meta: { icon: 'lucide:activity', title: 'bench 性能压测' },
      },
    ],
  },
];

export default routes;
