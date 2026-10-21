<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Space,
  Tag,
} from 'ant-design-vue';

export interface ConfigLoadResult {
  present?: boolean;
  path?: string;
  content: string;
  parseError?: null | string;
}

export interface ConfigValidateResult {
  valid: boolean;
  message?: string;
  error?: string;
}

export interface ConfigSaveResult {
  saved?: boolean;
  reloaded?: boolean;
  message?: string;
  error?: string;
}

const props = defineProps<{
  title?: string;
  path?: string;
  description?: string;
  height?: number;
  load: () => Promise<ConfigLoadResult>;
  validate?: (content: string) => Promise<ConfigValidateResult>;
  save: (content: string) => Promise<ConfigSaveResult>;
}>();

const content = ref('');
const original = ref('');
const loading = ref(false);
const validating = ref(false);
const saving = ref(false);
const error = ref('');
const validateResult = ref<ConfigValidateResult>();
const saveResult = ref<ConfigSaveResult>();
const dirty = computed(() => content.value !== original.value);

async function load() {
  loading.value = true;
  error.value = '';
  validateResult.value = undefined;
  saveResult.value = undefined;
  try {
    const result = await props.load();
    content.value = result.content ?? '';
    original.value = content.value;
    if (result.parseError)
      validateResult.value = {
        valid: false,
        error: `YAML 解析失败：${result.parseError}`,
      };
    if (result.present === false)
      message.warning('配置文件尚不存在，首次保存时将创建它');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取配置失败';
  } finally {
    loading.value = false;
  }
}

async function doValidate() {
  if (!props.validate) return;
  validating.value = true;
  error.value = '';
  saveResult.value = undefined;
  try {
    validateResult.value = await props.validate(content.value);
  } catch (error) {
    validateResult.value = {
      valid: false,
      error: error instanceof Error ? error.message : '校验失败',
    };
  } finally {
    validating.value = false;
  }
}

async function doSave() {
  saving.value = true;
  error.value = '';
  validateResult.value = undefined;
  saveResult.value = undefined;
  try {
    const result = await props.save(content.value);
    saveResult.value = result;
    if (result.error) {
      message.warning(result.message ?? '配置已保存，但热加载失败');
    } else {
      original.value = content.value;
      message.success(result.message ?? '配置已保存');
    }
  } catch (error) {
    saveResult.value = {
      error: error instanceof Error ? error.message : '保存失败',
    };
  } finally {
    saving.value = false;
  }
}

defineExpose({ load });
</script>

<template>
  <Card class="vy-config" :bordered="false" :loading="loading">
    <template #title>
      <Space size="middle" wrap>
        <span class="vy-title">{{ title ?? '配置文件' }}</span>
        <Tag v-if="path">{{ path }}</Tag>
        <Tag v-if="dirty" color="orange">未保存</Tag>
        <Tag v-else color="green">已同步</Tag>
      </Space>
    </template>
    <p v-if="description" class="vy-desc">{{ description }}</p>
    <Alert
      v-if="error"
      type="error"
      show-icon
      class="vy-alert"
      :message="error"
    />
    <Alert
      v-if="validateResult && !validateResult.valid"
      type="warning"
      show-icon
      class="vy-alert"
      :message="validateResult.error ?? '配置校验未通过'"
      description="校验失败时不会写入磁盘。"
    />
    <Alert
      v-if="validateResult && validateResult.valid"
      type="success"
      show-icon
      class="vy-alert"
      :message="validateResult.message ?? '配置校验通过'"
    />
    <Alert
      v-if="saveResult?.error"
      type="warning"
      show-icon
      class="vy-alert"
      :message="saveResult.error"
      description="配置已写入磁盘，但热加载失败；请结合 daemon 日志排查，避免累计无效变更。"
    />
    <Input.TextArea
      v-model:value="content"
      :rows="Math.max(12, Math.floor((height ?? 440) / 22))"
      class="vy-textarea"
      spellcheck="false"
      placeholder="# YAML 配置内容"
    />
    <div class="vy-actions">
      <Space wrap>
        <Button :loading="loading" @click="load">读取最新</Button>
        <Button
          v-if="validate"
          :disabled="!dirty"
          :loading="validating"
          @click="doValidate"
        >
          校验配置
        </Button>
        <Button
          type="primary"
          :disabled="!dirty"
          :loading="saving"
          @click="doSave"
        >
          保存并应用
        </Button>
      </Space>
      <span class="vy-path">{{ path ?? '未指定配置文件' }}</span>
    </div>
  </Card>
</template>

<style scoped>
.vy-config {
  border: 1px solid #edf0f2;
  border-radius: 10px;
  box-shadow: 0 3px 16px #15202b06;
}

.vy-title {
  font-size: 15px;
  font-weight: 650;
}

.vy-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #667085;
}

.vy-alert {
  margin-bottom: 10px;
}

.vy-textarea {
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border-color: #1e293b;
  border-radius: 8px;
}

.vy-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.vy-path {
  font-size: 11px;
  color: #98a2b3;
  word-break: break-all;
}
</style>
