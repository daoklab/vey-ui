<script setup lang="ts">
import type { VxeTableGridColumns } from '@vben/plugins/vxe-table';

import type {
  GatewayResourceKind,
  GatewayResourceSummary,
  GatewaySectionLayout,
  GatewaySnapshot,
} from '#/api/gateway';

import { computed, onMounted, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Input,
  message,
  Modal,
  Segmented,
  Skeleton,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createGatewayResourceYaml,
  deleteGatewayResource,
  fetchGatewayResourceCollection,
  fetchGatewayResourceItem,
  fetchGatewayResources,
  fetchGatewaySnapshot,
  reloadGatewayResource,
  updateGatewayResourceYaml,
} from '#/api/gateway';

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

// ---------------------------------------------------------------- 运行对象视图
interface LiveRow {
  kind: string;
  label: string;
  name: string;
  online?: boolean;
  reloadable: boolean;
  detail: string;
}

const snapshot = ref<GatewaySnapshot>();
const liveBusy = ref(false);
const liveError = ref('');
const liveQuery = ref('');
const liveKind = ref('all');
const liveRows = computed<LiveRow[]>(() => {
  if (!snapshot.value) return [];
  return [
    ...snapshot.value.servers.map((name) => ({
      kind: 'server',
      label: '服务器',
      name,
      online: snapshot.value?.serverStats[name]?.online,
      reloadable: snapshot.value?.serverStats[name]?.reloadable ?? false,
      detail: `${snapshot.value?.serverStats[name]?.aliveTasks ?? 0} 活跃任务 · ${snapshot.value?.serverStats[name]?.totalConnections ?? 0} 累计连接`,
    })),
    ...snapshot.value.discovers.map((name) => ({
      kind: 'discover',
      label: '发现器',
      name,
      online: undefined,
      reloadable: snapshot.value?.discoverReloadable?.[name] ?? false,
      detail: '上游地址发现资源',
    })),
    ...snapshot.value.backends.map((name) => ({
      kind: 'backend',
      label: '后端',
      name,
      online: true,
      reloadable: snapshot.value?.backendReloadable?.[name] ?? false,
      detail: `${snapshot.value?.backendConnections[name] ?? 0} 活动连接`,
    })),
  ].filter(
    (row) =>
      (liveKind.value === 'all' || row.kind === liveKind.value) &&
      row.name.toLowerCase().includes(liveQuery.value.toLowerCase()),
  );
});

const [LiveGrid] = useVbenVxeGrid<LiveRow>({
  gridOptions: {
    rowConfig: { keyField: 'name' },
    minHeight: 240,
    columns: [
      { field: 'name', title: '名称', minWidth: 200 },
      { field: 'label', title: '类型', width: 90 },
      {
        field: 'online',
        title: '状态',
        width: 90,
        slots: { default: 'live-status' },
      },
      { field: 'detail', title: '详情', minWidth: 240 },
      {
        field: 'action',
        title: '操作',
        width: 130,
        fixed: 'right',
        slots: { default: 'live-action' },
      },
    ] as VxeTableGridColumns<LiveRow>,
  },
});

async function refreshLive() {
  liveBusy.value = true;
  try {
    snapshot.value = await fetchGatewaySnapshot(token());
    liveError.value = '';
  } catch (error) {
    liveError.value =
      error instanceof Error ? error.message : '无法连接运维代理';
  } finally {
    liveBusy.value = false;
  }
}

async function reloadRow(row: LiveRow) {
  try {
    const result = await reloadGatewayResource(token(), row.kind, row.name);
    message.success(result.message || `${row.name} 已重新加载`);
    await refreshLive();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败');
  }
}

// ---------------------------------------------------------------- 资源配置视图
const KIND_LABEL: Record<GatewayResourceKind, string> = {
  server: '服务器',
  discover: '发现器',
  backend: '后端',
};
const KIND_HINT: Record<GatewayResourceKind, string> = {
  server: '监听入站端口并承载代理会话的服务器对象',
  discover: '负责发现后端地址列表的发现器',
  backend: '承载业务流量的后端上游集合',
};

const sections = ref<Record<GatewayResourceKind, GatewaySectionLayout>>();
const kind = ref<GatewayResourceKind>('server');
const resources = ref<GatewayResourceSummary[]>([]);
const cfgBusy = ref(false);
const cfgError = ref('');
const layout = computed(() => sections.value?.[kind.value]);
const layoutText = computed(() => {
  const current = layout.value;
  if (!current) return '';
  if (current.form === 'directory') {
    return `此分区以“目录 + 每资源一个 YAML 文件”的形式管理（${current.entries.length} 个独立文件），新建将写入 ${current.entries.length > 0 ? '同一资源目录' : '资源目录'}，删除会移除对应文件。`;
  }
  if (current.form === 'inline') {
    return `此分区内联在主配置 YAML 的 ${kind.value} 数组中（当前 ${current.entries.length} 项）。新建、编辑或删除都会重写主 YAML 后做整体校验与热加载。`;
  }
  return '此分区的配置格式无法从主 YAML 识别，暂不支持结构化编辑。';
});

const [Grid] = useVbenVxeGrid<GatewayResourceSummary>({
  gridOptions: {
    rowConfig: { keyField: 'name' },
    minHeight: 240,
    columns: [
      {
        field: 'name',
        title: '名称',
        minWidth: 220,
        slots: { default: 'res-name' },
      },
      {
        field: 'layout',
        title: '布局',
        width: 90,
        slots: { default: 'res-layout' },
      },
      {
        field: 'summary',
        title: '配置摘要',
        minWidth: 320,
        slots: { default: 'res-summary' },
      },
      {
        field: 'action',
        title: '操作',
        width: 150,
        fixed: 'right',
        slots: { default: 'res-action' },
      },
    ] as VxeTableGridColumns<GatewayResourceSummary>,
  },
});

async function loadCollection() {
  const result = await fetchGatewayResourceCollection(token(), kind.value);
  resources.value = result.resources;
}

async function refreshCfg() {
  cfgBusy.value = true;
  cfgError.value = '';
  try {
    const layoutResult = await fetchGatewayResources(token());
    sections.value = layoutResult.sections;
    if (layoutResult.sections[kind.value].form === 'unknown') {
      resources.value = [];
      throw new Error(
        `${KIND_LABEL[kind.value]} 配置段格式无法识别，请直接编辑主配置 YAML`,
      );
    }
    await loadCollection();
  } catch (error) {
    cfgError.value =
      error instanceof Error ? error.message : '读取资源配置失败';
  } finally {
    cfgBusy.value = false;
  }
}

function switchKind(value: GatewayResourceKind) {
  kind.value = value;
  void refreshCfg();
}

function specSummary(spec: Record<string, unknown> | undefined): string {
  if (!spec) return '';
  const parts = Object.entries(spec)
    .filter(([key]) => key !== 'name')
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: [${value.length} 项]`;
      if (value && typeof value === 'object') return `${key}: {…}`;
      return `${key}: ${String(value)}`;
    });
  return parts.slice(0, 4).join(' · ') + (parts.length > 4 ? ' …' : '');
}

// ---------------------------------------------------------------- 新建 / 编辑 Drawer
const [Drawer, drawerApi] = useVbenDrawer({
  onConfirm: () => saveDrawer(),
});

const editingName = ref('');
const newName = ref('');
const drawerYaml = ref('');
const drawerBusy = ref(false);
const isCreate = computed(() => !editingName.value);
const drawerTitle = computed(() =>
  isCreate.value
    ? `新建${KIND_LABEL[kind.value]}资源`
    : `编辑${KIND_LABEL[kind.value]} ${editingName.value}`,
);

function openCreate() {
  editingName.value = '';
  newName.value = '';
  drawerYaml.value = '';
  drawerApi.open();
}

async function openEdit(row: GatewayResourceSummary) {
  drawerApi.open();
  editingName.value = row.name;
  newName.value = row.name;
  drawerYaml.value = '';
  try {
    const item = await fetchGatewayResourceItem(token(), kind.value, row.name);
    drawerYaml.value = item.specYaml;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取资源详情失败');
    drawerApi.close();
  }
}

async function saveDrawer() {
  const name = newName.value.trim();
  if (!/^[\w.-]{1,128}$/.test(name)) {
    message.warning('资源名称只能包含字母、数字、点、下划线和短横线');
    return;
  }
  drawerBusy.value = true;
  try {
    const result = isCreate.value
      ? await createGatewayResourceYaml(
          token(),
          kind.value,
          name,
          drawerYaml.value,
        )
      : await updateGatewayResourceYaml(
          token(),
          kind.value,
          editingName.value,
          drawerYaml.value,
        );
    message.success(result.message);
    drawerApi.close();
    await refreshCfg();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    drawerBusy.value = false;
  }
}

function removeRow(row: GatewayResourceSummary) {
  Modal.confirm({
    title: `删除${KIND_LABEL[kind.value]} ${row.name}？`,
    content:
      layout.value?.form === 'inline'
        ? '将从主配置 YAML 数组中移除该条目、校验后热加载；该操作不可撤销。'
        : '将删除该资源对应的独立 YAML 文件，并热加载应用；该操作不可撤销。',
    okText: '确认删除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    async onOk() {
      try {
        const result = await deleteGatewayResource(
          token(),
          kind.value,
          row.name,
        );
        message.success(result.message);
        await refreshCfg();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
        throw error;
      }
    },
  });
}

onMounted(() => {
  void refreshLive();
  void refreshCfg();
});
</script>

<template>
  <Page
    title="网关资源"
    description="查看服务器、发现器与后端对象，直接新建、编辑或删除资源配置，并执行受控热加载。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button :loading="cfgBusy" @click="refreshCfg">刷新配置</Button>
        <Button :loading="liveBusy" type="primary" @click="refreshLive">
          刷新运行状态
        </Button>
      </div>
    </template>

    <Tabs class="vey-resource-tabs" default-active-key="config">
      <TabPane key="config" tab="资源配置">
        <Alert
          v-if="cfgError"
          type="warning"
          show-icon
          class="mb-4"
          :message="cfgError"
          description="请确认本地运维代理与网关控制 socket 连接正常，或直接到“配置管理”修改主 YAML。"
        />
        <Grid :table-data="resources">
          <template #toolbar-actions>
            <Segmented
              :value="kind"
              :options="[
                { value: 'server', label: '服务器' },
                { value: 'discover', label: '发现器' },
                { value: 'backend', label: '后端' },
              ]"
              @change="(value) => switchKind(value as GatewayResourceKind)"
            />
            <span class="text-xs text-gray-400">
              {{ resources.length }} 项资源
            </span>
            <Button
              type="primary"
              :disabled="layout?.form === 'unknown'"
              @click="openCreate"
            >
              新建{{ KIND_LABEL[kind] }}
            </Button>
          </template>
          <template #res-name="{ row }">
            <span class="font-medium">{{ row.name }}</span>
          </template>
          <template #res-layout>
            <Tag v-if="layout?.form === 'directory'" color="blue">文件</Tag>
            <Tag v-else-if="layout?.form === 'inline'" color="purple">内联</Tag>
            <Tag v-else>未知</Tag>
          </template>
          <template #res-summary="{ row }">
            <span class="block max-w-[420px] truncate text-gray-500">
              {{
                specSummary(row.spec) ||
                (row.path ? `独立文件 ${row.path}` : '空配置')
              }}
            </span>
          </template>
          <template #res-action="{ row }">
            <Button type="link" size="small" @click="openEdit(row)">
              编辑
            </Button>
            <Button type="link" size="small" danger @click="removeRow(row)">
              删除
            </Button>
          </template>
        </Grid>
        <p class="mt-2 text-xs text-gray-400">
          {{ KIND_HINT[kind]
          }}<span v-if="layoutText" class="block">{{ layoutText }}</span>
        </p>
        <p class="mt-1 text-xs text-gray-400">
          写入链路与主配置一致：先验证、再原子写入、最后热加载。directory
          布局按资源单独 reload；inline 布局写入主 YAML 后整体
          reload。校验失败不会落盘。
        </p>
      </TabPane>
      <TabPane key="live" tab="运行对象">
        <Alert
          v-if="liveError"
          type="warning"
          show-icon
          class="mb-4"
          :message="liveError"
          description="请确认本地运维代理与网关控制 socket 连接正常。"
        />
        <Skeleton v-if="liveBusy && !snapshot" active />
        <LiveGrid v-else :table-data="liveRows">
          <template #toolbar-actions>
            <Input
              v-model:value="liveQuery"
              allow-clear
              placeholder="搜索资源名称"
              class="w-64"
            />
            <Segmented
              :value="liveKind"
              :options="[
                { value: 'all', label: '全部' },
                { value: 'server', label: '服务器' },
                { value: 'discover', label: '发现器' },
                { value: 'backend', label: '后端' },
              ]"
              @change="(value) => (liveKind = String(value))"
            />
            <span class="text-xs text-gray-400">
              {{ liveRows.length }} 项资源
            </span>
          </template>
          <template #live-status="{ row }">
            <Tag v-if="row.online === true" color="success">在线</Tag>
            <Tag v-else-if="row.online === false" color="error">离线</Tag>
            <span v-else class="text-gray-400">—</span>
          </template>
          <template #live-action="{ row }">
            <Button v-if="row.reloadable" size="small" @click="reloadRow(row)">
              热加载
            </Button>
            <Tag v-else>不可单独加载</Tag>
          </template>
        </LiveGrid>
        <p class="mt-2 text-xs text-gray-400">
          热加载调用 vey-gateway-ctl 原生控制协议。资源级热加载仅对 directory
          布局的独立文件资源可用；内联资源请使用整网 reload。
        </p>
      </TabPane>
    </Tabs>

    <Drawer
      :title="drawerTitle"
      :confirm-text="drawerBusy ? '保存中…' : '校验并保存'"
      :confirm-loading="drawerBusy"
      :width="720"
    >
      <div class="grid gap-4">
        <Alert
          v-if="layout?.form === 'inline'"
          type="info"
          show-icon
          message="资源将写入主配置 YAML 的数组中，保存后整体校验并热加载。"
        />
        <Alert
          v-else
          type="info"
          show-icon
          message="资源将保存为独立 YAML 文件（{名称}.yaml），保存后单独热加载该资源。"
        />
        <div class="grid gap-2">
          <label class="text-sm font-semibold text-gray-700">资源名称</label>
          <Input
            v-model:value="newName"
            :disabled="!isCreate"
            allow-clear
            placeholder="例如 server-a，仅限字母、数字、点、下划线和短横线"
            @press-enter="saveDrawer"
          />
        </div>
        <div class="grid gap-2">
          <label class="text-sm font-semibold text-gray-700">
            资源配置（YAML 映射）
          </label>
          <Input.TextArea
            v-model:value="drawerYaml"
            class="vey-yaml-editor"
            :rows="18"
            spellcheck="false"
            placeholder="# 示例&#10;listen: 0.0.0.0:1080&#10;escaper: default&#10;user_group: default"
          />
        </div>
      </div>
    </Drawer>
  </Page>
</template>

<style scoped>
.vey-resource-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.vey-yaml-editor {
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border-color: #1e293b;
  border-radius: 8px;
}
</style>
