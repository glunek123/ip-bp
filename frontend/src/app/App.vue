<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppShell from './AppShell.vue';

const auth = useAuthStore();
</script>

<template>
  <AppShell v-if="auth.session"><RouterView /></AppShell>
  <RouterView v-else />
</template>
