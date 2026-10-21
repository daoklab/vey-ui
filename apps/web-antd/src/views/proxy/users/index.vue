<script setup lang="ts">
import type { VxeTableGridColumns } from '@vben/plugins/vxe-table';

import type { ProxyUser } from '#/api/proxy';

import { computed, onMounted, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Input,
  InputNumber,
  InputPassword,
  message,
  Modal,
  Select,
  SelectOption,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { fetchProxyUsers, saveProxyUsers } from '#/api/proxy';

const access = useAccessStore();
const token = () => access.accessToken ?? '';

type UserRow = ProxyUser & { _index: number };

const users = ref<ProxyUser[]>([]);
const busy = ref(false);
const rows = computed<UserRow[]>(() =>
  users.value.map((user, _index) => ({ ...user, _index })),
);

const [Grid] = useVbenVxeGrid<UserRow>({
  gridOptions: {
    rowConfig: { keyField: 'username' },
    minHeight: 240,
    columns: [
      { field: 'username', title: '用户名', minWidth: 160 },
      {
        field: 'hostMode',
        title: '域名策略',
        width: 110,
        slots: { default: 'cell-host' },
      },
      {
        field: 'portMode',
        title: '端口策略',
        width: 110,
        slots: { default: 'cell-port' },
      },
      {
        field: 'expire',
        title: '到期时间',
        minWidth: 190,
        slots: { default: 'cell-expire' },
      },
      {
        field: 'action',
        title: '操作',
        width: 140,
        fixed: 'right',
        slots: { default: 'cell-action' },
      },
    ] as VxeTableGridColumns<UserRow>,
  },
});

function modeLabel(mode: string): string {
  if (mode === 'allowlist') return '白名单';
  if (mode === 'blocklist') return '黑名单';
  return '不限制';
}

async function load() {
  busy.value = true;
  try {
    users.value = (await fetchProxyUsers(token())).users;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载用户失败');
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------- 新建 / 编辑抽屉
const [Drawer, drawerApi] = useVbenDrawer({ onConfirm: save });

const editing = ref(-1);
const draft = ref<ProxyUser>();
const drawerTitle = computed(() =>
  editing.value < 0
    ? '添加代理用户'
    : `编辑用户 ${draft.value?.username ?? ''}`,
);

function blank(): ProxyUser {
  return {
    username: '',
    password: '',
    hasPassword: false,
    hostMode: 'unrestricted',
    exactHosts: [],
    domainSuffixes: [],
    portMode: 'unrestricted',
    ports: [],
    auditRatio: null,
    expire: null,
  };
}

function split(value: string): string[] {
  return value
    .split(/[\n,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function openAdd() {
  editing.value = -1;
  draft.value = blank();
  drawerApi.open();
}

function openEdit(index: number) {
  editing.value = index;
  draft.value = JSON.parse(JSON.stringify(users.value[index])) as ProxyUser;
  drawerApi.open();
}

async function save() {
  if (!draft.value) return;
  const next = [...users.value];
  if (editing.value < 0) next.push(draft.value);
  else next[editing.value] = draft.value;
  busy.value = true;
  try {
    const result = await saveProxyUsers(token(), next);
    users.value = result.users;
    drawerApi.close();
    message.success(result.message);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    busy.value = false;
  }
}

function remove(index: number) {
  const target = users.value[index];
  Modal.confirm({
    title: `删除用户 ${target?.username ?? ''}？`,
    content:
      '将立即从全部代理入口移除该账号及其访问策略；此操作不可撤销，确需继续请点击确认。',
    okText: '确认删除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    async onOk() {
      const next = users.value.filter((_, n) => n !== index);
      busy.value = true;
      try {
        const result = await saveProxyUsers(token(), next);
        users.value = result.users;
        message.success(result.message);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
        throw error;
      } finally {
        busy.value = false;
      }
    },
  });
}

onMounted(load);
</script>

<template>
  <Page
    title="用户与访问策略"
    description="添加代理账号，并设置账号可以访问哪些域名和端口。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button :loading="busy" @click="load">刷新</Button>
        <Button type="primary" @click="openAdd">添加用户</Button>
      </div>
    </template>

    <Alert
      type="info"
      show-icon
      class="mb-4"
      message="所有代理入口共用这组用户。修改用户后会立即更新；密码只在新增或重置时填写。"
    />

    <Grid :table-data="rows">
      <template #cell-host="{ row }">
        <Tag
          :color="
            row.hostMode === 'allowlist'
              ? 'green'
              : row.hostMode === 'blocklist'
                ? 'red'
                : 'default'
          "
        >
          {{ modeLabel(row.hostMode) }}
        </Tag>
      </template>
      <template #cell-port="{ row }">
        <Tag
          :color="
            row.portMode === 'allowlist'
              ? 'green'
              : row.portMode === 'blocklist'
                ? 'red'
                : 'default'
          "
        >
          {{ modeLabel(row.portMode) }}
        </Tag>
      </template>
      <template #cell-expire="{ row }">
        <span class="text-gray-600">
          {{ row.expire ? new Date(row.expire).toLocaleString() : '永不过期' }}
        </span>
      </template>
      <template #cell-action="{ row }">
        <Button type="link" size="small" @click="openEdit(row._index)">
          编辑
        </Button>
        <Button type="link" size="small" danger @click="remove(row._index)">
          删除
        </Button>
      </template>
    </Grid>
    <p class="mt-2 text-xs text-gray-400">
      修改通过 vey-proxy-ctl
      整表替换用户列表：新增、编辑或删除都会一次性提交全部用户并立即生效。
    </p>

    <Drawer
      :title="drawerTitle"
      :width="600"
      :confirm-text="busy ? '保存中…' : '保存用户并立即生效'"
      :confirm-loading="busy"
    >
      <div v-if="draft" class="grid gap-6">
        <section class="grid gap-3">
          <h3 class="m-0 text-sm font-semibold text-gray-700">登录信息</h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">用户名</label>
            <Input
              v-model:value="draft.username"
              placeholder="例如 alice"
              @press-enter="save"
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              {{ draft.hasPassword ? '重置密码' : '登录密码' }}
              <small class="ml-1 text-xs text-gray-400">
                {{
                  draft.hasPassword
                    ? '留空则保留原密码'
                    : '至少 8 位，用于登录代理'
                }}
              </small>
            </label>
            <InputPassword
              v-model:value="draft.password"
              autocomplete="new-password"
              :placeholder="draft.hasPassword ? '留空保持不变' : '请输入密码'"
            />
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <h3 class="m-0 text-sm font-semibold text-gray-700">
            允许访问的目标域名
          </h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">域名规则</label>
            <Select v-model:value="draft.hostMode">
              <SelectOption value="unrestricted">
                全部域名（不限制）
              </SelectOption>
              <SelectOption value="allowlist">只允许下方域名</SelectOption>
              <SelectOption value="blocklist">禁止下方域名</SelectOption>
            </Select>
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              完整域名
              <small class="ml-1 text-xs text-gray-400">仅匹配填写的域名，例如 api.example.com</small>
            </label>
            <Input.TextArea
              :value="draft.exactHosts.join('\n')"
              :disabled="draft.hostMode === 'unrestricted'"
              placeholder="每行一个域名"
              :auto-size="{ minRows: 2, maxRows: 4 }"
              @update:value="draft.exactHosts = split($event)"
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              域名后缀
              <small class="ml-1 text-xs text-gray-400">匹配该域名及其所有子域名</small>
            </label>
            <Input.TextArea
              :value="draft.domainSuffixes.join('\n')"
              :disabled="draft.hostMode === 'unrestricted'"
              placeholder="例如 example.com"
              :auto-size="{ minRows: 2, maxRows: 4 }"
              @update:value="draft.domainSuffixes = split($event)"
            />
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <h3 class="m-0 text-sm font-semibold text-gray-700">
            允许访问的目标端口
          </h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">端口规则</label>
            <Select v-model:value="draft.portMode">
              <SelectOption value="unrestricted">
                所有端口（不限制）
              </SelectOption>
              <SelectOption value="allowlist">只允许下方端口</SelectOption>
              <SelectOption value="blocklist">禁止下方端口</SelectOption>
            </Select>
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              端口号
              <small class="ml-1 text-xs text-gray-400">输入 1–65535 范围内的端口，多个端口用逗号分隔</small>
            </label>
            <Input
              :value="draft.ports.join(', ')"
              :disabled="draft.portMode === 'unrestricted'"
              placeholder="例如 443, 8443"
              @update:value="draft.ports = split($event).map(Number)"
            />
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <h3 class="m-0 text-sm font-semibold text-gray-700">有效期与日志</h3>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              账号到期时间
              <small class="ml-1 text-xs text-gray-400">留空表示永不过期</small>
            </label>
            <input
              type="datetime-local"
              :value="draft.expire ? draft.expire.slice(0, 16) : ''"
              class="h-9 w-full rounded-md border border-gray-200 px-3 text-sm outline-none transition focus:border-primary"
              @input="
                draft.expire = ($event.target as HTMLInputElement).value
                  ? new Date(
                      ($event.target as HTMLInputElement).value,
                    ).toISOString()
                  : null
              "
            />
          </div>
          <div class="grid gap-2">
            <label class="text-sm text-gray-600">
              审计采样率
              <small class="ml-1 text-xs text-gray-400">留空使用全局设置；1 表示记录全部请求</small>
            </label>
            <InputNumber
              :value="draft.auditRatio ?? undefined"
              :min="0"
              :max="1"
              :step="0.1"
              placeholder="使用全局设置"
              class="w-full"
              @update:value="
                draft.auditRatio = $event == null ? null : Number($event)
              "
            />
          </div>
        </section>
      </div>
    </Drawer>
  </Page>
</template>
