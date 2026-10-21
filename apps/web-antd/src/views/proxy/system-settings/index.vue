<script setup lang="ts">
import type { ProxySettings } from '#/api/proxy';

import { onMounted, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  message,
  Select,
  SelectOption,
  Spin,
  Switch,
} from 'ant-design-vue';

import { fetchProxySettings, saveProxySettings } from '#/api/proxy';

const access = useAccessStore();
const token = () => access.accessToken ?? '';

const settings = ref<ProxySettings>();
const busy = ref(false);

async function load() {
  busy.value = true;
  try {
    settings.value = await fetchProxySettings(token());
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取系统配置失败');
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------- 编辑抽屉
const [Drawer, drawerApi] = useVbenDrawer({ onConfirm: save });

const draft = ref<ProxySettings>();

function edit() {
  if (!settings.value) return;
  draft.value = JSON.parse(JSON.stringify(settings.value)) as ProxySettings;
  drawerApi.open();
}

function split(value: string): string[] {
  return value
    .split(/[\n,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function save() {
  if (!draft.value) return;
  busy.value = true;
  try {
    const result = await saveProxySettings(token(), draft.value);
    await load();
    drawerApi.close();
    message.success(result.message);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存并应用失败');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Page
    title="系统配置"
    description="管理代理运行时、控制接口、DNS 出站解析与系统日志。保存后校验并应用到本机代理进程。"
  >
    <template #extra>
      <div class="flex gap-2">
        <Button :loading="busy" @click="load">刷新状态</Button>
        <Button type="primary" @click="edit">编辑并应用</Button>
      </div>
    </template>

    <Spin :spinning="busy">
      <template v-if="settings">
        <div class="mb-4 flex items-center gap-2 text-xs text-gray-400">
          <span
            class="inline-block size-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100"
          ></span>
          <span>配置已加载</span>
          <span class="text-gray-300">·</span>
          <span>修改时间以最近保存为准</span>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <div class="mb-3 flex items-center gap-2.5">
              <span
                class="grid size-8 place-items-center rounded-lg bg-blue-50 text-lg text-blue-600"
                >◷</span>
              <span class="text-sm font-semibold text-gray-700">运行时与控制</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1">
                <small class="text-xs text-gray-400">运行线程</small>
                <strong class="text-xl tracking-tight">{{
                  settings.system.threadNumber === 0
                    ? '自动'
                    : settings.system.threadNumber
                }}</strong>
              </div>
              <div class="grid gap-1">
                <small class="text-xs text-gray-400">退出等待</small>
                <strong class="text-xl tracking-tight">{{ settings.system.serverOfflineDelay }}
                  <em class="text-xs font-normal text-gray-400">秒</em></strong>
              </div>
            </div>
            <div
              class="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400"
            >
              控制器接收 / 发送超时
              <b class="text-gray-600">{{ settings.system.controllerRecvTimeout }}s /
                {{ settings.system.controllerSendTimeout }}s</b>
            </div>
          </Card>

          <Card>
            <div class="mb-3 flex items-center gap-2.5">
              <span
                class="grid size-8 place-items-center rounded-lg bg-emerald-50 text-lg text-emerald-600"
                >⌁</span>
              <span class="text-sm font-semibold text-gray-700">DNS 与出站解析</span>
            </div>
            <div class="mb-3 grid gap-2">
              <small class="text-xs text-gray-400">DNS 服务器</small>
              <div class="flex flex-wrap gap-1.5">
                <code
                  v-for="ip in settings.system.resolverServers"
                  :key="ip"
                  class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600"
                  >{{ ip }}</code>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1">
                <small class="text-xs text-gray-400">请求超时</small>
                <strong class="text-lg tracking-tight">{{ settings.system.resolverRequestTimeout }}
                  <em class="text-xs font-normal text-gray-400">秒</em></strong>
              </div>
              <div class="grid gap-1">
                <small class="text-xs text-gray-400">每台重试</small>
                <strong class="text-lg tracking-tight">{{ settings.system.resolverTries }}
                  <em class="text-xs font-normal text-gray-400">次</em></strong>
              </div>
            </div>
            <div
              class="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400"
            >
              {{ settings.system.resolveStrategy }}
              <span
                class="ml-2 rounded-full px-2 py-0.5 text-[11px]"
                :class="
                  settings.system.noIpv6
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-emerald-50 text-emerald-700'
                "
              >
                IPv6 {{ settings.system.noIpv6 ? '关闭' : '开启' }}
              </span>
            </div>
          </Card>

          <Card>
            <div class="mb-3 flex items-center gap-2.5">
              <span
                class="grid size-8 place-items-center rounded-lg bg-violet-50 text-lg text-violet-600"
                >≋</span>
              <span class="text-sm font-semibold text-gray-700">Syslog 输出</span>
              <span
                class="ml-auto rounded-full px-2 py-0.5 text-[11px]"
                :class="
                  settings.syslog.enabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'
                "
                >{{ settings.syslog.enabled ? '运行中' : '已关闭' }}</span>
            </div>
            <div class="text-sm text-gray-700">
              {{ settings.syslog.targetType.toUpperCase() }}
              <b class="ml-1 font-semibold">{{ settings.syslog.target }}</b>
            </div>
            <div
              class="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400"
            >
              {{ settings.syslog.format.toUpperCase() }} · Message ID
              <b class="text-gray-600">{{ settings.syslog.messageId }}</b>
            </div>
          </Card>
        </div>

        <Card class="mt-4">
          <p class="m-0 text-xs text-gray-500">
            运行线程与 DNS
            驱动属于启动级配置；应用时代理将短暂重启，已有连接会按退出等待时间处理。
          </p>
        </Card>
      </template>
    </Spin>

    <Drawer
      title="编辑系统配置"
      :width="720"
      :confirm-text="busy ? '保存中…' : '保存并重启生效'"
      :confirm-loading="busy"
    >
      <template #prepend-footer>
        <span class="mr-auto text-xs text-gray-400">保存前会执行 VEY 原生配置校验</span>
      </template>
      <div v-if="draft" class="grid gap-6">
        <section class="grid gap-3">
          <div class="flex items-baseline gap-3">
            <span class="text-xs font-bold text-blue-600">01</span>
            <div>
              <h3 class="m-0 text-sm font-semibold text-gray-700">运行时</h3>
              <p class="m-0 text-xs text-gray-400">
                控制代理进程资源与平滑退出
              </p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <label class="grid gap-2 text-sm text-gray-600">
              运行线程数
              <small class="text-xs text-gray-400">0 表示使用当前线程数</small>
              <InputNumber
                v-model:value="draft.system.threadNumber"
                :min="0"
                :max="256"
                class="w-full"
              />
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              退出等待时间
              <small class="text-xs text-gray-400">停止监听后的连接排空时间（秒）</small>
              <InputNumber
                v-model:value="draft.system.serverOfflineDelay"
                :min="1"
                :max="3600"
                class="w-full"
              />
            </label>
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <div class="flex items-baseline gap-3">
            <span class="text-xs font-bold text-blue-600">02</span>
            <div>
              <h3 class="m-0 text-sm font-semibold text-gray-700">控制接口</h3>
              <p class="m-0 text-xs text-gray-400">VEY 本地管理接口通信超时</p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <label class="grid gap-2 text-sm text-gray-600">
              接收超时（秒）
              <InputNumber
                v-model:value="draft.system.controllerRecvTimeout"
                :min="1"
                :max="3600"
                class="w-full"
              />
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              发送超时（秒）
              <InputNumber
                v-model:value="draft.system.controllerSendTimeout"
                :min="1"
                :max="3600"
                class="w-full"
              />
            </label>
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <div class="flex items-baseline gap-3">
            <span class="text-xs font-bold text-blue-600">03</span>
            <div>
              <h3 class="m-0 text-sm font-semibold text-gray-700">
                DNS 与出站解析
              </h3>
              <p class="m-0 text-xs text-gray-400">
                配置 Hickory 上游服务器及地址选择行为
              </p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <label class="col-span-2 grid gap-2 text-sm text-gray-600">
              DNS 服务器
              <small class="text-xs text-gray-400">可填写多个 IPv4 或 IPv6 地址，每行一个</small>
              <Input.TextArea
                :value="draft.system.resolverServers.join('\n')"
                :auto-size="{ minRows: 3, maxRows: 6 }"
                placeholder="1.1.1.1&#10;8.8.8.8"
                @update:value="draft.system.resolverServers = split($event)"
              />
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              请求超时（秒）
              <InputNumber
                v-model:value="draft.system.resolverRequestTimeout"
                :min="1"
                :max="300"
                class="w-full"
              />
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              每台服务器重试次数
              <InputNumber
                v-model:value="draft.system.resolverTries"
                :min="1"
                :max="10"
                class="w-full"
              />
            </label>
            <label class="col-span-2 grid gap-2 text-sm text-gray-600">
              地址选择策略
              <Select v-model:value="draft.system.resolveStrategy">
                <SelectOption value="Ipv4First">IPv4 优先</SelectOption>
                <SelectOption value="Ipv6First" :disabled="draft.system.noIpv6">IPv6 优先</SelectOption>
                <SelectOption value="Ipv4Only">仅 IPv4</SelectOption>
                <SelectOption value="Ipv6Only" :disabled="draft.system.noIpv6">仅 IPv6</SelectOption>
              </Select>
            </label>
            <div
              class="col-span-2 flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5"
            >
              <span class="grid gap-0.5">
                <b class="text-sm text-gray-700">禁用 IPv6 出站</b>
                <small class="text-xs text-gray-400">不通过 IPv6 建立代理上游连接</small>
              </span>
              <Switch v-model:checked="draft.system.noIpv6" />
            </div>
          </div>
        </section>

        <section class="grid gap-3 border-t border-gray-100 pt-5">
          <div class="flex items-baseline gap-3">
            <span class="text-xs font-bold text-blue-600">04</span>
            <div>
              <h3 class="m-0 text-sm font-semibold text-gray-700">Syslog</h3>
              <p class="m-0 text-xs text-gray-400">
                将系统日志发送至外部日志接收端
              </p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div
              class="col-span-2 flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5"
            >
              <span class="grid gap-0.5">
                <b class="text-sm text-gray-700">启用 Syslog</b>
                <small class="text-xs text-gray-400">变更后会重启代理以加载日志驱动</small>
              </span>
              <Switch v-model:checked="draft.syslog.enabled" />
            </div>
            <label class="grid gap-2 text-sm text-gray-600">
              目标类型
              <Select v-model:value="draft.syslog.targetType">
                <SelectOption value="udp">UDP</SelectOption>
                <SelectOption value="unix">Unix Socket</SelectOption>
              </Select>
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              目标地址
              <Input
                v-model:value="draft.syslog.target"
                :placeholder="
                  draft.syslog.targetType === 'udp'
                    ? '127.0.0.1:514'
                    : '/var/run/syslog.sock'
                "
              />
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              消息格式
              <Select v-model:value="draft.syslog.format">
                <SelectOption value="rfc5424">RFC 5424</SelectOption>
                <SelectOption value="rfc3164">RFC 3164</SelectOption>
              </Select>
            </label>
            <label class="grid gap-2 text-sm text-gray-600">
              Message ID
              <Input v-model:value="draft.syslog.messageId" />
            </label>
            <label
              v-if="draft.syslog.format === 'rfc5424'"
              class="grid gap-2 text-sm text-gray-600"
            >
              Enterprise ID
              <InputNumber
                v-model:value="draft.syslog.enterpriseId"
                :min="0"
                :max="4294967295"
                class="w-full"
              />
            </label>
            <div class="col-span-2">
              <Checkbox v-model:checked="draft.syslog.emitHostname">
                Syslog 消息包含主机名
              </Checkbox>
            </div>
          </div>
        </section>
      </div>
    </Drawer>
  </Page>
</template>
