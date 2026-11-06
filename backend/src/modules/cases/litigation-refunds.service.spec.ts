import { LitigationRefundsService } from './litigation-refunds.service';
import { ForbiddenException } from '@nestjs/common';

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const caseId = id('1');
const roundId = id('2');
const judgmentId = id('3');
const correctionId = id('4');
const secondId = id('5');
const versionId = id('6');
const itemId = id('7');
const actor = {
  userId: id('8'),
  departmentId: id('9'),
  authorizationRevision: 1,
};

function fixture(options: { revokedRound?: boolean; revokedSecond?: boolean; withItem?: boolean; listWithUnauthorized?: boolean } = {}) {
  const record = {
    id: caseId,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    businessNo: 'A001',
    stage: 'WAITING_EXECUTION_DOCUMENTS',
    rightsHolder: { name: '原告' },
    defendants: [{ name: '被告' }],
    lawyers: [],
    trialRounds: [{ id: roundId, sequence: 1, revokedAt: options.revokedRound ? new Date() : null }],
    acceptances: [{ trialRoundId: roundId, courtCaseNo: '一审案号', corrections: [] }],
    secondInstanceAcceptanceChanges: [],
    judgmentFacts: [
      { id: judgmentId, kind: 'REGISTER', trialRoundId: roundId, judgmentReceivedAt: new Date('2026-10-01') },
      { id: correctionId, kind: 'CORRECT', trialRoundId: roundId, judgmentReceivedAt: new Date('2026-10-02') },
    ],
    secondInstanceResults: [{
      id: secondId,
      trialRoundId: roundId,
      choiceId: null,
      resultReceivedAt: new Date('2026-10-03'),
      revocation: options.revokedSecond ? { id: id('a') } : null,
    }],
  };
  const tx = {
    userAccount: { findUnique: jest.fn().mockResolvedValue({ active: true, accountType: 'INTERNAL', authorizationRevision: 1 }) },
    case: { findFirst: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => ({ ...record, id: where.id })) },
    $queryRaw: jest.fn().mockImplementation(async (query: TemplateStringsArray) => {
      const sql = query.join('');
      if (sql.includes('SELECT case_id AS "caseId",id AS "versionId"'))
        return [{ caseId, versionId }, { caseId: id('b'), versionId }];
      if (sql.includes('transaction_timestamp()')) return [{ asOf: new Date('2026-11-06') }];
      if (sql.includes('FROM case_refund_inventory_versions') && sql.includes('ORDER BY revision DESC'))
        return options.withItem ? [{ versionId, priorVersionId: null, revision: 1, declaration: 'UNKNOWN' }] : [];
      if (sql.includes('FROM case_refund_inventory_items i') && sql.includes('LEFT JOIN case_litigation_refund_item_meta'))
        return [{ itemId, party: 'COURT', status: 'PENDING', description: '法院退费', amount: '12.30', sourceType: null, sourceId: null, trialRoundId: null, remark: null }];
      if (sql.includes('FROM chain c JOIN case_litigation_refund_item_meta'))
        return [{ sourceType: 'JUDGMENT', sourceId: judgmentId, trialRoundId: roundId, remark: '持续跟进' }];
      return [];
    }),
  };
  const db = { $transaction: (work: (client: typeof tx) => unknown) => work(tx) };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    authorizeCase: jest.fn().mockImplementation(async (_actor, action, current) => {
      if (options.listWithUnauthorized && action === 'case.read' && current.id === id('b'))
        throw new ForbiddenException();
    }),
  };
  const service = new LitigationRefundsService(db as never, access as never, {} as never);
  return { service, tx };
}

describe('litigation refund source continuity', () => {
  it('keeps the registered judgment source after a normal correction', async () => {
    const { service } = fixture();
    const workspace = await service.workspace(actor as never, caseId);
    expect(workspace.sources.map((source) => source.id)).toEqual([judgmentId, secondId]);
  });

  it('removes sources from a truly revoked round and a revoked second result', async () => {
    const revokedRound = await fixture({ revokedRound: true }).service.workspace(actor as never, caseId);
    expect(revokedRound.sources).toEqual([]);
    const revokedSecond = await fixture({ revokedSecond: true }).service.workspace(actor as never, caseId);
    expect(revokedSecond.sources.map((source) => source.id)).toEqual([judgmentId]);
  });

  it('reads the nearest ancestor sidecar when an old settlement command appends a version', async () => {
    const { service } = fixture({ withItem: true });
    const workspace = await service.workspace(actor as never, caseId);
    expect(workspace.items[0]).toMatchObject({
      itemId,
      source: { id: judgmentId, valid: true },
      remark: '持续跟进',
      courtNo: '一审案号',
    });
  });

  it('filters unreadable cases before list totals and export rows', async () => {
    const { service } = fixture({ withItem: true, listWithUnauthorized: true });
    const query = { page: 1, pageSize: 20 };
    const list = await service.list(actor as never, query);
    const exported = await service.list(actor as never, query, true);
    expect(list.total).toBe(1);
    expect(list.items.map((item) => item.caseId)).toEqual([caseId]);
    expect(exported.items.map((item) => item.caseId)).toEqual([caseId]);
  });
});
