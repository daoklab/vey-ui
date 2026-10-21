<script setup lang="ts">
import type { VxeTableGridColumns } from '@vben/plugins/vxe-table';

import type { ProxySettings } from '#/api/proxy';
import type { SectionTypeOption } from '#/components/vey/vey-section-resource-manager.vue';

import { computed, onMounted, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Input,
  message,
  Modal,
  Select,
  SelectOption,
  Switch,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { fetchProxySettings, saveProxySettings } from '#/api/proxy';
import VeySectionResourceManager from '#/components/vey/vey-section-resource-manager.vue';

const access = useAccessStore();
const token = () => access.accessToken ?? '';

const view = ref<'full' | 'quick'>('full');

// ---------------------------------------------------------------- 快速入口（quick）
type Listener = ProxySettings['listeners'][number];
type ListenerRow = Listener & { _index: number };

const settings = ref<ProxySettings>();
const busy = ref(false);
const rows = computed<ListenerRow[]>(
  () =>
    settings.value?.listeners.map((record, _index) => ({
      ...record,
      _index,
    })) ?? [],
);

const [Grid] = useVbenVxeGrid<ListenerRow>({
  gridOptions: {
    rowConfig: { keyField: 'name' },
    minHeight: 240,
    columns: [
      { field: 'name', title: '入口名称', minWidth: 160 },
      {
        field: 'protocol',
        title: '协议',
        width: 120,
        slots: { default: 'cell-protocol' },
      },
      { field: 'address', title: '监听地址', minWidth: 190 },
      {
        field: 'udp',
        title: 'UDP Associate',
        width: 130,
        slots: { default: 'cell-udp' },
      },
      {
        field: 'action',
        title: '操作',
        width: 140,
        fixed: 'right',
        slots: { default: 'cell-action' },
      },
    ] as VxeTableGridColumns<ListenerRow>,
  },
});

async function load() {
  busy.value = true;
  try {
    settings.value = await fetchProxySettings(token());
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取代理入口失败');
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------- 新建 / 编辑抽屉
const [Drawer, drawerApi] = useVbenDrawer({ onConfirm: save });

const editing = ref(-1);
const draft = ref<Listener>();
const drawerTitle = computed(() =>
  editing.value < 0 ? '添加代理入口' : `编辑入口 ${draft.value?.name ?? ''}`,
);

function openAdd() {
  editing.value = -1;
  const n = (settings.value?.listeners.length ?? 0) + 1;
  draft.value = {
    name: `proxy-${n}`,
    type: 'http_proxy',
    address: `127.0.0.1:${13_128 + n}`,
    enableUdpAssociate: false,
  };
  drawerApi.open();
}

function openEdit(index: number) {
  editing.value = index;
  draft.value = JSON.parse(
    JSON.stringify(settings.value!.listeners[index]),
  ) as Listener;
  drawerApi.open();
}

async function save() {
  if (!settings.value || !draft.value) return;
  const next = JSON.parse(JSON.stringify(settings.value)) as ProxySettings;
  if (editing.value < 0) next.listeners.push(draft.value);
  else next.listeners[editing.value] = draft.value;
  busy.value = true;
  try {
    const result = await saveProxySettings(token(), next);
    settings.value = next;
    drawerApi.close();
    message.success(result.message);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    busy.value = false;
  }
}

function remove(index: number) {
  const target = settings.value?.listeners[index];
  Modal.confirm({
    title: `删除入口 ${target?.name ?? ''}？`,
    content: '保存后会重建主配置，该入口立即停止监听；此操作不可撤销。',
    okText: '确认删除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    async onOk() {
      if (!settings.value) return;
      const next = JSON.parse(JSON.stringify(settings.value)) as ProxySettings;
      next.listeners.splice(index, 1);
      busy.value = true;
      try {
        const result = await saveProxySettings(token(), next);
        settings.value = next;
        message.success(result.message);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
        throw error;
      } finally {
        busy.value = false;
      }
    },
  });
}

onMounted(load);

// ---------------------------------------------------------------- 全角色 server 分区模板
const serverTypeOptions: SectionTypeOption[] = [
  {
    value: 'dummy_close',
    label: 'dummy_close',
    template: 'type: dummy_close\nlisten:\n  address: 127.0.0.1:19999',
    fields: '直接关闭连接（占位/挡口）',
  },
  {
    value: 'plain_tcp_port',
    label: 'plain_tcp_port',
    template:
      'type: plain_tcp_port\nlisten:\n  address: 127.0.0.1:11000\nlisten_in_worker: false\nserver: tcp-stream-1',
    fields:
      '原始 TCP 转发端口；listen/listen_in_worker/ingress_net_filter/server/proxy_protocol',
  },
  {
    value: 'plain_tls_port',
    label: 'plain_tls_port',
    template:
      'type: plain_tls_port\nlisten:\n  address: 127.0.0.1:11443\nescaper: default\nuser_group: default\nauditor: default\ntls_server: {}\nserver: tls-stream-1',
    fields: 'TLS 终结端口；tls_server/authority 等',
  },
  {
    value: 'native_tls_port',
    label: 'native_tls_port',
    template:
      'type: native_tls_port\nlisten:\n  address: 127.0.0.1:11444\nescaper: default\nuser_group: default\nauditor: default\ntls_server: {}\nserver: tls-stream-1',
    fields: 'TLS 终结端口（旧名，等价 usual_tls_port）',
  },
  {
    value: 'usual_tls_port',
    label: 'usual_tls_port',
    template:
      'type: usual_tls_port\nlisten:\n  address: 127.0.0.1:11445\nlisten_in_worker: false\nescaper: default\nuser_group: default\nauditor: default\ntls_server: {}\nserver: tls-stream-1',
    fields: '常规 TLS 端口；tls_server/authority 等',
  },
  {
    value: 'plain_quic_port',
    label: 'plain_quic_port',
    template:
      'type: plain_quic_port\nlisten:\n  address: 127.0.0.1:11443\nudp_max_packet_size: 1500\nserver: quic-stream-1',
    fields: 'QUIC 端口（编译启用 quic 特性时可用）',
  },
  {
    value: 'intelli_proxy',
    label: 'intelli_proxy',
    template:
      'type: intelli_proxy\nlisten:\n  address: 127.0.0.1:13128\nlisten_in_worker: false\nescaper: default\nuser_group: default\nauditor: default\nenable_dpi: true\nenable_ppdp: true',
    fields: '智能代理（DPI 分流 + PPDP）',
  },
  {
    value: 'tcp_stream',
    label: 'tcp_stream',
    template:
      'type: tcp_stream\nlisten:\n  address: 127.0.0.1:11001\nlisten_in_worker: false\nescaper: default\nproxy_pass:\n  - 10.0.0.2:80\nupstream_pick_policy: round_robin',
    fields:
      'TCP 流代理；proxy_pass/upstream_pick_policy/tcp_conn_speed_limit/tls_client',
  },
  {
    value: 'tcp_tproxy',
    label: 'tcp_tproxy',
    template:
      'type: tcp_tproxy\nlisten:\n  address: 0.0.0.0:11002\nescaper: default\nproxy_pass:\n  - 10.0.0.2:80',
    fields: 'TCP 透明代理（Linux/BSD）',
  },
  {
    value: 'udp_stream',
    label: 'udp_stream',
    template:
      'type: udp_stream\nlisten:\n  address: 127.0.0.1:11003\nlisten_in_worker: false\nescaper: default\nproxy_pass:\n  - 10.0.0.2:53',
    fields: 'UDP 流代理；proxy_pass/udp_max_packet_size',
  },
  {
    value: 'udp_tproxy',
    label: 'udp_tproxy',
    template:
      'type: udp_tproxy\nlisten:\n  address: 0.0.0.0:11004\nescaper: default\nproxy_pass:\n  - 10.0.0.2:53',
    fields: 'UDP 透明代理（Linux/BSD）',
  },
  {
    value: 'tls_stream',
    label: 'tls_stream',
    template:
      'type: tls_stream\nlisten:\n  address: 127.0.0.1:11446\nlisten_in_worker: false\nescaper: default\nauditor: default\ntls_server: {}\nproxy_pass:\n  - 10.0.0.2:443',
    fields: 'TLS 流代理；tls_server/tls_client/proxy_pass',
  },
  {
    value: 'tls_proxy',
    label: 'tls_proxy',
    template:
      'type: tls_proxy\nlisten:\n  address: 127.0.0.1:11447\nlisten_in_worker: false\nescaper: default\nsite_group: default\nauditor: default\ntls_ticketer: {}\nlocal:\n  - example.com',
    fields: 'TLS SNI 反向代理；site_group/local/tls_ticketer',
  },
  {
    value: 'sni_proxy',
    label: 'sni_proxy',
    template:
      'type: sni_proxy\nlisten:\n  address: 127.0.0.1:11448\nlisten_in_worker: false\nhost:\n  "*.example.com":\n    upstream: 10.0.0.2:8443',
    fields: 'SNI 分发代理；host 按域名匹配',
  },
  {
    value: 'socks_proxy',
    label: 'socks_proxy',
    template:
      'type: socks_proxy\nlisten:\n  address: 127.0.0.1:11080\nlisten_in_worker: false\nescaper: default\nuser_group: default\nauditor: default\nenable_udp_associate: true\nnegotiation_timeout: 5s',
    fields:
      'SOCKS5 代理入口；enable_udp_associate/dst_host_filter_set/dst_port_filter',
  },
  {
    value: 'http_proxy',
    label: 'http_proxy',
    template:
      'type: http_proxy\nlisten:\n  address: 127.0.0.1:13128\nlisten_in_worker: false\nescaper: default\nuser_group: default\nauditor: default\nlog_uri_max_chars: 1024\nauth_realm: vey-proxy',
    fields:
      'HTTP 代理入口；dst_host_filter_set/dst_port_filter/allow_custom_host',
  },
  {
    value: 'http_expose',
    label: 'http_expose',
    template:
      'type: http_expose\nlisten:\n  address: 127.0.0.1:13129\nlisten_in_worker: false\nescaper: default\nsite_group: default\nlocal:\n  - example.com\nauth_realm: vey\nenable_tls_server: true',
    fields: 'HTTP 反向暴露；site_group/local/enable_tls_server/server_id',
  },
  {
    value: 'http_guard',
    label: 'http_guard',
    template:
      'type: http_guard\nlisten:\n  address: 127.0.0.1:13130\nlisten_in_worker: false\nescaper: default\nsite_group: default\nlocal:\n  - example.com',
    fields: 'HTTP 拦截防护；site_group/local 等',
  },
];
</script>

<template>
  <Page
    title="代理入口"
    description="全角色管理 vey-proxy server 分区：HTTP/SOCKS 快速入口与 18 类 server 角色完全 CRUD。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button
          :type="view === 'quick' ? 'primary' : 'default'"
          @click="view = 'quick'"
        >
          基础快速入口
        </Button>
        <Button
          :type="view === 'full' ? 'primary' : 'default'"
          @click="view = 'full'"
        >
          全角色 server 分区
        </Button>
      </div>
    </template>

    <template v-if="view === 'quick'">
      <Alert type="info" show-icon class="mb-4">
        <template #message>
          <div class="flex items-center justify-between gap-3">
            <span>
              此视图维护受控的「基础入口」（HTTP Proxy /
              SOCKS5），保存后重建主配置。高可用、TLS
              终结、透明代理等进阶角色请切换到“全角色 server 分区”直接编辑
              YAML。
            </span>
            <Button
              type="primary"
              size="small"
              class="shrink-0"
              @click="openAdd"
            >
              添加入口
            </Button>
          </div>
        </template>
      </Alert>
      <Grid :table-data="rows">
        <template #cell-protocol="{ row }">
          <Tag :color="row.type === 'http_proxy' ? 'blue' : 'purple'">
            {{ row.type === 'http_proxy' ? 'HTTP Proxy' : 'SOCKS5' }}
          </Tag>
        </template>
        <template #cell-udp="{ row }">
          <span v-if="row.type === 'socks_proxy'" class="text-gray-600">
            {{ row.enableUdpAssociate ? '启用' : '关闭' }}
          </span>
          <span v-else class="text-gray-300">—</span>
        </template>
        <template #cell-action="{ row }">
          <Button type="link" size="small" @click="openEdit(row._index)">
            编辑
          </Button>
          <Button type="link" size="small" danger @click="remove(row._index)">
            删除
          </Button>
        </template>
      </Grid>
    </template>

    <VeySectionResourceManager
      v-else
      section="server"
      title="server 分区"
      :type-options="serverTypeOptions"
      description="覆盖 18 类 server 角色（TCP/TLS/UDP/QUIC 端口、流式代理、透明代理、SNI、SOCKS5、HTTP 代理、反向暴露与防护）。每个 server 必须有 type；escaper/user_group/auditor 引用对应分区资源。"
      layout-note="此分区对应主配置 YAML 的 server 数组。新建、编辑或删除后先校验、原子写入并热加载；新增 server 若需要重启级生效会自动降级为 daemon reload，配置始终保存。"
    />

    <Drawer
      :title="drawerTitle"
      :width="600"
      :confirm-text="busy ? '保存中…' : '保存并应用'"
      :confirm-loading="busy"
    >
      <div v-if="draft" class="grid gap-6">
        <section class="grid gap-3">
          <h3 class="m-0 text-sm font-semibold text-gray-700">入口名称</h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">名称</label>
            <Input v-model:value="draft.name" placeholder="例如 office-http" />
            <small class="text-xs text-gray-400">仅用于在控制台中识别这个入口</small>
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <h3 class="m-0 text-sm font-semibold text-gray-700">连接方式</h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">代理协议</label>
            <Select v-model:value="draft.type">
              <SelectOption value="http_proxy">HTTP 代理</SelectOption>
              <SelectOption value="socks_proxy">SOCKS5 代理</SelectOption>
            </Select>
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">监听地址和端口</label>
            <Input
              v-model:value="draft.address"
              placeholder="127.0.0.1:13128"
            />
            <small class="text-xs text-gray-400">格式为 IP:端口；127.0.0.1 仅允许本机连接</small>
          </div>
          <div
            v-if="draft.type === 'socks_proxy'"
            class="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5"
          >
            <span class="grid gap-0.5">
              <b class="text-sm text-gray-700">允许 UDP 转发</b>
              <small class="text-xs text-gray-400">适用于需要 UDP 的客户端；不确定时保持关闭</small>
            </span>
            <Switch v-model:checked="draft.enableUdpAssociate" />
          </div>
        </section>

        <Alert
          type="info"
          show-icon
          message="当前无法单独设置入口的用户或有效期。此入口使用共享用户列表，删除后会立即停止监听。"
        />
      </div>
    </Drawer>
  </Page>
</template>
