import { ApiError } from '../api/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  session: null as null | {
    principalType: 'INTERNAL' | 'CLIENT' | 'NOTARY' | 'LAWYER';
    user: { id: string };
  },
  restore: vi.fn(),
}));

vi.mock('../stores/auth', () => ({ useAuthStore: () => auth }));

import { router } from './router';
import EvidencePage from '../modules/evidence/EvidencePage.vue';
import CaseHandlingGroupsPage from '../modules/cases/CaseHandlingGroupsPage.vue';
import ReportsPage from '../modules/reports/ReportsPage.vue';

beforeEach(async () => {
  auth.session = null;
  vi.resetAllMocks();
  auth.restore.mockResolvedValue(undefined);
  await router.push('/health');
});

describe('reports routing', () => {
  it('resolves the actual reports page only for an internal account', async () => {
    auth.session = { principalType: 'INTERNAL', user: { id: 'reader' } };
    await router.push('/reports');
    expect(router.currentRoute.value.matched[0]!.components?.default).toBe(
      ReportsPage,
    );
    expect(router.currentRoute.value.meta).toMatchObject({
      audience: 'INTERNAL',
      section: '数据报表',
    });
  });
  it('preserves an unauthenticated reports destination for login', async () => {
    await router.push('/reports');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.returnTo).toBe('/reports');
  });
  it.each(['CLIENT', 'LAWYER', 'NOTARY'] as const)(
    'rejects reports navigation for %s',
    async (principalType) => {
      auth.session = { principalType, user: { id: 'external' } };
      await router.push('/reports');
      expect(router.currentRoute.value.path).not.toBe('/reports');
    },
  );
});

describe('evidence routing', () => {
  it('resolves the actual EvidencePage for an internal account', async () => {
    auth.session = { principalType: 'INTERNAL', user: { id: 'reader' } };
    await router.push('/evidence');
    expect(router.currentRoute.value.path).toBe('/evidence');
    expect(router.currentRoute.value.matched).toHaveLength(1);
    expect(router.currentRoute.value.matched[0]!.components?.default).toBe(
      EvidencePage,
    );
    expect(router.currentRoute.value.meta).toMatchObject({
      audience: 'INTERNAL',
      section: '证物',
      breadcrumbs: ['证物'],
    });
  });
  it('preserves an unauthenticated evidence destination for login', async () => {
    await router.push('/evidence');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.returnTo).toBe('/evidence');
  });
  it.each([
    ['CLIENT', '/client/leads'],
    ['LAWYER', '/lawyer/cases'],
    ['NOTARY', '/notary-portal/matters'],
  ] as const)(
    'keeps %s on its external home',
    async (principalType, expected) => {
      auth.session = { principalType, user: { id: 'external' } };
      await router.push('/evidence');
      expect(router.currentRoute.value.path).toBe(expected);
    },
  );
});

describe('internal handling group routing', () => {
  it.each([
    '/case-handling-groups',
    '/case-handling-groups/55555555-5555-4555-8555-555555555555',
  ])(
    'resolves the real group page and preserves list return context for %s',
    async (path) => {
      auth.session = { principalType: 'INTERNAL', user: { id: 'reader' } };
      await router.push({
        path,
        query: { returnTo: '/cases?view=department&page=3&q=合成#records' },
      });
      expect(router.currentRoute.value.matched[0]?.components?.default).toBe(
        CaseHandlingGroupsPage,
      );
      expect(router.currentRoute.value.meta.audience).toBe('INTERNAL');
      expect(router.currentRoute.value.meta.caseWorkspace).not.toBe(true);
      expect(router.currentRoute.value.query.returnTo).toBe(
        '/cases?view=department&page=3&q=合成#records',
      );
    },
  );
  it('preserves the full unauthenticated group destination for normal login', async () => {
    await router.push(
      '/case-handling-groups?page=2&returnTo=%2Fcases%3Fpage%3D3#original',
    );
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.returnTo).toBe(
      '/case-handling-groups?page=2&returnTo=%2Fcases%3Fpage%3D3#original',
    );
  });
  it.each([
    ['CLIENT', '/client/leads'],
    ['LAWYER', '/lawyer/cases'],
    ['NOTARY', '/notary-portal/matters'],
  ] as const)(
    'does not expose the internal group route to %s',
    async (principalType, home) => {
      auth.session = { principalType, user: { id: 'external' } };
      await router.push('/case-handling-groups');
      expect(router.currentRoute.value.path).toBe(home);
    },
  );
});

describe('internal case workspace routing', () => {
  beforeEach(() => {
    auth.session = { principalType: 'INTERNAL', user: { id: 'operator-user' } };
  });

  it.each(['details', 'files', 'fees'])(
    'keeps the %s tab and the original case bookmark',
    async (tab) => {
      await router.push(
        `/cases/case-1?tab=${tab}&view=department&page=3&stage=WAITING_HEARING#records`,
      );
      expect(router.currentRoute.value.meta.caseWorkspace).toBe(true);
      expect(router.currentRoute.value.query).toEqual({
        tab,
        view: 'department',
        page: '3',
        stage: 'WAITING_HEARING',
      });
      expect(router.currentRoute.value.hash).toBe('#records');
    },
  );

  it.each(['tab', 'tab=', 'tab=history', 'tab=files&tab=fees'])(
    'normalizes %s to default details without changing list filters',
    async (invalidTab) => {
      await router.push(
        `/cases/case-1?${invalidTab}&view=mine&page=2&stageGroup=EXECUTION_PREPARATION#records`,
      );
      expect(router.currentRoute.value.path).toBe('/cases/case-1');
      expect(router.currentRoute.value.query).toEqual({
        view: 'mine',
        page: '2',
        stageGroup: 'EXECUTION_PREPARATION',
      });
      expect(router.currentRoute.value.hash).toBe('#records');
    },
  );

  it.each(['/cases', '/customers/customer-1', '/leads/lead-1'])(
    'does not apply workspace metadata or tab normalization to %s',
    async (path) => {
      await router.push(`${path}?tab=history`);
      expect(router.currentRoute.value.meta.caseWorkspace).not.toBe(true);
      expect(router.currentRoute.value.query.tab).toBe('history');
    },
  );

  it.each([
    ['LAWYER', '/lawyer/cases/case-1'],
    ['CLIENT', '/client/cases/case-1'],
    ['NOTARY', '/notary-portal/matters/matter-1'],
  ] as const)(
    'keeps the existing %s projection separate from the internal workspace',
    async (principalType, path) => {
      auth.session = { principalType, user: { id: 'external-user' } };
      await router.push(`${path}?tab=history`);
      expect(router.currentRoute.value.path).toBe(path);
      expect(router.currentRoute.value.meta.caseWorkspace).not.toBe(true);
      expect(router.currentRoute.value.query.tab).toBe('history');
    },
  );

  it('retains an unauthenticated workspace URL for login before normalizing it', async () => {
    auth.session = null;
    await router.push('/cases/case-1?tab=history&view=department&page=3');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.returnTo).toBe(
      '/cases/case-1?tab=history&view=department&page=3',
    );
    auth.session = { principalType: 'INTERNAL', user: { id: 'operator-user' } };
    await router.push('/cases/case-1?tab=history&view=department&page=3');
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      page: '3',
    });
  });
});

describe('authentication routing', () => {
  it.each([
    ['INTERNAL', '/calendar'],
    ['LAWYER', '/lawyer/calendar'],
    ['CLIENT', '/client/calendar'],
  ] as const)(
    'keeps %s on its own calendar entry',
    async (principalType, path) => {
      auth.session = { principalType, user: { id: 'calendar-user' } };
      await router.push(path);
      expect(router.currentRoute.value.path).toBe(path);
      auth.session = { principalType: 'NOTARY', user: { id: 'notary-user' } };
      await router.push('/health');
      await router.push(path);
      expect(router.currentRoute.value.path).toBe('/notary-portal/matters');
    },
  );
  it('does not run session restoration before entering a public page', async () => {
    await router.push('/login');

    expect(router.currentRoute.value.path).toBe('/login');
    expect(auth.restore).not.toHaveBeenCalled();
  });

  it('shows the connection page when protected-route restoration fails', async () => {
    auth.restore.mockRejectedValue(
      new ApiError('无法连接服务', 0, 'NETWORK_ERROR'),
    );

    await router.push('/customers/customer-1?tab=history');

    expect(router.currentRoute.value.path).toBe('/health');
  });

  it('keeps the protected destination as a safe login return path', async () => {
    await router.push('/customers/customer-1?tab=history');

    expect(router.currentRoute.value.fullPath).toBe(
      '/login?returnTo=/customers/customer-1?tab=history',
    );
  });

  it('protects the personnel management route', async () => {
    await router.push('/settings/people-access');

    expect(router.currentRoute.value.fullPath).toBe(
      '/login?returnTo=/settings/people-access',
    );
  });

  it('keeps internal case routes inaccessible to client and notary principals', async () => {
    auth.session = { principalType: 'CLIENT', user: { id: 'client-user' } };
    await router.push('/cases/case-1');
    expect(router.currentRoute.value.path).toBe('/client/leads');
    auth.session = { principalType: 'NOTARY', user: { id: 'notary-user' } };
    await router.push('/cases');
    expect(router.currentRoute.value.path).toBe('/notary-portal/matters');
    auth.session = { principalType: 'INTERNAL', user: { id: 'operator-user' } };
    await router.push('/cases/case-1');
    expect(router.currentRoute.value.path).toBe('/cases/case-1');
  });

  it('protects the notary office settings route for internal accounts', async () => {
    await router.push('/notary-offices');
    expect(router.currentRoute.value.fullPath).toBe(
      '/login?returnTo=/notary-offices',
    );

    auth.session = { principalType: 'CLIENT', user: { id: 'client-user' } };
    await router.push('/notary-offices');
    expect(router.currentRoute.value.path).toBe('/client/leads');
  });

  it.each([
    '/leads',
    '/leads/new',
    '/leads/lead-1',
    '/leads/lead-1/edit',
    '/notary-matters/matter-1',
    '/notary-matters',
  ])('protects the lead route %s', async (path) => {
    await router.push(path);

    expect(router.currentRoute.value.fullPath).toBe(`/login?returnTo=${path}`);
  });

  it('keeps client and internal routes separated by principal type', async () => {
    auth.session = {
      principalType: 'CLIENT',
      user: { id: 'client-user' },
    };
    await router.push('/customers');
    expect(router.currentRoute.value.path).toBe('/client/leads');

    await router.push('/client/leads/lead-1');
    expect(router.currentRoute.value.path).toBe('/client/leads/lead-1');
    await router.push('/client/cases');
    expect(router.currentRoute.value.path).toBe('/client/cases');
    await router.push('/client/cases/case-1');
    expect(router.currentRoute.value.path).toBe('/client/cases/case-1');

    auth.session = {
      principalType: 'INTERNAL',
      user: { id: 'operator-user' },
    };
    await router.push('/client/leads');
    expect(router.currentRoute.value.path).toBe('/customers');
  });

  it('opens the correct home when an authenticated principal visits login', async () => {
    auth.session = {
      principalType: 'CLIENT',
      user: { id: 'client-user' },
    };
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/client/leads');
  });

  it('isolates notary routes and opens the notary work queue after login', async () => {
    await router.push('/notary-portal/matters/matter-1');
    expect(router.currentRoute.value.fullPath).toBe(
      '/login?returnTo=/notary-portal/matters/matter-1',
    );
    auth.session = { principalType: 'NOTARY', user: { id: 'notary-user' } };
    await router.push('/notary-portal/matters/matter-1');
    expect(router.currentRoute.value.path).toBe(
      '/notary-portal/matters/matter-1',
    );
    await router.push('/customers');
    expect(router.currentRoute.value.path).toBe('/notary-portal/matters');
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/notary-portal/matters');
  });

  it('opens the lawyer case queue and rejects other audience routes', async () => {
    auth.session = { principalType: 'LAWYER', user: { id: 'lawyer-1' } };
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/lawyer/cases');

    await router.push('/lawyer/cases/case-1');
    expect(router.currentRoute.value.path).toBe('/lawyer/cases/case-1');
    await router.push('/cases?view=department');
    expect(router.currentRoute.value.path).toBe('/lawyer/cases');
    await router.push('/settings/lawyer-accounts');
    expect(router.currentRoute.value.path).toBe('/lawyer/cases');
  });
});
