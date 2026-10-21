<script setup lang="ts">
import { Empty } from 'ant-design-vue';

defineProps<{
  title: string;
  description?: string;
  todo?: string;
}>();
</script>

<template>
  <div class="vey-placeholder">
    <header class="vey-hero">
      <div>
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
    </header>
    <div class="vey-card">
      <Empty description="页面建设中">
        <p v-if="todo" class="vey-todo">{{ todo }}</p>
      </Empty>
    </div>
  </div>
</template>

<style scoped>
.vey-placeholder {
  max-width: 1440px;
  padding: 28px 32px 48px;
  margin: auto;
  color: #17202b;
}

.vey-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.vey-hero h1 {
  margin: 8px 0 4px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.03em;
}

.vey-hero p {
  margin: 0;
  font-size: 13px;
  color: #7b8794;
}

.vey-card {
  padding: 64px 24px;
  border: 1px solid #edf0f2;
  border-radius: 10px;
  box-shadow: 0 3px 16px #15202b06;
}

.vey-todo {
  margin: 8px 0 0;
  font-size: 13px;
  color: #98a2b3;
  text-align: center;
}

@media (max-width: 600px) {
  .vey-placeholder {
    padding: 20px 16px;
  }
}
</style>
