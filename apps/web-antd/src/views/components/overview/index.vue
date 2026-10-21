<script setup lang="ts">
import type { VeyComponent } from '#/api/components';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { Alert, Button, Card, Skeleton, Tag } from 'ant-design-vue';

import { fetchComponents } from '#/api/components';

const access = useAccessStore();
const router = useRouter();
const components = ref<VeyComponent[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchComponents(access.accessToken ?? '');
    components.value = result.components ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法连接运维代理';
  } finally {
    loading.value = false;
  }
}

function open(slug: string) {
  void router.push(`/components/${slug}`);
}

onMounted(load);
</script>

<template>
  <Page
    title="组件总览"
    description="管理 VEY 套件的附属组件：statsd 指标采集、keyless 密钥服务、dcgen 域名收集、iploc IP 定位、mkcert 证书生成与 bench 性能压测。"
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
      description="组件二进制缺失时仍可展示清单，但对应操作会失败。"
    />

    <Skeleton v-if="loading && !components.length" active />
    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card
        v-for="comp in components"
        :key="comp.slug"
        hoverable
        class="cursor-pointer"
        @click="open(comp.slug)"
      >
        <div class="flex items-center gap-3">
          <div
            class="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-sm font-bold text-blue-500"
          >
            {{ comp.slug.slice(0, 2).toUpperCase() }}
          </div>
          <div>
            <div class="font-semibold">{{ comp.title }}</div>
            <div class="mt-0.5 text-xs text-gray-400">{{ comp.name }}</div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-x-1.5 gap-y-1">
          <Tag>{{ comp.kind === 'daemon' ? '守护进程' : 'CLI 工具' }}</Tag>
          <Tag v-if="comp.version" color="blue">{{ comp.version }}</Tag>
          <Tag
            v-if="comp.kind === 'daemon' && comp.connected === true"
            color="success"
          >
            在线
          </Tag>
          <Tag
            v-else-if="comp.kind === 'daemon' && comp.connected === false"
            color="error"
          >
            离线
          </Tag>
          <Tag v-else-if="comp.kind === 'daemon'">未检测</Tag>
          <Tag v-if="comp.binPresent" color="green">二进制可用</Tag>
          <Tag v-else color="orange">缺二进制</Tag>
        </div>
        <p class="mt-3 text-xs text-gray-400">
          {{
            comp.configFile
              ? `配置文件：${comp.configFile}`
              : '无配置文件（一次性 CLI）'
          }}
        </p>
        <div class="mt-3">
          <Button type="link">进入管理</Button>
        </div>
      </Card>
    </div>
  </Page>
</template>
