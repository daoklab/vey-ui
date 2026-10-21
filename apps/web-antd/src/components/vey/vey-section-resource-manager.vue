<script setup lang="ts">
import type { ProxyResourceSection } from '#/api/proxy';

import { computed, onMounted, ref } from 'vue';

import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  message,
  Modal,
  Select,
  Spin,
  Tag,
} from 'ant-design-vue';

import {
  createProxyResourceYaml,
  deleteProxyResource,
  fetchProxyResourceItem,
  fetchProxySectionItems,
  updateProxyResourceYaml,
} from '#/api/proxy';

export interface SectionTypeOption {
  value: string;
  label: string;
  template?: string;
  fields?: string;
}

const props = withDefaults(
  defineProps<{
    section: ProxyResourceSection;
    title: string;
    description?: string;
    typeOptions?: SectionTypeOption[];
    createSample?: string;
    layoutNote?: string;
  }>(),
  {
    typeOptions: () => [],
    createSample: '',
    layoutNote:
      '此分区内联在主配置 YAML 中，新建、编辑或删除后都会先校验、再原子写入、最后热加载对应分区。',
  },
);

const emit = defineEmits<{
  'list-change': [items: Record<string, unknown>[]];
}>();

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

// ---------------------------------------------------------------- 列表
const items = ref<Record<string, unknown>[]>([]);
const busy = ref(false);
const error = ref('');
const query = ref('');
const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  return items.value.filter(
    (item) =>
      !q ||
      String(item.name ?? '')
        .toLowerCase()
        .includes(q),
  );
});

async function refresh() {
  busy.value = true;
  error.value = '';
  try {
    const result = await fetchProxySectionItems(token(), props.section);
    items.value = result.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取配置分区失败';
    items.value = [];
  } finally {
    busy.value = false;
  }
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

// ---------------------------------------------------------------- 新建 / 编辑
const open = ref(false);
const editingName = ref('');
const newName = ref('');
const yaml = ref('');
const selectedType = ref<string>();
const saving = ref(false);
const isCreate = computed(() => !editingName.value);
const typeOptionsForSelect = computed(() =>
  props.typeOptions.map((item) => ({ label: item.label, value: item.value })),
);

function onTypeChange(value: unknown) {
  if (!isCreate.value) return;
  const option = props.typeOptions.find((item) => item.value === String(value));
  yaml.value = option?.template ?? `type: ${String(value)}`;
}

function openCreate() {
  editingName.value = '';
  newName.value = '';
  const first = props.typeOptions[0];
  selectedType.value = first?.value;
  yaml.value =
    first?.template ?? (first ? `type: ${first.value}` : props.createSample);
  open.value = true;
}

async function openEdit(row: Record<string, unknown>) {
  open.value = true;
  editingName.value = String(row.name);
  newName.value = String(row.name);
  yaml.value = '';
  selectedType.value = undefined;
  try {
    const item = await fetchProxyResourceItem(
      token(),
      props.section,
      String(row.name),
    );
    yaml.value = item.specYaml ?? '';
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取资源详情失败');
    open.value = false;
  }
}

async function save() {
  const name = newName.value.trim();
  if (!/^[\w.-]{1,128}$/.test(name)) {
    message.warning('资源名称只能包含字母、数字、点、下划线和短横线');
    return;
  }
  if (!yaml.value.trim()) {
    message.warning('请输入资源配置 YAML');
    return;
  }
  saving.value = true;
  try {
    const result = isCreate.value
      ? await createProxyResourceYaml(token(), props.section, name, yaml.value)
      : await updateProxyResourceYaml(
          token(),
          props.section,
          editingName.value,
          yaml.value,
        );
    message.success(result.message);
    open.value = false;
    await refresh();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

function remove(row: Record<string, unknown>) {
  const name = String(row.name);
  Modal.confirm({
    title: `删除${props.title} ${name}？`,
    content:
      '将从主配置 YAML 数组中移除该条目、校验后热加载对应分区；该操作不可撤销。',
    okText: '确认删除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    async onOk() {
      try {
        const result = await deleteProxyResource(token(), props.section, name);
        message.success(result.message);
        await refresh();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
        throw error;
      }
    },
  });
}

onMounted(refresh);
</script>

<template>
  <Card class="vy-section" :bordered="false">
    <template #title>
      <span class="vy-section-title">{{ title }}</span>
    </template>
    <template #extra>
      <Button @click="refresh">刷新分区</Button>
      <Button type="primary" class="create-btn" @click="openCreate">
        新建{{ title }}
      </Button>
    </template>

    <p v-if="description" class="vy-section-desc">{{ description }}</p>
    <Alert
      v-if="error"
      class="vy-alert"
      type="warning"
      show-icon
      :message="error"
      description="请确认本地运维代理与 vey-proxy 控制 socket 连接正常。"
    />

    <div class="vy-toolbar">
      <Input
        v-model:value="query"
        allow-clear
        placeholder="搜索资源名称"
        class="vy-search"
      />
      <span class="vy-count">{{ rows.length }} 项资源</span>
    </div>

    <Spin :spinning="busy">
      <div v-if="rows.length" class="vy-rows">
        <div v-for="row in rows" :key="`${section}:${row.name}`" class="vy-row">
          <div class="vy-icon">
            {{ String(row.name).charAt(0).toUpperCase() }}
          </div>
          <div class="vy-main">
            <div class="vy-title">
              {{ row.name }}
              <Tag v-if="row.type">{{ row.type }}</Tag>
              <Tag color="purple">内联</Tag>
            </div>
            <div class="vy-detail">{{ specSummary(row) || '空配置' }}</div>
          </div>
          <Button size="small" @click="openEdit(row)">编辑</Button>
          <Button size="small" danger @click="remove(row)">删除</Button>
        </div>
      </div>
      <Empty
        v-else-if="!busy && !error"
        :description="`${title}分区还没有资源，点击右上角新建。`"
      />
    </Spin>
    <p class="vy-footnote">{{ layoutNote }}</p>
  </Card>

  <Drawer
    :open="open"
    :title="isCreate ? `新建${title}资源` : `编辑${title} ${editingName}`"
    :width="760"
    @close="open = false"
  >
    <div class="vy-drawer">
      <Alert
        type="info"
        show-icon
        message="资源将写入主配置 YAML 的数组中，保存后整体校验并热加载对应分区。"
        class="vy-drawer-alert"
      />
      <div class="vy-field">
        <label>资源名称</label>
        <Input
          v-model:value="newName"
          :disabled="!isCreate"
          allow-clear
          placeholder="仅限字母、数字、点、下划线和短横线"
          @press-enter="save"
        />
      </div>
      <div v-if="typeOptions.length" class="vy-field">
        <label>资源类型（type）</label>
        <Select
          v-model:value="selectedType"
          :options="typeOptionsForSelect"
          :disabled="!isCreate"
          placeholder="选择类型后自动填充模板"
          @change="onTypeChange"
        />
      </div>
      <div class="vy-field">
        <label>资源配置（YAML 映射，name 字段由上方名称决定）</label>
        <Input.TextArea
          v-model:value="yaml"
          class="vy-yaml"
          :rows="18"
          spellcheck="false"
          placeholder="# YAML 映射内容"
        />
      </div>
      <div v-if="typeOptions.length" class="vy-type-hints">
        <div
          v-for="option in typeOptions"
          :key="option.value"
          class="vy-type-hint"
        >
          <Tag>{{ option.value }}</Tag>
          <span>{{ option.fields ?? '' }}</span>
        </div>
      </div>
      <div class="vy-actions">
        <Button @click="open = false">取消</Button>
        <Button type="primary" :loading="saving" @click="save">
          校验并保存
        </Button>
      </div>
    </div>
  </Drawer>
</template>

<style scoped>
.vy-section {
  border: 1px solid #edf0f2;
  border-radius: 10px;
  box-shadow: 0 3px 16px #15202b06;
}

.vy-section-title {
  font-size: 15px;
  font-weight: 650;
}

.create-btn {
  margin-left: 8px;
}

.vy-section-desc {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #667085;
}

.vy-alert {
  margin-bottom: 12px;
}

.vy-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}

.vy-search {
  max-width: 280px;
}

.vy-count {
  margin-left: auto;
  font-size: 12px;
  color: #8994a1;
}

.vy-rows {
  min-height: 120px;
}

.vy-row {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px 4px;
  border-bottom: 1px solid #f0f2f4;
}

.vy-row:last-child {
  border: 0;
}

.vy-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  font-weight: 700;
  color: #d97b2b;
  background: #fff1e6;
  border-radius: 9px;
}

.vy-main {
  flex: 1;
  min-width: 0;
}

.vy-title {
  font-size: 13px;
  font-weight: 600;
}

.vy-title :deep(.ant-tag) {
  margin-left: 8px;
  font-weight: 400;
}

.vy-detail {
  margin-top: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #84909e;
  white-space: nowrap;
}

.vy-footnote {
  padding: 12px 4px 0;
  margin: 0;
  font-size: 12px;
  color: #919ba7;
}

.vy-drawer {
  display: grid;
  gap: 14px;
}

.vy-drawer-alert {
  margin-bottom: 2px;
}

.vy-field {
  display: grid;
  gap: 6px;
}

.vy-field label {
  font-size: 12px;
  font-weight: 600;
  color: #475467;
}

.vy-yaml {
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border-color: #1e293b;
  border-radius: 8px;
}

.vy-type-hints {
  display: grid;
  gap: 6px;
  max-height: 180px;
  padding: 10px 12px;
  overflow: auto;
  background: #fafbfc;
  border: 1px solid #eef1f4;
  border-radius: 8px;
}

.vy-type-hint {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  line-height: 1.5;
  color: #6b7684;
}

.vy-type-hint :deep(.ant-tag) {
  flex-shrink: 0;
  margin: 0;
}

.vy-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
</style>
