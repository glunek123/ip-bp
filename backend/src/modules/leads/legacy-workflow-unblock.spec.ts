import {
  isLegacyBackfillMatter,
  notaryDisplayCapabilities,
} from './notary-display-read';
import { ClientLeadService } from './client-lead.service';
import { LeadNotaryService } from './lead-notary.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';
import { NotaryCertificateService } from './notary-certificate.service';
import { initializeNotaryEvidence } from '../evidence';
import { initializeNotaryFees } from '../settlements';

jest.mock('../evidence', () => ({
  initializeNotaryEvidence: jest.fn().mockResolvedValue({
    groupId: 'group-1',
    created: true,
  }),
}));

jest.mock('../settlements', () => ({
  initializeNotaryFees: jest.fn().mockResolvedValue(undefined),
  syncNotaryMatterCost: jest.fn().mockResolvedValue(undefined),
  syncNotaryReturnFees: jest.fn().mockResolvedValue(undefined),
}));

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

const leadId = '33333333-3333-4333-8333-333333333333';
const matterId = '44444444-4444-4444-8444-444444444444';
const customerId = '55555555-5555-4555-8555-555555555555';
const officeId = '66666666-6666-4666-8666-666666666666';

describe('Migrated in-progress Leads and NotaryMatters workflows', () => {
  it('enables all in-progress notary capabilities for legacy backfill matters missing prior records', async () => {
    const access = {
      authorizeLead: jest.fn().mockResolvedValue(undefined),
    };
    const base = {
      departmentId: actor.departmentId,
      evidenceMode: 'ONLINE_PURCHASE',
      sourceSnapshot: { legacyId: '999' },
      sourceLead: {
        responsibleUserId: actor.userId,
        teamId: null,
        externalSourceRef: 'nocobase:999',
        creationChannel: 'HISTORICAL',
      },
      evidence: null,
      opening: null,
      openingReviewDecision: null,
      issuanceDecision: null,
    };
    expect(isLegacyBackfillMatter(base)).toBe(true);

    const waitingUnbox = await notaryDisplayCapabilities(access as never, actor, {
      ...base,
      stage: 'WAITING_UNBOX',
    });
    expect(waitingUnbox.recordOpening).toBe(true);

    const unboxReview = await notaryDisplayCapabilities(access as never, actor, {
      ...base,
      stage: 'UNBOX_REVIEW',
    });
    expect(unboxReview.reviewOpening).toBe(true);

    const issuanceDecision = await notaryDisplayCapabilities(
      access as never,
      actor,
      { ...base, stage: 'ISSUANCE_DECISION' },
    );
    expect(issuanceDecision.decideIssuance).toBe(true);

    const waitingCert = await notaryDisplayCapabilities(access as never, actor, {
      ...base,
      stage: 'WAITING_CERTIFICATE',
    });
    expect(waitingCert.proxyIssueCertificate).toBe(true);

    const waitingReturn = await notaryDisplayCapabilities(
      access as never,
      actor,
      { ...base, stage: 'WAITING_RETURN' },
    );
    expect(waitingReturn.archiveReturn).toBe(true);
  });

  it('allows proxy review on HISTORICAL lead missing pushedAt/pushedByUserId and backfills push metadata', async () => {
    const decidedAt = new Date('2026-11-28T05:00:00Z');
    const tx = {
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          accountType: 'INTERNAL',
          displayName: '运营专员',
        }),
      },
      clientLeadReviewReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      },
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ id: leadId }])
        .mockResolvedValueOnce([{ id: officeId }])
        .mockResolvedValueOnce([{ sequence: 1, business_date: '2026-11-28' }]),
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: leadId,
          customerId,
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          teamId: null,
          businessNo: 'L-HIST-1',
          status: 'WAITING_REVIEW',
          version: 1,
          creationChannel: 'HISTORICAL',
          activeReviewDecisionId: null,
          pushedAt: null,
          pushedByUserId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: leadId }),
      },
      leadReviewDecision: {
        create: jest.fn().mockResolvedValue({
          id: 'rev-1',
          decidedAt,
        }),
      },
    };
    const db = {
      $transaction: jest.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const access = {
      authorizeLead: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ClientLeadService(
      db as never,
      {} as never,
      access as never,
    );

    const result = await service.review(
      actor,
      leadId,
      'k1',
      { result: 'INFRINGEMENT', expectedVersion: 1 },
      true,
    );
    expect(result.status).toBe('WAITING_EVIDENCE_DECISION');
    expect(result.version).toBe(2);
    expect(tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'WAITING_EVIDENCE_DECISION',
          pushedByUserId: actor.userId,
        }),
      }),
    );
  });

  it('allows transferring a HISTORICAL WAITING_EVIDENCE_DECISION lead missing reviewDecision to notary', async () => {
    const office = { id: officeId, name: '杭州互联网公证处', status: 'ACTIVE' };
    const tx = {
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          accountType: 'INTERNAL',
        }),
      },
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ id: leadId }])
        .mockResolvedValueOnce([{ id: officeId }])
        .mockResolvedValueOnce([{ sequence: 1, business_date: '2026-11-28' }]),
      $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: leadId,
          businessNo: 'L-HIST-2',
          departmentId: actor.departmentId,
          customerId,
          rightsHolderId: 'holder-1',
          responsibleUserId: actor.userId,
          teamId: null,
          status: 'WAITING_EVIDENCE_DECISION',
          version: 1,
          creationChannel: 'HISTORICAL',
          activeReviewDecisionId: null,
          reviewDecision: null,
          evidenceDecision: null,
          customer: { profileStatus: 'ADMITTED' },
          caseType: 'CIVIL',
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: new Date('2025-05-01T00:00:00Z'),
          shopName: '测试店铺',
          products: [
            {
              id: 'prod-1',
              position: 1,
              title: '侵权商品',
              url: 'https://example.com',
              quantity: 10,
              unitPrice: { toFixed: () => '99.00' },
              commentCount: 5,
              estimatedAmount: { toFixed: () => '990.00' },
            },
          ],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notaryOffice: {
        findFirst: jest.fn().mockResolvedValue(office),
      },
      notaryMatter: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: matterId }),
      },
      notaryMatterProduct: { createMany: jest.fn() },
      auditEvent: { create: jest.fn() },
      leadCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      businessNumber: { findFirst: jest.fn() },
    };
    const db = {
      $transaction: jest.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const materials = {
      listCurrentReferenceVersionIds: jest.fn().mockResolvedValue([]),
      assertAvailableVersions: jest.fn().mockResolvedValue([]),
    };
    const access = {
      authorizeLead: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LeadNotaryService(
      db as never,
      access as never,
      materials as never,
    );

    const res = await service.transfer(actor, leadId, 'k2', {
      selectedProductIds: ['prod-1'],
      selectedContentVersionIds: [],
      notaryOfficeId: officeId,
      evidenceMode: 'ONLINE_PURCHASE',
      batchPurpose: '线上取证',
      expectedVersion: 1,
    });
    expect(res.stage).toBe('PENDING_EVIDENCE');
    expect(tx.notaryMatter.create).toHaveBeenCalledTimes(1);
  });

  it('unblocks UNBOX_REVIEW without opening record, ISSUANCE_DECISION without review anchor, and WAITING_CERTIFICATE without evidence/decision anchors', async () => {
    const decidedAt = new Date('2026-11-28T06:00:00Z');
    const reviewTx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
      notaryMatter: {
        findFirst: jest.fn().mockResolvedValue({
          customerId,
          departmentId: actor.departmentId,
          stage: 'UNBOX_REVIEW',
          version: 1,
          sourceSnapshot: { source: 'NOCOBASE' },
          opening: null,
          sourceLead: {
            responsibleUserId: actor.userId,
            teamId: null,
            pushedAt: null,
            pushedByUserId: null,
            externalSourceRef: 'nocobase:101',
            creationChannel: 'HISTORICAL',
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          accountType: 'INTERNAL',
          active: true,
          displayName: '运营专员',
        }),
      },
      notaryOpeningReviewReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      materialReference: { findMany: jest.fn().mockResolvedValue([]) },
      notaryOpeningReviewDecision: {
        create: jest.fn().mockResolvedValue({ id: 'rev-m1', decidedAt }),
      },
      notaryOpeningReviewAuditEvent: { create: jest.fn() },
    };
    const reviewService = new NotaryOpeningReviewService(
      {
        $transaction: jest.fn(async (run: (c: unknown) => unknown) =>
          run(reviewTx),
        ),
      } as never,
      { authorizeLead: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const reviewRes = await reviewService.review(actor, matterId, 'k-rev', {
      result: 'INFRINGEMENT',
      expectedVersion: 1,
    });
    expect(reviewRes.stage).toBe('ISSUANCE_DECISION');

    const issuanceTx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
      notaryMatter: {
        findFirst: jest.fn().mockResolvedValue({
          customerId,
          departmentId: actor.departmentId,
          stage: 'ISSUANCE_DECISION',
          version: 1,
          sourceSnapshot: { source: 'NOCOBASE' },
          sourceLead: {
            responsibleUserId: actor.userId,
            teamId: null,
            externalSourceRef: 'nocobase:101',
            creationChannel: 'HISTORICAL',
          },
          openingReviewDecision: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          accountType: 'INTERNAL',
          active: true,
          displayName: '运营专员',
        }),
      },
      notaryMatterCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      notaryOpeningReviewDecision: {
        create: jest.fn().mockResolvedValue({
          id: 'rev-anchor',
          result: 'INFRINGEMENT',
          reason: null,
        }),
      },
      notaryIssuanceDecision: {
        create: jest.fn().mockResolvedValue({
          id: 'iss-1',
          openingRemark: '准予出证',
          decidedAt,
        }),
      },
      notaryIssuanceDecisionAuditEvent: { create: jest.fn() },
      auditEvent: { create: jest.fn() },
    };
    const issuanceService = new NotaryIssuanceDecisionService(
      {
        $transaction: jest.fn(async (run: (c: unknown) => unknown) =>
          run(issuanceTx),
        ),
      } as never,
      { authorizeLead: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const issRes = await issuanceService.decide(actor, matterId, 'k-iss', {
      decision: 'ISSUE',
      openingRemark: '准予出证',
      expectedVersion: 1,
    });
    expect(issRes.stage).toBe('WAITING_CERTIFICATE');
    expect(issuanceTx.notaryOpeningReviewDecision.create).toHaveBeenCalledTimes(
      1,
    );

    const certTx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
      notaryMatter: {
        findFirst: jest.fn().mockResolvedValue({
          id: matterId,
          departmentId: actor.departmentId,
          notaryOfficeId: officeId,
          stage: 'WAITING_CERTIFICATE',
          version: 1,
          sourceLeadId: leadId,
          customerId,
          rightsHolderId: 'holder-1',
          responsibleUserId: actor.userId,
          sourceSnapshot: { source: 'NOCOBASE' },
          legacyForensicsOpenOn: new Date('2025-07-01T00:00:00.000Z'),
          sourceLead: {
            needDisclose: false,
            shopName: '测试店铺',
            remark: null,
            externalSourceRef: 'nocobase:101',
            creationChannel: 'HISTORICAL',
            products: [],
            platform: 'TAOBAO',
            responsibleUserId: actor.userId,
            teamId: null,
          },
          routineProfile: null,
          selectedProducts: [],
          notaryOffice: { name: '杭州互联网公证处', status: 'ACTIVE' },
          evidence: null,
          openingReviewDecision: null,
          issuanceDecision: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          accountType: 'INTERNAL',
          active: true,
          displayName: '运营专员',
        }),
      },
      notaryMatterCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      contentVersion: { findMany: jest.fn().mockResolvedValue([]) },
      notaryMatterEvidence: { create: jest.fn() },
      notaryOpeningReviewDecision: {
        create: jest.fn().mockResolvedValue({ id: 'rev-anchor-2' }),
      },
      notaryIssuanceDecision: {
        create: jest.fn().mockResolvedValue({ id: 'iss-anchor-2' }),
      },
      notaryCertificate: {
        create: jest.fn().mockResolvedValue({ id: 'cert-1' }),
      },
      notaryCertificateFee: { createMany: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'aud-1' }) },
    };
    const certService = new NotaryCertificateService(
      {
        $transaction: jest.fn(async (run: (c: unknown) => unknown) =>
          run(certTx),
        ),
      } as never,
      {
        assertAvailableVersions: jest.fn().mockResolvedValue([]),
        freezeReferences: jest.fn(),
      } as never,
      {
        createFromNotaryCertificate: jest
          .fn()
          .mockResolvedValue({ id: 'case-new', businessNo: 'CA-2026-001' }),
      } as never,
      { authorizeLead: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const certRes = await certService.issue(
      actor,
      matterId,
      'k-cert',
      {
        expectedVersion: 1,
        certificateNo: '(2026)浙杭证字第1号',
        certificateDate: '2026-11-28',
        contentVersionIds: [],
        needDisclose: false,
        sampleFeeAmount: '100',
        disclosureContentVersionIds: [],
        fees: {
          notary: { state: 'KNOWN', amount: '1000' },
          investigation: { state: 'PENDING', amount: null },
          disclosure: { state: 'PENDING', amount: null },
        },
      },
      true,
    );
    expect(certRes.stage).toBe('ARCHIVED');
    expect(certRes.case.id).toBe('case-new');
    expect(certTx.notaryMatterEvidence.create).toHaveBeenCalledTimes(1);
    expect(certTx.notaryIssuanceDecision.create).toHaveBeenCalledTimes(1);
    expect(initializeNotaryEvidence).toHaveBeenCalled();
    expect(initializeNotaryFees).toHaveBeenCalled();
  });
});
