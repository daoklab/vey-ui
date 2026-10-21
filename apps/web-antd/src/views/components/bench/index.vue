<script setup lang="ts">
import type { BenchRunRequest, BenchRunResult } from '#/api/components';

import { onMounted, reactive, ref } from 'vue';

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
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import { fetchComponent, runBench } from '#/api/components';

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

const version = ref<null | string>(null);
const binPresent = ref(false);
const targets = ref<string[]>([]);
const infoError = ref('');

const form = reactive({
  target: 'h1',
  url: '',
  argv: '',
  requests: 1000,
  timeLimit: 10 as number | undefined,
  concurrency: 16,
});

const result = ref<BenchRunResult>();
const running = ref(false);
const runError = ref('');

async function load() {
  infoError.value = '';
  try {
    const comp = await fetchComponent(token(), 'bench');
    targets.value = comp.targets ?? [];
    version.value = comp.version;
    binPresent.value = comp.binPresent;
  } catch (error) {
    infoError.value =
      error instanceof Error ? error.message : '无法读取 bench 组件信息';
  }
}

async function doRun() {
  runError.value = '';
  if (!targets.value.includes(form.target)) {
    message.warning('请选择有效的压测目标');
    return;
  }
  if (
    !Number.isInteger(form.requests) ||
    form.requests < 1 ||
    form.requests > 10_000
  ) {
    message.warning('requests 必须在 1-10000 之间');
    return;
  }
  if (
    !Number.isInteger(form.concurrency) ||
    form.concurrency < 1 ||
    form.concurrency > 256
  ) {
    message.warning('concurrency 必须在 1-256 之间');
    return;
  }
  if (
    form.timeLimit !== null &&
    form.timeLimit !== undefined &&
    (!Number.isFinite(form.timeLimit) ||
      form.timeLimit <= 0 ||
      form.timeLimit > 300)
  ) {
    message.warning('timeLimit 必须在 1-300 秒之间');
    return;
  }

  const argvLines = form.argv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const payload: BenchRunRequest = {
    target: form.target,
    requests: form.requests,
    concurrency: form.concurrency,
    timeLimit: form.timeLimit ?? null,
  };
  if (argvLines.length > 0) {
    payload.argv = argvLines;
  } else {
    const url = form.url.trim();
    if (!url) {
      message.warning('请填写 URL 或 argv 参数');
      return;
    }
    payload.url = url;
  }

  running.value = true;
  result.value = undefined;
  try {
    result.value = await runBench(token(), payload);
    message.success('压测完成');
  } catch (error) {
    runError.value = error instanceof Error ? error.message : '压测执行失败';
    message.error(runError.value);
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Page
    title="bench 性能压测"
    description="使用 vey-bench 对 h1 / h2 / h3 / openssl / rustls / dns / keyless / thrift / websocket 目标执行压测。"
  >
    <template #extra>
      <Button
        :loading="!targets.length && !infoError"
        type="primary"
        @click="load"
      >
        刷新
      </Button>
    </template>

    <Alert
      v-if="infoError"
      type="warning"
      show-icon
      class="mb-4"
      :message="infoError"
      description="请确认本地运维代理可访问 vey-bench 二进制。"
    />

    <Card title="组件信息" class="mb-4">
      <Space wrap>
        <Tag v-if="version" color="blue">{{ version }}</Tag>
        <Tag :color="binPresent ? 'green' : 'orange'">
          {{ binPresent ? '二进制可用' : '缺二进制' }}
        </Tag>
        <Tag>{{ targets.length }} 个压测目标</Tag>
      </Space>
    </Card>

    <Card title="压测参数" class="mb-4">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            目标（target）
          </div>
          <Select
            v-model:value="form.target"
            :options="targets.map((value) => ({ label: value, value }))"
            placeholder="选择压测目标"
            class="w-full"
          />
        </div>
        <div class="md:col-span-2">
          <div class="mb-2 text-xs font-semibold text-gray-600">
            URL（位置参数）
          </div>
          <Input
            v-model:value="form.url"
            allow-clear
            placeholder="例如 https://example.com/（有 argv 时优先使用 argv）"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            请求数（requests，1-10000）
          </div>
          <InputNumber
            v-model:value="form.requests"
            :min="1"
            :max="10000"
            :step="100"
            class="w-full"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            并发数（concurrency，1-256）
          </div>
          <InputNumber
            v-model:value="form.concurrency"
            :min="1"
            :max="256"
            :step="1"
            class="w-full"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            时长上限（timeLimit，1-300 秒，可清空）
          </div>
          <InputNumber
            v-model:value="form.timeLimit"
            :min="1"
            :max="300"
            :step="1"
            class="w-full"
            placeholder="留空表示不限时"
            allow-clear
          />
        </div>
        <div class="md:col-span-2 xl:col-span-3">
          <div class="mb-2 text-xs font-semibold text-gray-600">
            argv 位置参数（每行一个，可选）
          </div>
          <Input.TextArea
            v-model:value="form.argv"
            :rows="3"
            spellcheck="false"
            placeholder="例如&#10;--header Host: example.com&#10;--keep-alive"
          />
        </div>
      </div>
      <div class="mt-5 flex flex-wrap items-center gap-3.5">
        <Button type="primary" size="large" :loading="running" @click="doRun">
          开始压测
        </Button>
        <span class="text-xs text-gray-400">
          命令以 target --no-progress-bar --no-summary -c 并发 -n 请求 [-t 秒]
          ... 执行；压测期间请耐心等待结果。
        </span>
      </div>
    </Card>

    <Card>
      <template #title>
        <div class="flex items-center gap-2">
          <span>压测结果</span>
          <Tag v-if="result" color="blue">{{ result.target }}</Tag>
          <Tag v-if="result">
            requests={{ result.requests }} · concurrency={{ result.concurrency
            }}{{ result.timeLimit ? ` · timeLimit=${result.timeLimit}s` : '' }}
          </Tag>
        </div>
      </template>
      <Alert
        v-if="runError"
        type="warning"
        show-icon
        class="mb-3"
        :message="runError"
      />
      <Spin :spinning="running">
        <pre
          v-if="result"
          class="mb-0 max-h-[520px] overflow-auto rounded-lg bg-slate-900 p-3.5 font-mono text-xs leading-relaxed text-slate-200"
          >{{ result.output }}</pre>
        <div
          v-else-if="!runError"
          class="py-10 text-center text-[13px] text-gray-400"
        >
          设置参数后点击“开始压测”，输出将显示在这里。
        </div>
      </Spin>
    </Card>
  </Page>
</template>
