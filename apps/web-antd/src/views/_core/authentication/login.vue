<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';

import { computed, onMounted, ref } from 'vue';

import { AuthenticationLogin, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();
const loginForm = ref<null | {
  getFormApi: () => {
    setFieldValue: (field: string, value: string) => void;
  };
}>(null);

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.usernameTip'),
      },
      fieldName: 'username',
      label: $t('authentication.username'),
      rules: z.string().min(1, { message: $t('authentication.usernameTip') }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.password'),
      },
      fieldName: 'password',
      label: $t('authentication.password'),
      rules: z.string().min(1, { message: $t('authentication.passwordTip') }),
    },
  ];
});

onMounted(async () => {
  if (!import.meta.env.DEV) return;
  try {
    const response = await fetch('/api/auth/dev-credentials');
    if (!response.ok) return;
    const credentials = (await response.json()) as {
      username: string;
      password: string;
    };
    loginForm.value
      ?.getFormApi()
      .setFieldValue('username', credentials.username);
    loginForm.value
      ?.getFormApi()
      .setFieldValue('password', credentials.password);
  } catch {
    // Local credential prefill is a development convenience; login stays usable if unavailable.
  }
});
</script>

<template>
  <AuthenticationLogin
    ref="loginForm"
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    :show-code-login="false"
    :show-forget-password="false"
    :show-qrcode-login="false"
    :show-register="false"
    :show-third-party-login="false"
    submit-button-text="登录 VEY 控制台"
    sub-title="本地开发环境已预填管理员登录信息"
    @submit="authStore.authLogin"
  />
</template>
