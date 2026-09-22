import { createRouter, createWebHistory } from 'vue-router';
import HealthPage from './HealthPage.vue';
import CustomerListPage from '../modules/customers/CustomerListPage.vue';
import CustomerNewPage from '../modules/customers/CustomerNewPage.vue';
import CustomerDetailPage from '../modules/customers/CustomerDetailPage.vue';
import CustomerEditPage from '../modules/customers/CustomerEditPage.vue';
import RightsHolderDetailPage from '../modules/customers/RightsHolderDetailPage.vue';
import LeadListPage from '../modules/leads/LeadListPage.vue';
import LeadNewPage from '../modules/leads/LeadNewPage.vue';
import LeadDetailPage from '../modules/leads/LeadDetailPage.vue';
import LeadEditPage from '../modules/leads/LeadEditPage.vue';
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
    {
      path: '/customers',
      component: CustomerListPage,
      meta: { section: '客户', breadcrumbs: ['客户'] },
    },
    {
      path: '/customers/new',
      component: CustomerNewPage,
      meta: { section: '客户', breadcrumbs: ['客户', '新建客户'] },
    },
    {
      path: '/customers/:id/edit',
      component: CustomerEditPage,
      meta: { section: '客户', breadcrumbs: ['客户', '编辑客户'] },
    },
    {
      path: '/customers/:customerId/rights-holders/:rightsHolderId',
      component: RightsHolderDetailPage,
      meta: { section: '客户', breadcrumbs: ['客户', '权利主体'] },
    },
    {
      path: '/customers/:id',
      component: CustomerDetailPage,
      meta: { section: '客户', breadcrumbs: ['客户', '客户详情'] },
    },
    {
      path: '/leads',
      component: LeadListPage,
      meta: { section: '线索', breadcrumbs: ['线索'] },
    },
    {
      path: '/leads/new',
      component: LeadNewPage,
      meta: { section: '线索', breadcrumbs: ['线索', '新建线索'] },
    },
    {
      path: '/leads/:id/edit',
      component: LeadEditPage,
      meta: { section: '线索', breadcrumbs: ['线索', '编辑线索'] },
    },
    {
      path: '/leads/:id',
      component: LeadDetailPage,
      meta: { section: '线索', breadcrumbs: ['线索', '线索详情'] },
    },
    {
      path: '/settings/people-access',
      component: PeopleAccessPage,
      meta: { section: '设置', breadcrumbs: ['设置', '人员与权限'] },
    },
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
