<script setup lang="ts">
import type { VeyComponent } from '#/api/components';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import {
  fetchComponent,
  fetchComponentConfig,
  runComponentAction,
  saveComponentConfig,
  validateComponentConfig,
} from '#/api/components';
import VeyConfigEditor from '#/components/vey/vey-config-editor.vue';
import VeyLifecycleActions from '#/components/vey/vey-lifecycle-actions.vue';

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

const component = ref<VeyComponent>();
const loading = ref(true);
const error = ref('');
const editor = ref<InstanceType<typeof VeyConfigEditor>>();

async function load() {
  loading.value = true;
  error.value = '';
  try {
    component.value = await fetchComponent(token(), 'keyless');
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : '无法读取 keyless 组件信息';
  } finally {
    loading.value = false;
  }
}

async function loadConfig() {
  const result = await fetchComponentConfig(token(), 'keyless');
  return {
    path: result.path,
    content: result.content,
    present: result.present,
    parseError: result.parseError,
  };
}

async function validateConfig(content: string) {
  const result = await validateComponentConfig(token(), 'keyless', content);
  return { valid: result.valid, message: result.message, error: result.error };
}

async function saveConfig(content: string) {
  const result = await saveComponentConfig(token(), 'keyless', content);
  return {
    saved: result.saved,
    reloaded: result.reloaded,
    message: result.message,
    error: result.error,
  };
}

// ---------------------------------------------------------------- 生命周期
const lifecycleActions = [
  { action: 'version', needsName: false, message: '读取 keyless 版本信息' },
  { action: 'reload', needsName: false, message: '重新加载 keyless 配置' },
  {
    action: 'cancel-shutdown',
    needsName: false,
    message: '取消 keyless 关闭流程',
  },
  {
    action: 'offline',
    needsName: false,
    message: '让 keyless 进入离线模式（不可逆）',
  },
];

async function runLifecycle(action: string, name: string) {
  const result = await runComponentAction(token(), 'keyless', {
    action,
    name: name || undefined,
  });
  return result.message ?? result.version ?? '操作成功';
}

// ---------------------------------------------------------------- server 操作
const serverName = ref('');
const serverItems = ref<string[]>([]);
const serverStatusOutput = ref('');
const serverStatusStats = ref<Record<string, string>>({});
const listenAddr = ref('');
const lastServer = ref('');
const tagName = ref('');
const tagValue = ref('');
const serverBusy = ref(false);
const serverOpError = ref('');

async function listServers() {
  serverBusy.value = true;
  serverOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'list',
      resource: 'server',
    });
    serverItems.value = result.items ?? [];
  } catch (error) {
    serverOpError.value =
      error instanceof Error ? error.message : '查询服务器列表失败';
    serverItems.value = [];
  } finally {
    serverBusy.value = false;
  }
}

async function queryServerStatus() {
  const name = serverName.value.trim();
  if (!name) {
    message.warning('请先输入服务器名称');
    return;
  }
  serverBusy.value = true;
  serverOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'server-status',
      name,
    });
    serverStatusOutput.value = result.output ?? '';
    serverStatusStats.value = result.stats ?? {};
    listenAddr.value = '';
    lastServer.value = name;
  } catch (error) {
    serverOpError.value =
      error instanceof Error ? error.message : '查询服务器状态失败';
  } finally {
    serverBusy.value = false;
  }
}

async function queryListenAddr() {
  const name = serverName.value.trim();
  if (!name) {
    message.warning('请先输入服务器名称');
    return;
  }
  serverBusy.value = true;
  serverOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'server-get-listen-addr',
      name,
    });
    listenAddr.value = result.addr ?? result.output ?? '';
    lastServer.value = name;
    message.success(`监听地址：${listenAddr.value}`);
  } catch (error) {
    serverOpError.value =
      error instanceof Error ? error.message : '查询监听地址失败';
  } finally {
    serverBusy.value = false;
  }
}

async function addMetricsTag() {
  const name = serverName.value.trim();
  const tag = tagName.value.trim();
  const value = tagValue.value.trim();
  if (!name) {
    message.warning('请先输入服务器名称');
    return;
  }
  if (!tag || !value) {
    message.warning('请填写指标标签名与值');
    return;
  }
  serverBusy.value = true;
  serverOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'server-add-metrics-tag',
      name,
      tag,
      value,
    });
    message.success(result.message ?? '指标标签已添加');
    tagName.value = '';
    tagValue.value = '';
  } catch (error) {
    serverOpError.value =
      error instanceof Error ? error.message : '添加指标标签失败';
  } finally {
    serverBusy.value = false;
  }
}

// ---------------------------------------------------------------- key 操作
const keyItems = ref<string[]>([]);
const publishFile = ref('');
const checkFile = ref('');
const dupDir = ref('');
const dupExt = ref('');
const keyOutput = ref('');
const keyBusy = ref(false);
const keyOpError = ref('');

async function listKeys() {
  keyBusy.value = true;
  keyOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'list',
      resource: 'key',
    });
    keyItems.value = result.items ?? [];
  } catch (error) {
    keyOpError.value =
      error instanceof Error ? error.message : '查询密钥列表失败';
    keyItems.value = [];
  } finally {
    keyBusy.value = false;
  }
}

async function publishKey() {
  const file = publishFile.value.trim();
  if (!file) {
    message.warning('请填写密钥文件路径');
    return;
  }
  keyBusy.value = true;
  keyOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'publish-key',
      file,
    });
    keyOutput.value = result.output ?? result.message ?? '';
    message.success(result.message ?? '密钥已发布');
  } catch (error) {
    keyOpError.value = error instanceof Error ? error.message : '发布密钥失败';
  } finally {
    keyBusy.value = false;
  }
}

async function checkKey() {
  const file = checkFile.value.trim();
  if (!file) {
    message.warning('请填写密钥文件路径');
    return;
  }
  keyBusy.value = true;
  keyOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'check-key',
      file,
    });
    keyOutput.value = result.output ?? result.message ?? '';
    message.success(result.message ?? '密钥校验完成');
  } catch (error) {
    keyOpError.value = error instanceof Error ? error.message : '校验密钥失败';
  } finally {
    keyBusy.value = false;
  }
}

async function checkDup() {
  const dir = dupDir.value.trim();
  if (!dir) {
    message.warning('请填写目录路径');
    return;
  }
  keyBusy.value = true;
  keyOpError.value = '';
  try {
    const result = await runComponentAction(token(), 'keyless', {
      action: 'check-dup',
      dir,
      ext: dupExt.value.trim() || undefined,
    });
    keyOutput.value = result.output ?? result.message ?? '';
    message.success(result.message ?? '重复密钥检查完成');
  } catch (error) {
    keyOpError.value =
      error instanceof Error ? error.message : '检查重复密钥失败';
  } finally {
    keyBusy.value = false;
  }
}

onMounted(() => {
  void load();
  void editor.value?.load();
});
</script>

<template>
  <Page
    title="keyless 密钥服务"
    description="管理 vey-keyless 守护进程：配置文件、server / key 资源、密钥发布与校验、重复密钥检查、生命周期操作。"
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
      description="请确认本地运维代理与 keyless 控制 socket 连接正常。"
    />

    <Card title="组件信息" class="mb-4">
      <Spin :spinning="loading">
        <div
          v-if="component"
          class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5"
        >
          <div>
            <div class="text-xs text-gray-400">名称</div>
            <div class="mt-1 text-sm text-gray-700">{{ component.name }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-400">版本</div>
            <div class="mt-1">
              <Tag v-if="component.version" color="blue">
                {{ component.version }}
              </Tag>
              <span v-else class="text-sm text-gray-400">未知</span>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">守护进程</div>
            <div class="mt-1">
              <Tag v-if="component.connected === true" color="success">
                在线
              </Tag>
              <Tag v-else-if="component.connected === false" color="error">
                离线
              </Tag>
              <Tag v-else>未检测</Tag>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">二进制 / 控制端</div>
            <div class="mt-1">
              <Tag :color="component.binPresent ? 'green' : 'orange'">
                {{ component.binPresent ? '二进制可用' : '缺二进制' }}
              </Tag>
              <Tag :color="component.ctlPresent ? 'green' : 'orange'">
                {{ component.ctlPresent ? 'ctl 可用' : '缺 ctl' }}
              </Tag>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">配置文件</div>
            <div class="mt-1 break-all font-mono text-xs text-gray-700">
              {{ component.configFile ?? '未指定' }}
            </div>
          </div>
        </div>
      </Spin>
    </Card>

    <Card class="mb-4">
      <VeyLifecycleActions
        title="keyless 生命周期操作"
        :actions="lifecycleActions"
        :run="runLifecycle"
        :loading="loading"
      />
    </Card>

    <div class="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="server 操作">
        <div class="grid gap-4">
          <div>
            <div class="mb-2 text-xs font-semibold text-gray-600">
              服务器名称
            </div>
            <Space wrap>
              <Input
                v-model:value="serverName"
                allow-clear
                placeholder="例如 server-a"
                style="width: 200px"
                @press-enter="queryServerStatus"
              />
              <Button @click="listServers">查询列表</Button>
              <Button
                type="primary"
                :loading="serverBusy"
                @click="queryServerStatus"
              >
                状态
              </Button>
              <Button :loading="serverBusy" @click="queryListenAddr">
                监听地址
              </Button>
            </Space>
          </div>
          <div>
            <div class="mb-2 text-xs font-semibold text-gray-600">
              添加指标标签（server-add-metrics-tag）
            </div>
            <Space wrap>
              <Input
                v-model:value="tagName"
                allow-clear
                placeholder="标签名"
                style="width: 160px"
              />
              <Input
                v-model:value="tagValue"
                allow-clear
                placeholder="值"
                style="width: 160px"
                @press-enter="addMetricsTag"
              />
              <Button :loading="serverBusy" @click="addMetricsTag">添加</Button>
            </Space>
          </div>
          <Alert
            v-if="serverOpError"
            type="warning"
            show-icon
            :message="serverOpError"
          />
          <Spin :spinning="serverBusy">
            <div v-if="serverItems.length" class="flex flex-wrap gap-1.5">
              <Tag v-for="item in serverItems" :key="item" color="blue">
                {{ item }}
              </Tag>
            </div>
            <p
              v-if="listenAddr"
              class="mb-0 mt-1 font-mono text-xs text-gray-700"
            >
              <Tag color="green">监听地址</Tag>{{ listenAddr
              }}<span v-if="lastServer" class="text-gray-400">（{{ lastServer }}）</span>
            </p>
            <div
              v-if="serverStatusStats && Object.keys(serverStatusStats).length"
              class="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              <div
                v-for="(value, key) in serverStatusStats"
                :key="key"
                class="rounded-lg border border-gray-100 bg-gray-50 p-2"
              >
                <div class="text-[11px] text-gray-400">{{ key }}</div>
                <div
                  class="mt-0.5 break-all text-[13px] font-semibold text-gray-700"
                >
                  {{ value }}
                </div>
              </div>
            </div>
            <pre
              v-if="serverStatusOutput"
              class="mb-0 mt-2 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed text-slate-200"
              >{{ serverStatusOutput }}</pre>
            <p
              v-if="
                !serverItems.length &&
                !listenAddr &&
                !serverStatusOutput &&
                !serverBusy &&
                !serverOpError
              "
              class="mb-0 mt-1 text-xs text-gray-400"
            >
              输入服务器名称后执行状态 / 监听地址查询，或点击“查询列表”查看全部
              server。
            </p>
          </Spin>
        </div>
      </Card>

      <Card title="key 操作">
        <div class="grid gap-4">
          <div>
            <div class="mb-2 text-xs font-semibold text-gray-600">
              密钥列表（list key）
            </div>
            <Space wrap>
              <Button @click="listKeys">查询列表</Button>
              <span v-if="keyItems.length" class="flex flex-wrap gap-1.5">
                <Tag v-for="item in keyItems" :key="item" color="blue">{{
                  item
                }}</Tag>
              </span>
            </Space>
          </div>
          <div>
            <div class="mb-2 text-xs font-semibold text-gray-600">
              发布密钥（publish-key）
            </div>
            <Space wrap>
              <Input
                v-model:value="publishFile"
                allow-clear
                placeholder="密钥文件路径"
                style="width: 240px"
                @press-enter="publishKey"
              />
              <Button type="primary" :loading="keyBusy" @click="publishKey">
                发布
              </Button>
            </Space>
          </div>
          <div>
            <div class="mb-2 text-xs font-semibold text-gray-600">
              校验密钥（check-key）
            </div>
            <Space wrap>
              <Input
                v-model:value="checkFile"
                allow-clear
                placeholder="密钥文件路径"
                style="width: 240px"
                @press-enter="checkKey"
              />
              <Button :loading="keyBusy" @click="checkKey">校验</Button>
            </Space>
          </div>
          <div>
            <div class="mb-2 text-xs font-semibold text-gray-600">
              重复密钥检查（check-dup）
            </div>
            <Space wrap>
              <Input
                v-model:value="dupDir"
                allow-clear
                placeholder="目录路径"
                style="width: 200px"
              />
              <Input
                v-model:value="dupExt"
                allow-clear
                placeholder="扩展名（可选）"
                style="width: 130px"
                @press-enter="checkDup"
              />
              <Button :loading="keyBusy" @click="checkDup">检查</Button>
            </Space>
          </div>
          <Alert
            v-if="keyOpError"
            type="warning"
            show-icon
            :message="keyOpError"
          />
          <pre
            v-if="keyOutput"
            class="mb-0 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed text-slate-200"
            >{{ keyOutput }}</pre>
        </div>
      </Card>
    </div>

    <VeyConfigEditor
      ref="editor"
      title="keyless 配置"
      :path="component?.configFile ?? ''"
      :load="loadConfig"
      :validate="validateConfig"
      :save="saveConfig"
      :height="520"
    />
    <p class="mt-2 text-xs text-gray-400">
      server-status 会把 ctl 输出解析为键值指标；所有操作均转发到
      vey-keyless-ctl 的原生子命令。配置保存先校验再原子写入，daemon
      未运行时提示热加载失败但配置已落盘。
    </p>
  </Page>
</template>
