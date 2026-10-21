<script setup lang="ts">
import type { SectionTypeOption } from '#/components/vey/vey-section-resource-manager.vue';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Select,
  Spin,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { fetchUserGroupUsers, publishUserGroup } from '#/api/proxy';
import VeySectionResourceManager from '#/components/vey/vey-section-resource-manager.vue';

const typeOptions: SectionTypeOption[] = [
  {
    value: 'basic',
    label: 'basic',
    template:
      'type: basic\nstatic_users:\n  - name: alice\n    token:\n      type: xcrypt\n      value: "$6$..."\ncache: users-cache.json\nrefresh_interval: 60s',
    fields:
      '用户名+密码认证；static_users/source/cache/refresh_interval/anonymous_user',
  },
  {
    value: 'facts',
    label: 'facts',
    template: 'type: facts\nstatic_users:\n  - name: alice',
    fields: '普通事实型用户组，无额外配置键',
  },
  {
    value: 'ldap',
    label: 'ldap',
    template:
      'type: ldap\nldap_url: ldap://ldap.example.com:389/ou=people,dc=example,dc=com\nusername_attribute: uid\nconnect_timeout: 3s\ncache_user_count: 1024',
    fields:
      'LDAP 认证；ldap_url/username_attribute/tls_client/tls_name/unmanaged_user/max_message_size/connect_timeout/response_timeout',
  },
  {
    value: 'python-basic',
    label: 'python-basic',
    template: 'type: python-basic\nscript: auth.py',
    fields: 'Python 脚本动态认证；script 为脚本路径',
  },
];

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

// ---------------------------------------------------------------- 分组选择
const groupOptions = ref<{ label: string; value: string }[]>([]);
const group = ref('');

function onListChange(items: Record<string, unknown>[]) {
  groupOptions.value = items.map((item) => ({
    label: String(item.name ?? ''),
    value: String(item.name ?? ''),
  }));
}

// ---------------------------------------------------------------- 静态/动态用户
const usersBusy = ref(false);
const usersError = ref('');
const staticLines = ref<string[]>([]);
const dynamicLines = ref<string[]>([]);
const loadedGroup = ref('');

async function loadUsers() {
  const g = group.value.trim();
  if (!g) {
    message.warning('请先选择用户分组');
    return;
  }
  usersBusy.value = true;
  usersError.value = '';
  try {
    const [staticResult, dynamicResult] = await Promise.all([
      fetchUserGroupUsers(token(), g, 'static'),
      fetchUserGroupUsers(token(), g, 'dynamic'),
    ]);
    staticLines.value = staticResult.lines;
    dynamicLines.value = dynamicResult.lines;
    loadedGroup.value = g;
  } catch (error) {
    usersError.value =
      error instanceof Error ? error.message : '读取用户列表失败';
    staticLines.value = [];
    dynamicLines.value = [];
  } finally {
    usersBusy.value = false;
  }
}

// ---------------------------------------------------------------- 发布用户
const publishText = ref(
  '[\n  { "name": "alice", "token": { "type": "xcrypt", "value": "$6$..." } }\n]',
);
const publishBusy = ref(false);
const publishOutput = ref<string[]>([]);
const publishError = ref('');

async function doPublish() {
  const g = group.value.trim();
  if (!g) {
    message.warning('请先选择用户分组');
    return;
  }
  publishBusy.value = true;
  publishError.value = '';
  publishOutput.value = [];
  try {
    const result = await publishUserGroup(token(), g, publishText.value);
    publishOutput.value = result.output ?? [];
    message.success(`已将用户 JSON 发布到 ${g}`);
  } catch (error) {
    publishError.value =
      error instanceof Error ? error.message : '发布用户失败';
  } finally {
    publishBusy.value = false;
  }
}
</script>

<template>
  <Page
    title="用户分组"
    description="管理 vey-proxy user_group 配置分区（static_users / source / cache），查看运行中分组的静态与动态用户，并发布用户文件。"
  >
    <VeySectionResourceManager
      section="user_group"
      title="用户分组"
      :type-options="typeOptions"
      description="每个用户分组必须有 type（basic / facts / ldap / python-basic），可选 static_users 静态用户或 source 动态来源；名称由列表上方决定。"
      @list-change="onListChange"
    />

    <Card title="分组运行态" class="mt-4">
      <template #extra>
        <Button :loading="usersBusy" @click="loadUsers">加载用户</Button>
      </template>
      <p class="m-0 mb-4 text-sm text-gray-500">
        调用 vey-proxy-ctl user-group &lt;name&gt; list-static-user /
        list-dynamic-user 查看该分组当前加载的用户。
      </p>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <label class="grid w-64 gap-1.5 text-xs font-semibold text-gray-600">
          用户分组
          <Select
            v-model:value="group"
            :options="groupOptions"
            placeholder="选择用户分组"
            allow-clear
            show-search
          />
        </label>
        <span v-if="loadedGroup" class="ml-auto">
          <Tag color="blue">{{ loadedGroup }}</Tag>
        </span>
      </div>

      <Alert
        v-if="usersError"
        type="warning"
        show-icon
        class="mb-4"
        :message="usersError"
      />

      <Spin :spinning="usersBusy">
        <Tabs v-if="loadedGroup">
          <TabPane key="static" tab="静态用户">
            <div
              v-if="staticLines.length"
              class="grid max-h-80 gap-1 overflow-auto"
            >
              <div
                v-for="(line, index) in staticLines"
                :key="index"
                class="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700"
              >
                {{ line }}
              </div>
            </div>
            <div v-else class="py-5 text-center text-xs text-gray-400">
              该分组没有加载静态用户。
            </div>
          </TabPane>
          <TabPane key="dynamic" tab="动态用户">
            <div
              v-if="dynamicLines.length"
              class="grid max-h-80 gap-1 overflow-auto"
            >
              <div
                v-for="(line, index) in dynamicLines"
                :key="index"
                class="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700"
              >
                {{ line }}
              </div>
            </div>
            <div v-else class="py-5 text-center text-xs text-gray-400">
              该分组没有加载动态用户。
            </div>
          </TabPane>
        </Tabs>
        <div
          v-else-if="!usersBusy && !usersError"
          class="py-5 text-center text-xs text-gray-400"
        >
          选择用户分组后点击“加载用户”。
        </div>
      </Spin>
    </Card>

    <Card title="发布用户（publish-user）" class="mt-4">
      <template #extra>
        <Button type="primary" :loading="publishBusy" @click="doPublish">
          发布
        </Button>
      </template>
      <p class="m-0 mb-4 text-sm text-gray-500">
        调用 vey-proxy-ctl user-group &lt;name&gt; publish-user 推送合法 JSON
        用户数组到运行中分组（常用于 source: file 的动态用户更新）。
      </p>
      <Input.TextArea
        v-model:value="publishText"
        class="vey-publish-area"
        :rows="10"
        spellcheck="false"
      />
      <Alert
        v-if="publishError"
        type="warning"
        show-icon
        class="mt-4"
        :message="publishError"
      />
      <div v-if="publishOutput.length" class="mt-3 grid gap-1">
        <div
          v-for="(line, index) in publishOutput"
          :key="index"
          class="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700"
        >
          {{ line }}
        </div>
      </div>
    </Card>
  </Page>
</template>

<style scoped>
.vey-publish-area {
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border-color: #1e293b;
  border-radius: 8px;
}
</style>
