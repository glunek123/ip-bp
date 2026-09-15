import { createRouter, createWebHistory } from 'vue-router';
import HealthPage from './HealthPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: HealthPage }],
});
