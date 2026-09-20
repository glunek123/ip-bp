import { createRouter, createWebHistory } from 'vue-router';
import HealthPage from './HealthPage.vue';
import CustomerListPage from '../modules/customers/CustomerListPage.vue';
import CustomerNewPage from '../modules/customers/CustomerNewPage.vue';
import CustomerDetailPage from '../modules/customers/CustomerDetailPage.vue';
import CustomerEditPage from '../modules/customers/CustomerEditPage.vue';
import RightsHolderDetailPage from '../modules/customers/RightsHolderDetailPage.vue';
import LoginPage from '../modules/auth/LoginPage.vue';
import PeopleAccessPage from '../modules/organization/PeopleAccessPage.vue';
import { useAuthStore } from '../stores/auth';
import { pinia } from './pinia';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    { path: '/', redirect: '/customers' },
    { path: '/health', component: HealthPage, meta: { public: true } },
    { path: '/customers', component: CustomerListPage },
    { path: '/customers/new', component: CustomerNewPage },
    { path: '/customers/:id/edit', component: CustomerEditPage },
    {
      path: '/customers/:customerId/rights-holders/:rightsHolderId',
      component: RightsHolderDetailPage,
    },
    { path: '/customers/:id', component: CustomerDetailPage },
    { path: '/settings/people-access', component: PeopleAccessPage },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore(pinia);
  if (to.meta.public === true) {
    if (to.path === '/login' && auth.session !== null) return '/customers';
    return true;
  }
  try {
    await auth.restore();
  } catch {
    return '/health';
  }
  if (auth.session !== null) return true;
  const returnTo =
    to.fullPath.startsWith('/') && !to.fullPath.startsWith('//')
      ? to.fullPath
      : '/customers';
  return { path: '/login', query: { returnTo } };
});
