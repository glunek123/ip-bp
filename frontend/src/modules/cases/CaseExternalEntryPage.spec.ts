import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalEntryOptions } from '../../api/cases';
import CaseExternalEntryPage from './CaseExternalEntryPage.vue';

const api = vi.hoisted(() => ({
  getExternalEntryOptions: vi.fn(),
  createExternalCaseEntry: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: api.replace, push: api.push }),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  getExternalEntryOptions: api.getExternalEntryOptions,
  createExternalCaseEntry: api.createExternalCaseEntry,
  todayShanghai: () => '2026-10-14',
}));

const stages = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
  'WAITING_ARCHIVE',
  'ARCHIVED',
] as const;

const options: ExternalEntryOptions = {
  canCreate: true,
  canCreateArchived: false,
  currentUser: { id: 'user-1', displayName: '运营' },
  customers: [
    {
      id: 'customer-1',
      name: '客户甲',
      rightsHolders: [{ id: 'holder-1', name: '权利人甲' }],
    },
  ],
  lawyers: [
    {
      accountId: 'lawyer-account-1',
      profileId: 'lawyer-profile-1',
      fullName: '律师甲',
      firm: null,
    },
  ],
  dictionaries: {
    stages: stages.map((value) => ({ value, label: value })),
    courts: [],
    platforms: [],
    caseTypes: [],
    infringementTypes: [],
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getExternalEntryOptions.mockResolvedValue(options);
  api.createExternalCaseEntry.mockResolvedValue({
    id: 'case-1',
    businessNo: 'CA-1',
    stage: 'PENDING_MATCH',
    version: 1,
    entryId: 'entry-1',
    recordedAt: '2026-10-14T00:00:00.000Z',
  });
});

describe('CaseExternalEntryPage', () => {
  it('requires a real date and keeps PENDING_MATCH defendants and lawyers empty', async () => {
    const wrapper = mount(CaseExternalEntryPage);
    await flushPromises();

    expect(
      (wrapper.find('input[type="date"]').element as HTMLInputElement).value,
    ).toBe('');
    expect(wrapper.text()).toContain('录入后的正常流程');

    const selects = wrapper.findAll('select');
    await selects[0]!.setValue('EXTERNAL_TRANSFER');
    await selects[1]!.setValue('PENDING_MATCH');
    await selects[2]!.setValue('customer-1');
    await selects[3]!.setValue('holder-1');
    const dates = wrapper.findAll('input[type="date"]');
    await dates[0]!.setValue('2026-10-13');
    const textInputs = wrapper.findAll('input[type="text"]');
    await textInputs[0]!.setValue('原系统案件记录');
    await wrapper.find('textarea').setValue('承接在办案件');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(api.createExternalCaseEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        initialStage: 'PENDING_MATCH',
        stageReachedOn: '2026-10-13',
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: expect.objectContaining({
          acceptedOn: null,
          courtId: null,
          infringementTypes: null,
        }),
      }),
    );
    expect(api.replace).toHaveBeenCalledWith('/cases/case-1');
  });
});
