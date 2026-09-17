import { createRouter, createWebHistory } from 'vue-router';
import HealthPage from './HealthPage.vue';
import CustomerListPage from '../modules/customers/CustomerListPage.vue';
import CustomerNewPage from '../modules/customers/CustomerNewPage.vue';
import CustomerDetailPage from '../modules/customers/CustomerDetailPage.vue';
import CustomerEditPage from '../modules/customers/CustomerEditPage.vue';
import RightsHolderDetailPage from '../modules/customers/RightsHolderDetailPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/customers' },
    { path: '/health', component: HealthPage },
    { path: '/customers', component: CustomerListPage },
    { path: '/customers/new', component: CustomerNewPage },
    { path: '/customers/:id/edit', component: CustomerEditPage },
    {
      path: '/customers/:customerId/rights-holders/:rightsHolderId',
      component: RightsHolderDetailPage,
    },
    { path: '/customers/:id', component: CustomerDetailPage },
  ],
});
