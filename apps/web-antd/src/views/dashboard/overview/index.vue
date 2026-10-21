<script setup lang="ts">
import type { GatewaySnapshot } from '#/api/gateway';

import { computed, onMounted, onUnmounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  message,
  Modal,
  Skeleton,
  Tag,
} from 'ant-design-vue';

import { fetchGatewaySnapshot, reloadGatewayResource } from '#/api/gateway';

const snapshot = ref<GatewaySnapshot>();
const accessStore = useAccessStore();
const loading = ref(true);
const error = ref('');
let timer: ReturnType<typeof setInterval>;

const resourceCount = computed(
  () =>
    (snapshot.value?.servers.length ?? 0) +
    (snapshot.value?.discovers.length ?? 0) +
    (snapshot.value?.backends.length ?? 0),
);
const onlineCount = computed(
  () =>
    Object.values(snapshot.value?.serverStats ?? {}).filter(
      (item) => item.online,
    ).length,
);
const connectionCount = computed(() =>
  Object.values(snapshot.value?.backendConnections ?? {}).reduce(
    (total, value) => total + value,
    0,
  ),
);
const aliveTasks = computed(() =>
  Object.values(snapshot.value?.serverStats ?? {}).reduce(
    (total, item) => total + item.aliveTasks,
    0,
  ),
);

const metrics = computed(() => [
  {
    key: 'online',
    label: '在线服务器',
    value: onlineCount.value,
    suffix: ` / ${snapshot.value?.servers.length ?? '—'}`,
    foot: '来自 vey-gateway-ctl server status',
  },
  {
    key: 'tasks',
    label: '活跃任务',
    value: aliveTasks.value,
    suffix: '',
    foot: '当前服务器活动任务数',
  },
  {
    key: 'connections',
    label: '后端活动连接',
    value: connectionCount.value,
    suffix: '',
    foot: '来自后端控制状态',
  },
  {
    key: 'resources',
    label: '配置资源',
    value: resourceCount.value,
    suffix: '',
    foot: '服务器 · 发现器 · 后端',
  },
]);

async function refresh() {
  try {
    snapshot.value = await fetchGatewaySnapshot(accessStore.accessToken ?? '');
    error.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法连接运维代理';
  } finally {
    loading.value = false;
  }
}

function reloadGateway() {
  Modal.confirm({
    title: '重新加载整个 Gateway？',
    content: 'VEY 会重新读取当前配置并更新运行资源。',
    okText: '确认 reload',
    cancelText: '取消',
    async onOk() {
      try {
        const result = await reloadGatewayResource(
          accessStore.accessToken ?? '',
          'daemon',
        );
        message.success(result.message);
        await refresh();
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : 'Gateway reload 失败',
        );
        throw error;
      }
    },
  });
}

onMounted(() => {
  void refresh();
  timer = setInterval(refresh, 15_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <Page
    title="运行概览"
    description="统一查看网关进程、监听服务器与上游后端的实时状态。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button danger @click="reloadGateway">重载整个 Gateway</Button>
        <Button :loading="loading" type="primary" @click="refresh">
          刷新状态
        </Button>
      </div>
    </template>

    <Alert
      v-if="error"
      type="warning"
      show-icon
      class="mb-4"
      :message="error"
      description="请启动本地运维代理并确认 vey-gateway-ctl 可以访问网关控制 socket。此页面不会展示模拟运行数据。"
    />

    <div class="mb-4 flex items-center gap-2.5 text-sm">
      <span
        class="inline-block size-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100"
        :class="{
          'bg-amber-400 ring-amber-100': !snapshot?.connected,
        }"
      ></span>
      <strong>{{
        snapshot?.connected ? '控制平面已连接' : '等待网关连接'
      }}</strong>
      <Tag v-if="snapshot?.version" color="blue">{{ snapshot.version }}</Tag>
      <span class="ml-auto text-xs text-gray-400">
        {{
          snapshot?.checkedAt
            ? new Date(snapshot.checkedAt).toLocaleString()
            : '尚未获取状态'
        }}
      </span>
    </div>

    <Skeleton v-if="loading && !snapshot" active />
    <template v-else>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card v-for="metric in metrics" :key="metric.key">
          <div class="text-sm text-gray-500">{{ metric.label }}</div>
          <div class="my-3 text-3xl font-semibold tracking-tight">
            {{ metric.value
            }}<small
              v-if="metric.suffix"
              class="text-base font-normal text-gray-400"
              >{{ metric.suffix }}</small>
          </div>
          <div class="text-xs text-gray-400">{{ metric.foot }}</div>
        </Card>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="网关资源">
          <div class="divide-y divide-gray-100 text-sm">
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-blue-500"></span>
              <span>服务器</span>
              <strong class="ml-auto text-base">{{
                snapshot?.servers.length ?? 0
              }}</strong>
            </div>
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-violet-500"></span>
              <span>发现器</span>
              <strong class="ml-auto text-base">{{
                snapshot?.discovers.length ?? 0
              }}</strong>
            </div>
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-emerald-500"></span>
              <span>后端</span>
              <strong class="ml-auto text-base">{{
                snapshot?.backends.length ?? 0
              }}</strong>
            </div>
          </div>
        </Card>
        <Card title="控制平面">
          <p class="text-sm leading-relaxed text-gray-600">
            管理操作通过本机受权限保护的控制 socket 转发到原生 Cap’n Proto
            接口。
          </p>
          <div class="my-4">
            <Tag color="green">本地控制</Tag>
            <Tag>15 秒刷新</Tag>
            <Tag>无模拟数据</Tag>
          </div>
          <p class="text-xs text-gray-400">
            {{
              snapshot?.checkedAt
                ? `最近检查 ${new Date(snapshot.checkedAt).toLocaleTimeString()}`
                : '配置编辑 API 尚未提供'
            }}
          </p>
        </Card>
      </div>
    </template>
  </Page>
</template>
