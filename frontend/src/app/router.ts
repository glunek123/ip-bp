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
import NotaryMatterDetailPage from '../modules/leads/NotaryMatterDetailPage.vue';
import NotaryOfficesPage from '../modules/leads/NotaryOfficesPage.vue';
import LoginPage from '../modules/auth/LoginPage.vue';
import PeopleAccessPage from '../modules/organization/PeopleAccessPage.vue';
import ClientLeadListPage from '../modules/client/ClientLeadListPage.vue';
import ClientLeadDetailPage from '../modules/client/ClientLeadDetailPage.vue';
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
      meta: { audience: 'INTERNAL', section: '客户', breadcrumbs: ['客户'] },
    },
    {
      path: '/customers/new',
      component: CustomerNewPage,
      meta: {
        audience: 'INTERNAL',
        section: '客户',
        breadcrumbs: ['客户', '新建客户'],
      },
    },
    {
      path: '/customers/:id/edit',
      component: CustomerEditPage,
      meta: {
        audience: 'INTERNAL',
        section: '客户',
        breadcrumbs: ['客户', '编辑客户'],
      },
    },
    {
      path: '/customers/:customerId/rights-holders/:rightsHolderId',
      component: RightsHolderDetailPage,
      meta: {
        audience: 'INTERNAL',
        section: '客户',
        breadcrumbs: ['客户', '权利主体'],
      },
    },
    {
      path: '/customers/:id',
      component: CustomerDetailPage,
      meta: {
        audience: 'INTERNAL',
        section: '客户',
        breadcrumbs: ['客户', '客户详情'],
      },
    },
    {
      path: '/leads',
      component: LeadListPage,
      meta: { audience: 'INTERNAL', section: '线索', breadcrumbs: ['线索'] },
    },
    {
      path: '/leads/new',
      component: LeadNewPage,
      meta: {
        audience: 'INTERNAL',
        section: '线索',
        breadcrumbs: ['线索', '新建线索'],
      },
    },
    {
      path: '/leads/:id/edit',
      component: LeadEditPage,
      meta: {
        audience: 'INTERNAL',
        section: '线索',
        breadcrumbs: ['线索', '编辑线索'],
      },
    },
    {
      path: '/leads/:id',
      component: LeadDetailPage,
      meta: {
        audience: 'INTERNAL',
        section: '线索',
        breadcrumbs: ['线索', '线索详情'],
      },
    },
    {
      path: '/notary-matters/:id',
      component: NotaryMatterDetailPage,
      meta: {
        audience: 'INTERNAL',
        section: '线索',
        breadcrumbs: ['线索', '取证批次'],
      },
    },
    {
      path: '/notary-offices',
      component: NotaryOfficesPage,
      meta: {
        audience: 'INTERNAL',
        section: '设置',
        breadcrumbs: ['设置', '公证处'],
      },
    },
    {
      path: '/settings/people-access',
      component: PeopleAccessPage,
      meta: {
        audience: 'INTERNAL',
        section: '设置',
        breadcrumbs: ['设置', '人员与权限'],
      },
    },
    {
      path: '/client/leads',
      component: ClientLeadListPage,
      meta: {
        audience: 'CLIENT',
        section: '待审核线索',
        breadcrumbs: ['待审核线索'],
      },
    },
    {
      path: '/client/leads/:id',
      component: ClientLeadDetailPage,
      meta: {
        audience: 'CLIENT',
        section: '待审核线索',
        breadcrumbs: ['待审核线索', '线索详情'],
      },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore(pinia);
  if (to.meta.public === true) {
    if (to.path === '/login' && auth.session !== null)
      return homeFor(auth.session.principalType);
    return true;
  }
  try {
    await auth.restore();
  } catch {
    return '/health';
  }
  if (auth.session !== null) {
    const audience = to.meta.audience;
    if (
      (audience === 'INTERNAL' || audience === 'CLIENT') &&
      audience !== auth.session.principalType
    )
      return homeFor(auth.session.principalType);
    return true;
  }
  const returnTo =
    to.fullPath.startsWith('/') && !to.fullPath.startsWith('//')
      ? to.fullPath
      : '/customers';
  return { path: '/login', query: { returnTo } };
});

function homeFor(principalType: 'INTERNAL' | 'CLIENT'): string {
  return principalType === 'CLIENT' ? '/client/leads' : '/customers';
}
