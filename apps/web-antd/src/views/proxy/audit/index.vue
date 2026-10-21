<script setup lang="ts">
import type { ProxySettings } from '#/api/proxy';

import { onMounted, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  InputNumber,
  message,
  Switch,
} from 'ant-design-vue';

import {
  fetchProxyAuditLog,
  fetchProxySettings,
  saveProxySettings,
} from '#/api/proxy';

const access = useAccessStore();
const token = () => access.accessToken ?? '';

const busy = ref(false);
const settings = ref<ProxySettings>();
const rawLines = ref<string[]>([]);
const rawPath = ref('');

async function load() {
  busy.value = true;
  try {
    settings.value = await fetchProxySettings(token());
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取日志设置失败');
  } finally {
    busy.value = false;
  }
}

async function loadRaw() {
  try {
    const result = await fetchProxyAuditLog(token());
    rawLines.value = result.lines;
    rawPath.value = result.path;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取审计日志失败');
  }
}

// ---------------------------------------------------------------- 日志设置抽屉
const [Drawer, drawerApi] = useVbenDrawer({ onConfirm: save });

const draft = ref<ProxySettings['audit']>();

function edit() {
  if (!settings.value) return;
  draft.value = JSON.parse(JSON.stringify(settings.value.audit));
  drawerApi.open();
}

async function save() {
  if (!settings.value || !draft.value) return;
  const next = JSON.parse(JSON.stringify(settings.value)) as ProxySettings;
  next.audit = draft.value;
  busy.value = true;
  try {
    const result = await saveProxySettings(token(), next);
    settings.value = next;
    drawerApi.close();
    message.success(result.message);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
  void loadRaw();
});
</script>

<template>
  <Page
    title="代理审计日志"
    description="查看 vey-proxy 输出的原始日志，并设置记录哪些访问事件。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button @click="loadRaw">刷新日志</Button>
        <Button type="primary" @click="edit">日志设置</Button>
      </div>
    </template>

    <Alert
      v-if="settings"
      type="info"
      show-icon
      class="mb-4"
      :message="`访问日志：${settings.audit.accessLogs ? '开启' : '关闭'} · 安全审计：${settings.audit.auditLogs ? '开启' : '关闭'} · 审计采样率：${Math.round(settings.audit.taskAuditRatio * 100)}%`"
    />

    <Card title="实时日志输出">
      <pre class="vey-audit-log">{{
        rawLines.join('\n') || '暂时没有捕获到代理日志'
      }}</pre>
      <small class="text-xs text-gray-400">
        日志文件：{{ rawPath || '等待首次启动' }} · 显示最近 1000 行
      </small>
    </Card>

    <Alert
      type="info"
      show-icon
      message="此页直接展示本机代理进程输出的日志原文。由其他方式启动的代理，其日志不会出现在这里。"
    />

    <Drawer
      title="日志记录设置"
      :width="560"
      :confirm-text="busy ? '保存中…' : '保存并应用'"
      :confirm-loading="busy"
    >
      <div v-if="draft" class="grid gap-6">
        <section class="grid gap-3">
          <h3 class="m-0 text-sm font-semibold text-gray-700">记录哪些日志</h3>
          <div
            class="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5"
          >
            <span class="grid gap-0.5">
              <b class="text-sm text-gray-700">访问日志</b>
              <small class="text-xs text-gray-400">记录代理请求及连接结果</small>
            </span>
            <Switch v-model:checked="draft.accessLogs" />
          </div>
          <div
            class="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5"
          >
            <span class="grid gap-0.5">
              <b class="text-sm text-gray-700">安全审计日志</b>
              <small class="text-xs text-gray-400">记录代理安全相关事件</small>
            </span>
            <Switch v-model:checked="draft.auditLogs" />
          </div>
          <div
            class="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5"
          >
            <span class="grid gap-0.5">
              <b class="text-sm text-gray-700">协议检查</b>
              <small class="text-xs text-gray-400">启用额外的协议识别与检查</small>
            </span>
            <Switch v-model:checked="draft.protocolInspection" />
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <h3 class="m-0 text-sm font-semibold text-gray-700">日志详细程度</h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              审计采样比例
              <small class="ml-1 text-xs text-gray-400">0% 不采样，100% 记录全部任务</small>
            </label>
            <InputNumber
              v-model:value="draft.taskAuditRatio"
              :min="0"
              :max="1"
              :step="0.05"
              :formatter="
                (value: string | number | undefined) =>
                  value == null ? '' : `${Math.round(Number(value) * 100)}%`
              "
              :parser="
                (value: string | undefined) =>
                  value?.replace('%', '')
                    ? Number(value.replace('%', '')) / 100
                    : 0
              "
              class="w-full"
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              日志中 URI 最大长度
              <small class="ml-1 text-xs text-gray-400">超过此长度的请求地址会截断；设为 0 表示不限制</small>
            </label>
            <InputNumber
              v-model:value="draft.logUriMaxChars"
              :min="0"
              :max="16384"
              :step="128"
              class="w-full"
            />
          </div>
        </section>
      </div>
    </Drawer>
  </Page>
</template>

<style scoped>
.vey-audit-log {
  max-height: 480px;
  padding: 16px;
  margin: 0 0 8px;
  overflow: auto;
  font:
    12px/1.6 ui-monospace,
    monospace;
  color: #e6edf5;
  word-break: break-word;
  white-space: pre-wrap;
  background: #101828;
  border-radius: 8px;
}
</style>
