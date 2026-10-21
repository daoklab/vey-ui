<script setup lang="ts">
import { Page } from '@vben/common-ui';

import VeySectionResourceManager from '#/components/vey/vey-section-resource-manager.vue';

// auditor 分区没有 type 字段，用 createSample 提供含 TLS 审计字段的初始模板。
const createSample = [
  'name: audit1',
  'task_audit_ratio: 1.0',
  'log_uri_max_chars: 1024',
  'no_proxy_status: false',
  'protocol_inspection: {}',
  'h1_interception: {}',
  'h2_interception: {}',
  'websocket_inspect_policy: {}',
  'smtp_interception: {}',
  'server_tcp_portmap: {}',
  'client_tcp_portmap: {}',
  'tls_cert_agent:',
  '  cert_file: cert.pem',
  '  key_file: key.pem',
  'tls_ticketer:',
  '  file: ticket.key',
  'tls_interception_client:',
  '  cert_file: ca-client.pem',
  '  key_file: ca-client-key.pem',
  'tls_stream_dump:',
  '  file: stream.dump',
].join('\n');

const description = [
  '审计器（auditor）分区条目没有 type 字段，支持的键包括：',
  'task_audit_ratio / log_uri_max_chars / server_id / no_proxy_status、',
  'protocol_inspection / server_tcp_portmap / client_tcp_portmap、',
  'tls_cert_agent（别名 tls_cert_generator）/ tls_ticketer、',
  'tls_interception_client / tls_interception_server / tls_stream_dump、',
  'h1_interception / h2_inspect_policy / h2_interception、',
  'websocket_inspect_policy / smtp_inspect_policy / smtp_interception / imap_inspect_policy / imap_interception、',
  'icap_reqmod_service / icap_respmod_service。',
].join('');
</script>

<template>
  <Page
    title="审计与 TLS"
    description="管理 vey-proxy auditor 配置分区：协议检测、HTTP/1 · HTTP/2 · WebSocket · SMTP 拦截，以及 TLS 证书代理、票据与双向拦截等审计能力。"
  >
    <VeySectionResourceManager
      section="auditor"
      title="审计器"
      :create-sample="createSample"
      :description="description"
      layout-note="此分区内联在主配置 YAML 数组中，新建、编辑或删除后都会先校验、再原子写入、最后热加载 auditor 分区。"
    />
  </Page>
</template>
