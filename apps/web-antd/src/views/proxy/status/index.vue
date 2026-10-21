<script setup lang="ts">
import type { ProxyStatusResponse } from '#/api/proxy';

import { computed, onMounted, onUnmounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { Alert, Button, Card, message, Skeleton, Tag } from 'ant-design-vue';

import { fetchProxyStatus } from '#/api/proxy';

const access = useAccessStore();
const status = ref<ProxyStatusResponse>();
const loading = ref(true);
const error = ref('');
let timer: ReturnType<typeof setInterval>;
const onlineCount = computed(
  () =>
    Object.values(status.value?.serverStats ?? {}).filter((item) => item.online)
      .length,
);

const metrics = computed(() => [
  {
    key: 'servers',
    label: '入口服务器',
    value: status.value?.servers.length ?? 0,
    suffix: ` / ${onlineCount.value} 在线`,
    foot: '来自 vey-proxy-ctl server list & status',
  },
  {
    key: 'tasks',
    label: '活跃任务',
    value: Object.values(status.value?.serverStats ?? {}).reduce(
      (sum, item) => sum + item.aliveTasks,
      0,
    ),
    suffix: '',
    foot: '当前服务器活动任务数',
  },
  {
    key: 'resolvers',
    label: '解析器',
    value: status.value?.resolvers.length ?? 0,
    suffix: '',
    foot: 'resolver 配置分区',
  },
  {
    key: 'sections',
    label: '出口 / 审计 / 站点组',
    value:
      (status.value?.escapers.length ?? 0) +
      (status.value?.auditors.length ?? 0) +
      (status.value?.siteGroups.length ?? 0),
    suffix: '',
    foot: 'escaper · auditor · site-group',
  },
]);

async function refresh() {
  try {
    status.value = await fetchProxyStatus(access.accessToken ?? '');
    error.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法连接运维代理';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
  timer = setInterval(refresh, 15_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <Page
    title="运行状态"
    description="统一查看 vey-proxy 进程、入口服务器、解析器与各配置分区的实时状态。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button
          danger
          @click="
            () => message.info('VEY Proxy 生命周期操作将在全量管理页面提供')
          "
        >
          重载 Proxy
        </Button>
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
      description="此页面不会展示模拟运行数据；请确认 vey-proxy-ctl 可以访问进程控制 socket。"
    />

    <div class="mb-4 flex items-center gap-2.5 text-sm">
      <span
        class="inline-block size-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100"
        :class="{ 'bg-amber-400 ring-amber-100': !status?.connected }"
      ></span>
      <strong>{{
        status?.connected ? '控制平面已连接' : '等待 Proxy 连接'
      }}</strong>
      <Tag v-if="status?.version" color="blue">{{ status.version }}</Tag>
      <span class="ml-auto text-xs text-gray-400">
        {{
          status?.checkedAt
            ? new Date(status.checkedAt).toLocaleString()
            : '尚未获取状态'
        }}
      </span>
    </div>

    <Skeleton v-if="loading && !status" active />
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
        <Card title="入口服务器">
          <div
            v-if="status?.servers.length"
            class="divide-y divide-gray-100 text-sm"
          >
            <div
              v-for="name in status.servers"
              :key="name"
              class="flex items-center gap-3 py-2.5"
            >
              <span
                class="size-1.5 rounded-full"
                :class="
                  status.serverStats[name]?.online
                    ? 'bg-emerald-500'
                    : 'bg-red-500'
                "
              ></span>
              <span class="font-medium">{{ name }}</span>
              <Tag v-if="status.serverStats[name]?.online" color="success">
                在线
              </Tag>
              <Tag v-else color="error">离线</Tag>
              <span class="ml-auto text-xs text-gray-400">
                {{ status.serverStats[name]?.aliveTasks ?? 0 }} 活跃 ·
                {{ status.serverStats[name]?.totalConnections ?? 0 }} 连接
              </span>
            </div>
          </div>
          <p v-else class="py-8 text-center text-sm text-gray-400">
            暂无入口服务器
          </p>
        </Card>
        <Card title="配置分区">
          <div class="divide-y divide-gray-100 text-sm">
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-blue-500"></span>
              <span>用户分组</span>
              <strong class="ml-auto text-base">{{
                status?.groups.length ?? 0
              }}</strong>
            </div>
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-violet-500"></span>
              <span>解析器</span>
              <strong class="ml-auto text-base">{{
                status?.resolvers.length ?? 0
              }}</strong>
            </div>
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-emerald-500"></span>
              <span>出口</span>
              <strong class="ml-auto text-base">{{
                status?.escapers.length ?? 0
              }}</strong>
            </div>
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-amber-500"></span>
              <span>审计器</span>
              <strong class="ml-auto text-base">{{
                status?.auditors.length ?? 0
              }}</strong>
            </div>
            <div class="flex items-center gap-3 py-3">
              <span class="size-1.5 rounded-full bg-cyan-500"></span>
              <span>站点组</span>
              <strong class="ml-auto text-base">{{
                status?.siteGroups.length ?? 0
              }}</strong>
            </div>
          </div>
        </Card>
      </div>

      <p class="mt-4 text-xs text-gray-400">
        运行状态每 15 秒自动刷新，聚合数据来自 vey-proxy-ctl 原生控制协议。
      </p>
    </template>
  </Page>
</template>
