<script setup lang="ts">
import type { GatewayLifecycleActionSpec } from '#/api/gateway';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { Alert, Button, Skeleton } from 'ant-design-vue';

import { fetchGatewayLifecycle, runGatewayLifecycle } from '#/api/gateway';
import VeyLifecycleActions from '#/components/vey/vey-lifecycle-actions.vue';

const access = useAccessStore();
const actions = ref<GatewayLifecycleActionSpec[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchGatewayLifecycle(access.accessToken ?? '');
    actions.value = result.actions ?? [];
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : '无法读取生命周期操作';
  } finally {
    loading.value = false;
  }
}

async function run(action: string, name: string) {
  const result = await runGatewayLifecycle(
    access.accessToken ?? '',
    action,
    name || undefined,
  );
  return result.message ?? '操作成功';
}

onMounted(load);
</script>

<template>
  <Page
    title="运行控制"
    description="对 vey-gateway daemon 执行离线、重载、取消关闭、强制退出等生命周期操作。"
  >
    <template #extra>
      <Button :loading="loading" @click="load">刷新</Button>
    </template>
    <Alert
      v-if="error"
      type="warning"
      show-icon
      class="mb-4"
      :message="error"
      description="请确认本地运维代理与网关控制 socket 连接正常。"
    />
    <Skeleton v-if="loading && !actions.length" active />
    <VeyLifecycleActions
      v-else-if="actions.length"
      :actions="actions"
      :run="run"
      title="gateway 生命周期操作"
    />
    <Alert
      v-else
      type="info"
      show-icon
      message="未获取到可用操作，请确认 vey-gateway-ctl 可以访问网关控制 socket。"
    />
  </Page>
</template>
