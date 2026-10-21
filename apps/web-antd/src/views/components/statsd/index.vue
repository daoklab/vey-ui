<script setup lang="ts">
import type { VeyComponent } from '#/api/components';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Select,
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import {
  fetchComponent,
  fetchComponentConfig,
  runComponentAction,
  saveComponentConfig,
  validateComponentConfig,
} from '#/api/components';
import VeyConfigEditor from '#/components/vey/vey-config-editor.vue';
import VeyLifecycleActions from '#/components/vey/vey-lifecycle-actions.vue';

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

const component = ref<VeyComponent>();
const loading = ref(true);
const error = ref('');
const editor = ref<InstanceType<typeof VeyConfigEditor>>();

async function load() {
  loading.value = true;
  error.value = '';
  try {
    component.value = await fetchComponent(token(), 'statsd');
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : '无法读取 statsd 组件信息';
  } finally {
    loading.value = false;
  }
}

async function loadConfig() {
  const result = await fetchComponentConfig(token(), 'statsd');
  return {
    path: result.path,
    content: result.content,
    present: result.present,
    parseError: result.parseError,
  };
}

async function validateConfig(content: string) {
  const result = await validateComponentConfig(token(), 'statsd', content);
  return { valid: result.valid, message: result.message, error: result.error };
}

async function saveConfig(content: string) {
  const result = await saveComponentConfig(token(), 'statsd', content);
  return {
    saved: result.saved,
    reloaded: result.reloaded,
    message: result.message,
    error: result.error,
  };
}

// ---------------------------------------------------------------- 生命周期
const lifecycleActions = [
  { action: 'version', needsName: false, message: '读取 statsd 版本信息' },
  { action: 'reload', needsName: false, message: '重新加载 statsd 配置' },
  {
    action: 'cancel-shutdown',
    needsName: false,
    message: '取消 statsd 关闭流程',
  },
  {
    action: 'offline',
    needsName: false,
    message: '让 statsd 进入离线模式（不可逆）',
  },
];

async function runLifecycle(action: string, name: string) {
  const result = await runComponentAction(token(), 'statsd', {
    action,
    name: name || undefined,
  });
  return result.message ?? result.version ?? '操作成功';
}

// ---------------------------------------------------------------- 资源操作
const resourceOptions = ['importer', 'collector', 'exporter'].map((value) => ({
  label: value,
  value,
}));

const listResource = ref('importer');
const items = ref<string[]>([]);
const listBusy = ref(false);
const listError = ref('');

async function doList() {
  listBusy.value = true;
  listError.value = '';
  try {
    const result = await runComponentAction(token(), 'statsd', {
      action: 'list',
      resource: listResource.value,
    });
    items.value = result.items ?? [];
  } catch (err) {
    listError.value = err instanceof Error ? err.message : '列表查询失败';
    items.value = [];
  } finally {
    listBusy.value = false;
  }
}

const reloadResource = ref('importer');
const reloadName = ref('');
const reloadBusy = ref(false);

async function doReload() {
  const name = reloadName.value.trim();
  if (!name) {
    message.warning('请输入资源名称');
    return;
  }
  reloadBusy.value = true;
  try {
    const result = await runComponentAction(token(), 'statsd', {
      action: `reload-${reloadResource.value}`,
      name,
    });
    message.success(result.message ?? '资源已重新加载');
  } catch (err) {
    message.error(err instanceof Error ? err.message : '重载失败');
  } finally {
    reloadBusy.value = false;
  }
}

onMounted(() => {
  void load();
  void editor.value?.load();
});
</script>

<template>
  <Page
    title="statsd 指标采集"
    description="管理 vey-statsd 守护进程：配置文件、importer / collector / exporter 资源列表与热重载、生命周期操作。"
  >
    <template #extra>
      <Button :loading="loading" type="primary" @click="load">刷新</Button>
    </template>

    <Alert
      v-if="error"
      type="warning"
      show-icon
      class="mb-4"
      :message="error"
      description="请确认本地运维代理与 statsd 控制 socket 连接正常。"
    />

    <Card title="组件信息" class="mb-4">
      <Spin :spinning="loading">
        <div
          v-if="component"
          class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5"
        >
          <div>
            <div class="text-xs text-gray-400">名称</div>
            <div class="mt-1 text-sm text-gray-700">{{ component.name }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-400">版本</div>
            <div class="mt-1">
              <Tag v-if="component.version" color="blue">
                {{ component.version }}
              </Tag>
              <span v-else class="text-sm text-gray-400">未知</span>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">守护进程</div>
            <div class="mt-1">
              <Tag v-if="component.connected === true" color="success">
                在线
              </Tag>
              <Tag v-else-if="component.connected === false" color="error">
                离线
              </Tag>
              <Tag v-else>未检测</Tag>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">二进制 / 控制端</div>
            <div class="mt-1">
              <Tag :color="component.binPresent ? 'green' : 'orange'">
                {{ component.binPresent ? '二进制可用' : '缺二进制' }}
              </Tag>
              <Tag :color="component.ctlPresent ? 'green' : 'orange'">
                {{ component.ctlPresent ? 'ctl 可用' : '缺 ctl' }}
              </Tag>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">配置文件</div>
            <div class="mt-1 break-all font-mono text-xs text-gray-700">
              {{ component.configFile ?? '未指定' }}
            </div>
          </div>
        </div>
      </Spin>
    </Card>

    <Card class="mb-4">
      <VeyLifecycleActions
        title="statsd 生命周期操作"
        :actions="lifecycleActions"
        :run="runLifecycle"
        :loading="loading"
      />
    </Card>

    <Card title="资源操作" class="mb-4">
      <div class="grid gap-6">
        <div>
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm font-semibold text-gray-600">
              资源列表（list）
            </span>
            <Space wrap>
              <Select
                v-model:value="listResource"
                :options="resourceOptions"
                style="width: 160px"
              />
              <Button type="primary" :loading="listBusy" @click="doList">
                查询
              </Button>
            </Space>
          </div>
          <Alert
            v-if="listError"
            class="mb-2"
            type="warning"
            show-icon
            :message="listError"
          />
          <Spin :spinning="listBusy">
            <div v-if="items.length" class="flex flex-wrap gap-1.5">
              <Tag v-for="item in items" :key="item" color="blue">
                {{ item }}
              </Tag>
            </div>
            <p
              v-else-if="!listBusy && !listError"
              class="mb-0 mt-1 text-xs text-gray-400"
            >
              点击“查询”列出所选资源；守护进程离线时查询会失败。
            </p>
          </Spin>
        </div>
        <div>
          <div class="mb-2.5 flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm font-semibold text-gray-600">
              热重载（reload-importer / reload-collector / reload-exporter）
            </span>
            <Space wrap>
              <Select
                v-model:value="reloadResource"
                :options="resourceOptions"
                style="width: 140px"
              />
              <Input
                v-model:value="reloadName"
                allow-clear
                placeholder="资源名称"
                style="width: 200px"
                @press-enter="doReload"
              />
              <Button :loading="reloadBusy" @click="doReload">重载</Button>
            </Space>
          </div>
          <p class="mb-0 text-xs text-gray-400">
            对指定资源执行 vey-statsd-ctl 原生重载；资源名称需与实际配置中的
            importer / collector / exporter 名称一致。
          </p>
        </div>
      </div>
    </Card>

    <VeyConfigEditor
      ref="editor"
      title="statsd 配置"
      :path="component?.configFile ?? ''"
      :load="loadConfig"
      :validate="validateConfig"
      :save="saveConfig"
      :height="520"
    />
    <p class="mt-2 text-xs text-gray-400">
      配置保存会先经 --test-config 校验再原子写入，然后通过 ctl reload
      热加载；daemon
      未运行时保存类端点会提示“配置已保存，但热加载失败”，配置本身已落盘。
    </p>
  </Page>
</template>
