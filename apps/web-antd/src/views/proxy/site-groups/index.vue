<script setup lang="ts">
import type { VxeTableGridColumns } from '@vben/plugins/vxe-table';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Spin,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { listSiteGroupUpstream, setSiteGroupWeight } from '#/api/proxy';
import VeySectionResourceManager from '#/components/vey/vey-section-resource-manager.vue';

// site_group 分区没有 type 字段，用 createSample 提供初始模板。
const createSample = [
  'name: example',
  'tenant_user_group: default',
  'imports:',
  '  - site_group: another-group',
  '    tags:',
  '      - tier1',
  'static_sites:',
  "  '*.example.com':",
  '    id: example',
  '    owner: alice',
  '    upstream:',
  '      - 10.0.0.1:8080',
  '      - weight: 80',
  '        value: 10.0.0.2:8080',
].join('\n');

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

// ---------------------------------------------------------------- 分组选择
const groupOptions = ref<{ label: string; value: string }[]>([]);
const group = ref('');
const site = ref('');
const loadedFor = ref('');

function onListChange(items: Record<string, unknown>[]) {
  groupOptions.value = items.map((item) => ({
    label: String(item.name ?? ''),
    value: String(item.name ?? ''),
  }));
}

// ---------------------------------------------------------------- 上游运行态
interface UpstreamRow {
  addr?: string;
  config_weight?: string;
  weight?: string;
}

const upstreams = ref<UpstreamRow[]>([]);
const weightInput = ref<Record<string, string>>({});
const busy = ref(false);
const opError = ref('');

const [UpstreamGrid] = useVbenVxeGrid<UpstreamRow>({
  gridOptions: {
    rowConfig: { keyField: 'addr' },
    minHeight: 160,
    columns: [
      { field: 'addr', title: '上游地址', minWidth: 220 },
      { field: 'config_weight', title: '配置权重', width: 110 },
      { field: 'weight', title: '当前权重', width: 110 },
      {
        field: 'target',
        title: '目标权重',
        width: 180,
        slots: { default: 'cell-target' },
      },
      {
        field: 'action',
        title: '操作',
        width: 90,
        slots: { default: 'cell-action' },
      },
    ] as VxeTableGridColumns<UpstreamRow>,
  },
});

async function loadUpstreams() {
  const g = group.value.trim();
  const s = site.value.trim();
  if (!g) {
    message.warning('请先选择站点组');
    return;
  }
  if (!s) {
    message.warning('请填写 site 标识');
    return;
  }
  busy.value = true;
  opError.value = '';
  try {
    const result = await listSiteGroupUpstream(token(), g, s);
    upstreams.value = result.upstreams ?? [];
    loadedFor.value = `${g} / ${s}`;
    weightInput.value = Object.fromEntries(
      upstreams.value.map((row, index) => [String(index), row.weight ?? '']),
    );
  } catch (error) {
    opError.value = error instanceof Error ? error.message : '查询上游失败';
    upstreams.value = [];
  } finally {
    busy.value = false;
  }
}

function applyWeight(index: number) {
  const row = upstreams.value[index];
  const addr = String(row?.addr ?? '');
  const weight = Number(weightInput.value[String(index)]);
  if (!addr) return;
  if (!Number.isFinite(weight) || weight < 0) {
    message.warning('权重必须是大于等于 0 的数字');
    return;
  }
  const g = group.value.trim();
  const s = site.value.trim();
  Modal.confirm({
    title: '调整上游权重',
    content: `将 ${g} 中 ${s} 的上游 ${addr} 权重调整为 ${weight}？`,
    okText: '确认调整',
    cancelText: '取消',
    async onOk() {
      try {
        const result = await setSiteGroupWeight(token(), g, s, addr, weight);
        message.success(result.message ?? '上游权重已更新');
        await loadUpstreams();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '调整权重失败');
        throw error;
      }
    },
  });
}
</script>

<template>
  <Page
    title="站点组"
    description="管理 vey-proxy site_group 配置分区，并直接观察、调整运行中站点组的 upstream 权重。"
  >
    <VeySectionResourceManager
      section="site_group"
      title="站点组"
      :create-sample="createSample"
      description="站点组用于反向代理类 server（http_expose / http_guard / tls_proxy 等）按 Host/SNI 匹配站点；分区条目没有 type 字段。"
      @list-change="onListChange"
    />

    <Card
      title="上游运行态（list-upstream / set-upstream-weight）"
      class="mt-4"
    >
      <template #extra>
        <Button type="primary" :loading="busy" @click="loadUpstreams">
          查询上游
        </Button>
      </template>
      <p class="m-0 mb-4 text-sm text-gray-500">
        调用 vey-proxy-ctl site-group &lt;name&gt; list-upstream &lt;site&gt;
        读取该站点当前上游地址与权重；可对单条上游调用 set-upstream-weight
        调整运行时权重。
      </p>
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <label class="grid w-64 gap-1.5 text-xs font-semibold text-gray-600">
          站点组
          <Select
            v-model:value="group"
            :options="groupOptions"
            placeholder="选择站点组"
            allow-clear
            show-search
          />
        </label>
        <label class="grid w-64 gap-1.5 text-xs font-semibold text-gray-600">
          site 标识
          <Input
            v-model:value="site"
            placeholder="例如 example"
            allow-clear
            @press-enter="loadUpstreams"
          />
        </label>
        <span v-if="loadedFor" class="ml-auto">
          <Tag color="blue">{{ loadedFor }}</Tag>
        </span>
      </div>

      <Alert
        v-if="opError"
        type="warning"
        show-icon
        class="mb-4"
        :message="opError"
      />

      <Spin :spinning="busy">
        <UpstreamGrid v-if="upstreams.length" :table-data="upstreams">
          <template #cell-target="{ row, rowIndex }">
            <InputNumber
              v-model:value="weightInput[String(rowIndex)]"
              :min="0"
              :step="1"
              class="w-32"
              :placeholder="row.weight"
            />
          </template>
          <template #cell-action="{ rowIndex }">
            <Button type="link" size="small" @click="applyWeight(rowIndex)">
              调整
            </Button>
          </template>
        </UpstreamGrid>
        <div
          v-else-if="!busy && !opError"
          class="py-5 text-center text-xs text-gray-400"
        >
          选择站点组并填写 site 标识后点击“查询上游”。
        </div>
      </Spin>
    </Card>
  </Page>
</template>
