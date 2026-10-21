<script setup lang="ts">
import { ref } from 'vue';

import { Button, Card, Input, message, Modal, Tag } from 'ant-design-vue';

export interface LifecycleActionItem {
  action: string;
  needsName: boolean;
  message: string;
}

const props = defineProps<{
  title?: string;
  actions: LifecycleActionItem[];
  run: (action: string, name: string) => Promise<string>;
  loading?: boolean;
}>();

const name = ref('');
const busy = ref('');

function dangerous(action: string) {
  return ['force-quit', 'force-quit-all', 'offline'].includes(action);
}

async function execute(action: LifecycleActionItem) {
  const target = action.needsName ? name.value.trim() : '';
  if (action.needsName && !target) {
    message.warning('请先输入资源名称');
    return;
  }
  const run = async () => {
    busy.value = action.action;
    try {
      const text = await props.run(action.action, target);
      message.success(text || action.message || '操作成功');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
      throw error;
    } finally {
      busy.value = '';
    }
  };
  if (dangerous(action.action)) {
    Modal.confirm({
      title: `确认执行 ${action.action}？`,
      content: action.needsName
        ? `该操作将作用于资源 ${target}。`
        : action.message || '该操作会立即影响运行中的 daemon。',
      okText: '确认执行',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: run,
    });
  } else {
    void run();
  }
}
</script>

<template>
  <Card class="vy-lifecycle" :bordered="false" :loading="loading">
    <template #title>
      <span class="vy-title">{{ title ?? '生命周期操作' }}</span>
      <Tag v-if="actions.some((item) => item.needsName)" color="blue">
        部分操作需要资源名称
      </Tag>
    </template>
    <div class="vy-body">
      <div v-if="actions.some((item) => item.needsName)" class="vy-name">
        <Input
          v-model:value="name"
          allow-clear
          placeholder="资源名称，例如 server-a"
          class="vy-input"
          @press-enter="
            () =>
              actions.find((item) => item.needsName) &&
              execute(actions.find((item) => item.needsName)!)
          "
        />
        <span class="vy-hint">force-quit 与资源级 reload 需要填写目标资源名称。</span>
      </div>
      <div class="vy-grid">
        <Button
          v-for="item in actions"
          :key="item.action"
          :danger="dangerous(item.action)"
          :disabled="busy !== '' && busy !== item.action"
          :loading="busy === item.action"
          @click="execute(item)"
        >
          {{ item.action }}
        </Button>
      </div>
      <p class="vy-foot">
        操作经本地受保护的控制 socket 转发到 vey daemon 原生 Cap'n Proto
        接口；offline / force-quit 等操作不可逆。
      </p>
    </div>
  </Card>
</template>

<style scoped>
.vy-lifecycle {
  max-width: 760px;
  border: 1px solid #edf0f2;
  border-radius: 10px;
  box-shadow: 0 3px 16px #15202b06;
}

.vy-title {
  font-size: 15px;
  font-weight: 650;
}

.vy-body {
  display: grid;
  gap: 16px;
  padding: 2px;
}

.vy-name {
  display: grid;
  gap: 6px;
}

.vy-input {
  max-width: 380px;
}

.vy-hint {
  font-size: 12px;
  color: #98a2b3;
}

.vy-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.vy-grid :deep(.ant-btn) {
  justify-content: center;
  min-width: 120px;
}

.vy-foot {
  margin: 2px 0 0;
  font-size: 12px;
  color: #98a2b3;
}
</style>
