<script setup lang="ts">
import type {
  MkcertGenerateRequest,
  MkcertGenerateResult,
} from '#/api/components';

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
  Tag,
} from 'ant-design-vue';

import { fetchComponent, generateMkcert } from '#/api/components';

const accessStore = useAccessStore();
const token = () => accessStore.accessToken ?? '';

const version = ref<null | string>(null);
const binPresent = ref(false);
const certTypes = ref<string[]>([]);
const algorithms = ref<string[]>([]);
const infoLoaded = ref(false);
const infoError = ref('');

const form = reactive({
  type: 'tls-server',
  mimic: '',
  commonName: '',
  caCert: '',
  caKey: '',
  hosts: '',
  country: '',
  organization: '',
  organizationUnit: '',
  pathLength: undefined as number | undefined,
  algorithm: 'ec256',
  rsaBits: 2048,
  outputCert: '',
  outputKey: '',
});

const result = ref<MkcertGenerateResult>();
const generating = ref(false);

async function load() {
  infoError.value = '';
  try {
    const comp = await fetchComponent(token(), 'mkcert');
    certTypes.value = comp.certTypes ?? [];
    algorithms.value = comp.algorithms ?? [];
    version.value = comp.version;
    binPresent.value = comp.binPresent;
  } catch (error) {
    infoError.value =
      error instanceof Error ? error.message : '无法读取 mkcert 组件信息';
  } finally {
    infoLoaded.value = true;
  }
}

function trimmedHosts(): string[] {
  return form.hosts
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function generate() {
  const payload: MkcertGenerateRequest = {
    type: form.type,
    algorithm: form.algorithm,
  };
  if (form.mimic.trim()) {
    payload.mimic = form.mimic.trim();
  } else {
    if (!certTypes.value.includes(form.type)) {
      message.warning('请选择有效的证书类型');
      return;
    }
    if (form.type === 'root' || form.type === 'intermediate') {
      if (!form.commonName.trim()) {
        message.warning('root / intermediate 证书需要填写 commonName');
        return;
      }
    } else {
      if (trimmedHosts().length === 0) {
        message.warning('末端证书需要至少一个 host');
        return;
      }
      payload.host = trimmedHosts();
    }
    if (form.type !== 'root') {
      if (!form.caCert.trim() || !form.caKey.trim()) {
        message.warning('证书需要 CA 证书与私钥路径');
        return;
      }
      payload.caCert = form.caCert.trim();
      payload.caKey = form.caKey.trim();
    }
    if (form.commonName.trim()) payload.commonName = form.commonName.trim();
  }
  for (const field of [
    'country',
    'organization',
    'organizationUnit',
  ] as const) {
    if (form[field].trim()) payload[field] = form[field].trim();
  }
  if (form.pathLength !== undefined && form.pathLength !== null)
    payload.pathLength = Number(form.pathLength);
  if (form.algorithm === 'rsa') {
    if (
      !Number.isInteger(form.rsaBits) ||
      form.rsaBits < 512 ||
      form.rsaBits > 8192
    ) {
      message.warning('rsaBits 必须在 512-8192 之间');
      return;
    }
    payload.rsaBits = form.rsaBits;
  }
  if (form.outputCert.trim()) payload.outputCert = form.outputCert.trim();
  if (form.outputKey.trim()) payload.outputKey = form.outputKey.trim();

  generating.value = true;
  result.value = undefined;
  try {
    result.value = await generateMkcert(token(), payload);
    message.success(result.value.message ?? '证书已生成');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '证书生成失败');
  } finally {
    generating.value = false;
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success(`${label}已复制到剪贴板`);
  } catch {
    message.error('复制失败，请手动选择复制');
  }
}

onMounted(load);
</script>

<template>
  <Page
    title="mkcert 证书生成"
    description="使用 vey-mkcert 一键生成 root / intermediate / TLS 证书，支持 EC、RSA、SM2 与 ed* 算法族。"
  >
    <template #extra>
      <Button :loading="!infoLoaded" type="primary" @click="load">刷新</Button>
    </template>

    <Alert
      v-if="infoError"
      type="warning"
      show-icon
      class="mb-4"
      :message="infoError"
      description="请确认本地运维代理可访问 vey-mkcert 二进制。"
    />

    <Card title="组件信息" class="mb-4">
      <Space wrap>
        <Tag v-if="version" color="blue">{{ version }}</Tag>
        <Tag :color="binPresent ? 'green' : 'orange'">
          {{ binPresent ? '二进制可用' : '缺二进制' }}
        </Tag>
        <Tag>{{ certTypes.length }} 种证书类型</Tag>
        <Tag>{{ algorithms.length }} 种算法</Tag>
      </Space>
    </Card>

    <Card title="生成证书" class="mb-4">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            证书类型（type）
          </div>
          <Select
            v-model:value="form.type"
            :options="certTypes.map((value) => ({ label: value, value }))"
            placeholder="选择证书类型"
            class="w-full"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            密钥算法（algorithm）
          </div>
          <Select
            v-model:value="form.algorithm"
            :options="algorithms.map((value) => ({ label: value, value }))"
            placeholder="选择算法"
            class="w-full"
          />
        </div>
        <div v-if="form.algorithm === 'rsa'">
          <div class="mb-2 text-xs font-semibold text-gray-600">
            RSA 位数（rsaBits，512-8192）
          </div>
          <InputNumber
            v-model:value="form.rsaBits"
            :min="512"
            :max="8192"
            :step="256"
            class="w-full"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            通用名（commonName）
          </div>
          <Input
            v-model:value="form.commonName"
            allow-clear
            placeholder="root / intermediate 必填；末端证书可选"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            CA 证书路径（caCert）
          </div>
          <Input
            v-model:value="form.caCert"
            allow-clear
            placeholder="intermediate 与末端证书必填"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            CA 私钥路径（caKey）
          </div>
          <Input
            v-model:value="form.caKey"
            allow-clear
            placeholder="intermediate 与末端证书必填"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            host（逗号分隔，末端证书必填）
          </div>
          <Input
            v-model:value="form.hosts"
            allow-clear
            placeholder="example.com,*.example.com"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            国家（country）
          </div>
          <Input
            v-model:value="form.country"
            allow-clear
            placeholder="可选，例如 CN"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            组织（organization）
          </div>
          <Input
            v-model:value="form.organization"
            allow-clear
            placeholder="可选"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            组织单元（organizationUnit）
          </div>
          <Input
            v-model:value="form.organizationUnit"
            allow-clear
            placeholder="可选"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            路径长度（pathLength，可选）
          </div>
          <InputNumber
            v-model:value="form.pathLength"
            :min="0"
            :step="1"
            class="w-full"
            placeholder="非负整数"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            输出证书路径（outputCert，可选）
          </div>
          <Input
            v-model:value="form.outputCert"
            allow-clear
            placeholder="留空自动生成临时目录"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            输出私钥路径（outputKey，可选）
          </div>
          <Input
            v-model:value="form.outputKey"
            allow-clear
            placeholder="留空自动生成临时目录"
          />
        </div>
        <div>
          <div class="mb-2 text-xs font-semibold text-gray-600">
            mimic（可选，直接模仿示例证书）
          </div>
          <Input
            v-model:value="form.mimic"
            allow-clear
            placeholder="填写后忽略证书类型与 CA / host 字段"
          />
        </div>
      </div>
      <div class="mt-5 flex flex-wrap items-center gap-3.5">
        <Button
          type="primary"
          size="large"
          :loading="generating"
          @click="generate"
        >
          生成证书
        </Button>
        <span class="text-xs text-gray-400">
          生成请求会落到 vey-mkcert
          原生命令行；证书内容生成后展示在下方，也可通过输出路径落盘。
        </span>
      </div>
    </Card>

    <Card v-if="result">
      <template #title>
        <div class="flex items-center gap-2">
          <span>生成结果</span>
          <Tag color="green">
            {{ result.type || 'mimic' }} · {{ result.algorithm }}
          </Tag>
        </div>
      </template>
      <Alert type="success" show-icon class="mb-4" :message="result.message" />
      <div class="mb-4">
        <div class="mb-2 flex items-center justify-between gap-3">
          <span class="font-mono text-xs font-semibold text-gray-700">
            {{ result.files.cert.name }}
          </span>
          <Space>
            <Tag>证书</Tag>
            <Button
              size="small"
              @click="copyText(result.files.cert.content, '证书内容')"
            >
              复制
            </Button>
          </Space>
        </div>
        <pre
          class="mb-0 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed text-slate-200"
          >{{ result.files.cert.content }}</pre>
      </div>
      <div class="mb-4">
        <div class="mb-2 flex items-center justify-between gap-3">
          <span class="font-mono text-xs font-semibold text-gray-700">
            {{ result.files.key.name }}
          </span>
          <Space>
            <Tag>私钥</Tag>
            <Button
              size="small"
              @click="copyText(result.files.key.content, '私钥内容')"
            >
              复制
            </Button>
          </Space>
        </div>
        <pre
          class="mb-0 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed text-slate-200"
          >{{ result.files.key.content }}</pre>
      </div>
      <p class="mb-0 break-all text-xs text-gray-400">
        证书文件路径：{{ result.files.cert.path }}；私钥文件路径：{{
          result.files.key.path
        }}（未指定输出路径时为临时目录，请及时保存）。
      </p>
    </Card>
  </Page>
</template>
