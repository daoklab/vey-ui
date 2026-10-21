<script setup lang="ts">
import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { Alert } from 'ant-design-vue';

import {
  fetchGatewayConfig,
  saveGatewayConfig,
  validateGatewayConfig,
} from '#/api/gateway';
import VeyConfigEditor from '#/components/vey/vey-config-editor.vue';

const accessStore = useAccessStore();
const path = ref('');

async function load() {
  const result = await fetchGatewayConfig(accessStore.accessToken ?? '');
  path.value = result.path;
  return { path: result.path, content: result.content };
}

async function validate(content: string) {
  const result = await validateGatewayConfig(
    accessStore.accessToken ?? '',
    content,
  );
  return { valid: result.valid, message: result.message };
}

async function save(content: string) {
  const result = await saveGatewayConfig(
    accessStore.accessToken ?? '',
    content,
  );
  return { message: result.message };
}
</script>

<template>
  <Page
    title="配置管理"
    description="编辑当前 Gateway YAML，先用 VEY 原生解析器校验，再保存并热加载。校验失败不会写入文件；reload 失败时会恢复原配置。"
  >
    <Alert
      type="info"
      show-icon
      class="mb-4"
      message="这里管理 Gateway 主配置文件。server / discover / backend 等资源的独立管理请到“网关资源”页面，那里的写入走同一条校验与原子落盘链路。"
    />
    <VeyConfigEditor
      title="Gateway 主配置"
      :path="path"
      :load="load"
      :validate="validate"
      :save="save"
      :height="560"
    />
    <p class="mt-2 text-xs text-gray-400">
      配置保存在运行中 Gateway 指定的本机文件中。外部 include
      文件仍需由部署系统管理。保存操作先校验、再原子写入、最后 reload
      应用；任一环节失败都会明确提示实际状态。
    </p>
  </Page>
</template>
