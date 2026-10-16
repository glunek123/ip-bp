import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, LawyerCaseDetail } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import CaseDetailPage from './CaseDetailPage.vue';
import LawyerCaseDetailPage from './LawyerCaseDetailPage.vue';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  getLawyerCase: vi.fn(),
  getLead: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original()),
  getCase: api.getCase,
  getLawyerCase: api.getLawyerCase,
}));
vi.mock('../../api/leads', async (original) => ({
  ...(await original()),
  getLead: api.getLead,
}));
const caseId = '11111111-1111-4111-8111-111111111111';
const filingId = '22222222-2222-4222-8222-222222222222';
function detail(): CaseDetail | LawyerCaseDetail {
  return {
    id: caseId,
    businessNo: 'CA-EF-001',
    stage: 'EXECUTING',
    version: 7,
    customer: { id: 'customer', name: '客户' },
    rightsHolder: { id: 'holder', name: '权利人' },
    department: { id: 'dept', name: '知产部' },
    lawyers: [],
    defendants: [],
    courtCaseNo: null,
    origin: { kind: 'NOTARY' },
    canMatch: false,
    canSubmitExecution: false,
    canConfirmExecution: false,
    canMailExecution: false,
    canSubmitExecutionFiling: false,
    canFinishExecution: false,
    canRecordClosure: false,
    canCorrectClosure: false,
    canArchive: false,
    canCorrectArchive: false,
    canSubmitComplaint: false,
    canConfirmComplaint: false,
    canMailComplaint: false,
    canSubmitFiling: false,
    canRegisterAcceptance: false,
    canUploadAcceptanceMaterials: false,
    canScheduleHearing: false,
    canCorrectHearing: false,
    canRegisterJudgment: false,
    canCorrectJudgment: false,
    canChooseJudgmentNextStep: false,
    canRevokeJudgmentNextStep: false,
    canSaveSecondInstance: false,
    canRegisterSecondInstanceResult: false,
    canRevokeSecondInstanceResult: false,
    owner: { id: 'actor', displayName: '办理人' },
    sourceLead: { id: 'lead', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'matter', businessNo: 'NZ-1' },
    certificate: {
      certificateNo: 'Z-1',
      certificateDate: '2026-10-01',
      issuedAt: '2026-10-01T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
    fees: [],
    matchedAt: null,
    matchedOn: null,
    executionFiling: { id: filingId },
    executionFilingFollowups: {
      filingId,
      canRecordFeedback: true,
      canSubmitSupplement: true,
      feedbacks: [],
      supplements: [],
    },
    secondInstance: {
      currentTrialRoundId: null,
      currentProgress: null,
      currentResult: null,
      rounds: [],
      progresses: [],
      results: [],
      revocations: [],
    },
    executionSubmission: { current: null, submissions: [], availableFiles: [] },
    executionConfirmation: null,
    executionMailing: null,
    executionFinish: null,
    closure: null,
    archive: null,
    hearing: {
      currentArrangement: null,
      currentAdvance: null,
      arrangements: [],
      advances: [],
      corrections: [],
    },
    judgment: { current: null, history: [], availableFiles: [] },
    judgmentNextStep: { current: null, history: [], revocations: [] },
    acceptance: null,
    acceptanceMaterials: {
      ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
      PAYMENT_LIST: { available: [], frozen: [], later: [] },
      SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
    },
    complaint: null,
    complaintConfirmation: null,
    complaintMailing: null,
    filingSubmission: null,
    acceptances: [],
  } as unknown as CaseDetail | LawyerCaseDetail;
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getCase.mockResolvedValue(detail());
  api.getLawyerCase.mockResolvedValue(detail());
  api.getLead.mockResolvedValue(null);
});
async function open(lawyer: boolean) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: lawyer ? 'LAWYER' : 'INTERNAL',
    user: { id: 'actor', displayName: '办理人', username: 'actor' },
    department: { id: 'dept', name: '知产部' },
    departments: [],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 4,
    expiresAt: '2026-10-17T00:00:00Z',
    csrfToken: 'csrf',
  };
  const page = lawyer ? LawyerCaseDetailPage : CaseDetailPage;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: { template: '<div />' } },
      { path: '/lawyer/cases', component: { template: '<div />' } },
      { path: '/cases/:id', component: page },
      { path: '/lawyer/cases/:id', component: page },
    ],
  });
  await router.push(`${lawyer ? '/lawyer' : ''}/cases/${caseId}`);
  await router.isReady();
  const wrapper = shallowMount(page, {
    global: {
      plugins: [pinia, router],
      stubs: {
        CaseWorkspaceShell: { template: '<div><slot name="details" /></div>' },
        CaseExecutionFilingFollowupPanel: {
          name: 'CaseExecutionFilingFollowupPanel',
          props: { item: Object, actorKey: String, lawyer: Boolean },
          template: '<div data-test="followup-host" />',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}
describe('execution filing followup detail hosts', () => {
  it.each([false, true])(
    'mounts only the real filing context for lawyer=%s',
    async (lawyer) => {
      const wrapper = await open(lawyer);
      const panel = wrapper.findComponent({
        name: 'CaseExecutionFilingFollowupPanel',
      });
      expect(panel.exists()).toBe(true);
      expect(panel.props('item').executionFilingFollowups.filingId).toBe(
        filingId,
      );
      expect(panel.props('actorKey')).toContain('actor:dept:4');
      expect(!!panel.props('lawyer')).toBe(lawyer);
      wrapper.unmount();
    },
  );
});
