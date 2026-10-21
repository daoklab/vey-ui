<script setup lang="ts">
import type { ProxyResolverQueryResult } from '#/api/proxy';
import type { SectionTypeOption } from '#/components/vey/vey-section-resource-manager.vue';

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
  Select,
  Spin,
  Tag,
} from 'ant-design-vue';

import { queryProxyResolver } from '#/api/proxy';
import VeySectionResourceManager from '#/components/vey/vey-section-resource-manager.vue';

const typeOptions: SectionTypeOption[] = [
  {
    value: 'hickory',
    label: 'hickory',
    template:
      'type: hickory\nserver:\n  - 1.1.1.1\n  - 8.8.8.8\nrequest_timeout: 10s\neach_tries: 2',
    fields: 'Hickory DNS 解析器；server 为上游 DNS 服务器列表',
  },
  {
    value: 'c_ares',
    label: 'c_ares',
    template: 'type: c_ares',
    fields: 'c-ares 解析器（编译启用 c-ares 特性时可用）',
  },
  {
    value: 'deny_all',
    label: 'deny_all',
    template: 'type: deny_all',
    fields: '拒绝一切解析，用于封锁域名',
  },
  {
    value: 'fail_over',
    label: 'fail_over',
    template: 'type: fail_over',
    fields: '故障转移解析器，串联多个下游',
  },
];

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

const resolverOptions = ref<{ label: string; value: string }[]>([]);
const resolverName = ref<string>();
const domain = ref('');
const strategy = ref('Ipv4First');
const delay = ref(50);
const result = ref<ProxyResolverQueryResult>();
const diagBusy = ref(false);
const diagError = ref('');

function onListChange(items: Record<string, unknown>[]) {
  resolverOptions.value = items.map((item) => ({
    label: String(item.name ?? ''),
    value: String(item.name ?? ''),
  }));
  const firstName = items[0] ? String(items[0].name ?? '') : '';
  if (!resolverName.value && firstName) resolverName.value = firstName;
}

async function runQuery() {
  if (!resolverName.value) {
    message.warning('请先选择解析器');
    return;
  }
  if (!domain.value.trim()) {
    message.warning('请输入要查询的域名');
    return;
  }
  diagBusy.value = true;
  diagError.value = '';
  try {
    result.value = await queryProxyResolver(
      token(),
      resolverName.value,
      domain.value.trim(),
      {
        strategy: strategy.value,
        resolutionDelay: delay.value,
      },
    );
  } catch (error) {
    diagError.value = error instanceof Error ? error.message : 'DNS 查询失败';
    result.value = undefined;
  } finally {
    diagBusy.value = false;
  }
}
</script>

<template>
  <Page
    title="解析器"
    description="管理 vey-proxy resolver 配置分区，并对运行中的解析器发起实时 DNS 诊断查询。"
  >
    <VeySectionResourceManager
      section="resolver"
      title="解析器"
      :type-options="typeOptions"
      description="每个解析器必须有 type 字段。名称由列表上方的“资源名称”决定；保存时强制并入。"
      @list-change="onListChange"
    />

    <Card title="DNS 诊断查询" class="mt-4">
      <template #extra>
        <Button type="primary" :loading="diagBusy" @click="runQuery">
          开始查询
        </Button>
      </template>
      <p class="m-0 mb-4 text-sm text-gray-500">
        调用 vey-proxy-ctl resolver &lt;name&gt; query
        &lt;domain&gt;，直接观察运行中解析器的实际解析结果。
      </p>
      <div class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label class="grid gap-1.5 text-xs font-semibold text-gray-600">
          解析器
          <Select
            v-model:value="resolverName"
            :options="resolverOptions"
            placeholder="选择解析器"
            allow-clear
          />
        </label>
        <label class="grid gap-1.5 text-xs font-semibold text-gray-600">
          域名
          <Input
            v-model:value="domain"
            placeholder="例如 example.com"
            allow-clear
            @press-enter="runQuery"
          />
        </label>
        <label class="grid gap-1.5 text-xs font-semibold text-gray-600">
          查询策略
          <Select
            v-model:value="strategy"
            :options="[
              { label: 'IPv4 优先', value: 'Ipv4First' },
              { label: 'IPv6 优先', value: 'Ipv6First' },
              { label: '仅 IPv4', value: 'Ipv4Only' },
              { label: '仅 IPv6', value: 'Ipv6Only' },
            ]"
          />
        </label>
        <label class="grid gap-1.5 text-xs font-semibold text-gray-600">
          解析延迟 (ms)
          <InputNumber
            v-model:value="delay"
            :min="0"
            :max="65535"
            class="w-full"
          />
        </label>
      </div>

      <Alert
        v-if="diagError"
        type="warning"
        show-icon
        class="mb-4"
        :message="diagError"
      />

      <Spin :spinning="diagBusy">
        <div
          v-if="result"
          class="rounded-lg border border-gray-200 bg-gray-50/60 p-4"
        >
          <div class="mb-3 flex items-center gap-2.5">
            <Tag color="blue">{{ result.name }}</Tag>
            <strong class="text-sm">{{ result.domain }}</strong>
            <span class="text-xs text-gray-400">
              共 {{ result.records?.length ?? result.raw?.length ?? 0 }} 条记录
            </span>
          </div>
          <template v-if="result.records?.length">
            <div
              v-for="(record, index) in result.records"
              :key="index"
              class="flex items-baseline gap-2.5 border-b border-gray-100 px-1 py-1.5 text-sm last:border-0"
            >
              <span class="min-w-11 text-[11px] font-bold text-blue-600">{{
                record.kind
              }}</span>
              <code class="text-gray-700">{{ record.value }}</code>
            </div>
          </template>
          <pre
            v-else-if="result.raw?.length"
            class="m-0 rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100"
            >{{ result.raw.join('\n') }}</pre>
          <div v-else class="py-4 text-center text-xs text-gray-400">
            返回结果为空
          </div>
        </div>
        <div
          v-else-if="!diagBusy && !diagError"
          class="py-4 text-center text-xs text-gray-400"
        >
          选择解析器与域名后点击“开始查询”。
        </div>
      </Spin>
    </Card>
  </Page>
</template>
