<script setup lang="ts">
import type { SectionTypeOption } from '#/components/vey/vey-section-resource-manager.vue';

import { Page } from '@vben/common-ui';

import VeySectionResourceManager from '#/components/vey/vey-section-resource-manager.vue';

const typeOptions: SectionTypeOption[] = [
  {
    value: 'direct_fixed',
    label: 'direct_fixed',
    template:
      'type: direct_fixed\nresolver: default\nresolve_strategy: Ipv4First\nno_ipv6: true',
    fields:
      '固定直连出口；resolver 指定解析器、resolve_strategy 指定地址选择策略',
  },
  {
    value: 'direct_float',
    label: 'direct_float',
    template: 'type: direct_float\nbind_ipv4: 0.0.0.0\nbind_ipv6: ::',
    fields: '直连动态出口；绑定地址随可用 IP 浮动',
  },
  {
    value: 'proxy_http',
    label: 'proxy_http',
    template:
      'type: proxy_http\nproxy_addr: 127.0.0.1:8080\nproxy_addr_pick_policy: WeightedRandom',
    fields: 'HTTP/S 上行代理出口；proxy_addr 为上游代理地址，可带权重',
  },
  {
    value: 'proxy_https',
    label: 'proxy_https',
    template: 'type: proxy_https\nproxy_addr: 127.0.0.1:8443',
    fields: 'HTTPS 上行代理出口',
  },
  {
    value: 'proxy_socks5',
    label: 'proxy_socks5',
    template: 'type: proxy_socks5\nproxy_addr: 127.0.0.1:1080',
    fields: 'SOCKS5 上行代理出口',
  },
  {
    value: 'proxy_socks5s',
    label: 'proxy_socks5s',
    template: 'type: proxy_socks5s\nproxy_addr: 127.0.0.1:1080',
    fields: 'TLS 封装的 SOCKS5 上行代理出口',
  },
  {
    value: 'proxy_float',
    label: 'proxy_float',
    template: 'type: proxy_float',
    fields: '动态代理池出口；由运行时源提供可用代理列表',
  },
  {
    value: 'route_failover',
    label: 'route_failover',
    template: 'type: route_failover\nroutes: []',
    fields: '故障转移路由；按顺序尝试多个下游出口',
  },
  {
    value: 'route_mapping',
    label: 'route_mapping',
    template: 'type: route_mapping\nroutes: {}',
    fields: '按目标映射到不同出口',
  },
  {
    value: 'route_query',
    label: 'route_query',
    template: 'type: route_query\nroutes: {}',
    fields: '按 DNS 查询结果路由到出口',
  },
  {
    value: 'route_resolved',
    label: 'route_resolved',
    template: 'type: route_resolved\nroutes: {}',
    fields: '按解析后的目标 IP 路由',
  },
  {
    value: 'route_geoip',
    label: 'route_geoip',
    template: 'type: route_geoip\nroutes: {}',
    fields: '按 GeoIP 归属路由',
  },
  {
    value: 'route_select',
    label: 'route_select',
    template: 'type: route_select\nroutes: []',
    fields: '按权重/条件选择出口',
  },
  {
    value: 'route_upstream',
    label: 'route_upstream',
    template: 'type: route_upstream\nroutes: []',
    fields: '按上游规则（域名/子网/正则）匹配出口',
  },
  {
    value: 'route_client',
    label: 'route_client',
    template: 'type: route_client\nroutes: []',
    fields: '按客户端特征路由',
  },
  {
    value: 'comply_context',
    label: 'comply_context',
    template: 'type: comply_context',
    fields: '合规上下文出口；按 egress 索引/上游匹配',
  },
  {
    value: 'comply_audit',
    label: 'comply_audit',
    template: 'type: comply_audit',
    fields: '合规审计出口',
  },
  {
    value: 'trick_float',
    label: 'trick_float',
    template: 'type: trick_float',
    fields: '动态出口池（trick 浮动）',
  },
  {
    value: 'divert_tcp',
    label: 'divert_tcp',
    template: 'type: divert_tcp',
    fields: 'TCP 分流出口（需平台支持）',
  },
  {
    value: 'dummy_deny',
    label: 'dummy_deny',
    template: 'type: dummy_deny',
    fields: '拒绝所有流量的兜底出口',
  },
];
</script>

<template>
  <Page
    title="出口管理"
    description="管理 vey-proxy escaper 配置分区：定义流量从代理发出的方式（直连、上行代理、路由与合规出口）。"
  >
    <VeySectionResourceManager
      section="escaper"
      title="出口"
      :type-options="typeOptions"
      description="每个出口对象必须有 type 字段。下表列出源码支持的全部出口类型；名称由列表上方的“资源名称”决定并在保存时强制并入。"
    />
  </Page>
</template>
