<script setup lang="ts">
import type { VeyComponent } from '#/api/components';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { Alert, Button, Card, message, Spin, Tag } from 'ant-design-vue';

import {
  fetchComponent,
  fetchComponentConfig,
  runComponentAction,
  saveComponentConfig,
  validateComponentConfig,
} from '#/api/components';
import VeyConfigEditor from '#/components/vey/vey-config-editor.vue';

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
    component.value = await fetchComponent(token(), 'iploc');
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : '无法读取 iploc 组件信息';
  } finally {
    loading.value = false;
  }
}

async function loadConfig() {
  const result = await fetchComponentConfig(token(), 'iploc');
  return {
    path: result.path,
    content: result.content,
    present: result.present,
    parseError: result.parseError,
  };
}

async function validateConfig(content: string) {
  const result = await validateComponentConfig(token(), 'iploc', content);
  return { valid: result.valid, message: result.message, error: result.error };
}

async function saveConfig(content: string) {
  const result = await saveComponentConfig(token(), 'iploc', content);
  return {
    saved: result.saved,
    reloaded: result.reloaded,
    message: result.message,
    error: result.error,
  };
}

async function recheck() {
  try {
    const result = await runComponentAction(token(), 'iploc', {
      action: 'version',
    });
    message.success(result.version ?? '版本信息已获取');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取版本失败');
  } finally {
    await load();
  }
}

onMounted(() => {
  void load();
  void editor.value?.load();
});
</script>

<template>
  <Page
    title="iploc IP 定位服务"
    description="管理 vey-iploc 守护进程：读取、校验与保存配置文件。该组件没有控制套接字，仅支持配置与版本操作。"
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
      description="请确认本地运维代理可访问该组件的二进制与配置文件。"
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
            <div class="text-xs text-gray-400">类型</div>
            <div class="mt-1">
              <Tag>
                {{ component.kind === 'daemon' ? '守护进程' : 'CLI 工具' }}
              </Tag>
            </div>
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
            <div class="text-xs text-gray-400">二进制</div>
            <div class="mt-1">
              <Tag :color="component.binPresent ? 'green' : 'orange'">
                {{ component.binPresent ? '可用' : '缺失' }}
              </Tag>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">控制套接字</div>
            <div class="mt-1">
              <Tag>无（不支持生命周期操作）</Tag>
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
      <div class="mt-4">
        <Button @click="recheck">检测版本</Button>
      </div>
    </Card>

    <VeyConfigEditor
      ref="editor"
      title="iploc 配置"
      :path="component?.configFile ?? ''"
      :load="loadConfig"
      :validate="validateConfig"
      :save="saveConfig"
      :height="520"
    />
    <p class="mt-2 text-xs text-gray-400">
      配置保存会先经 vey-iploc --test-config 校验再原子写入；iploc 没有 ctl
      工具，保存后不会热加载，需要重启进程生效。
    </p>
  </Page>
</template>
