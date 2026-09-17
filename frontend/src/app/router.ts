import { createRouter, createWebHistory } from 'vue-router';
import HealthPage from './HealthPage.vue';
import CustomerListPage from '../modules/customers/CustomerListPage.vue';
import CustomerNewPage from '../modules/customers/CustomerNewPage.vue';
import CustomerDetailPage from '../modules/customers/CustomerDetailPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/customers' },
    { path: '/health', component: HealthPage },
    { path: '/customers', component: CustomerListPage },
    { path: '/customers/new', component: CustomerNewPage },
    { path: '/customers/:id', component: CustomerDetailPage },
  ],
});
