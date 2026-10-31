import type { Prisma } from '../../generated/prisma/client';
import { assertExecutionSourceChain } from './case-execution-source';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const id = (n: string) =>
  `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function fixture() {
  const row = {
    currentTrialRoundId: null,
    currentJudgmentNextStepId: null,
    currentJudgmentNextStep: null,
    currentSecondInstanceResultId: null,
    currentSecondInstanceResult: null,
    currentExecutionSubmissionId: null,
    currentExecutionSubmission: null,
    executionConfirmation: null,
    executionMailing: null,
    executionFiling: null,
    executionFinish: null,
    closure: {
      id: id('3'),
      finishId: null,
      externalEntryId: null,
      earlyClosureId: id('4'),
    },
  };
  const root = {
    id: id('4'),
    case_id: id('1'),
    department_id: id('2'),
    from_stage: 'PENDING_MATCH',
    from_version: 1,
    to_version: 2,
    source_valid: true,
    original_source_valid: true,
    audit_valid: true,
    terminal: 3,
    case_version: 3,
  };
  const tx = {
    case: { findFirst: jest.fn(async () => row) },
    $queryRaw: jest.fn().mockResolvedValue([root]),
  };
  const run = (allow = false) =>
    assertExecutionSourceChain(
      tx as unknown as Prisma.TransactionClient,
      id('1'),
      id('2'),
      { kind: 'NORMAL' },
      allow,
    );
  return { row, root, tx, run };
}
describe('strict optional early root in existing execution source verifier', () => {
  it('preserves the old void return and gives explicit optional callers a null root', async () => {
    const { row, tx, run } = fixture();
    Object.assign(row, { closure: null });
    await expect(
      assertExecutionSourceChain(
        tx as unknown as Prisma.TransactionClient,
        id('1'),
        id('2'),
        { kind: 'NORMAL' },
      ),
    ).resolves.toBeUndefined();
    await expect(run(false)).resolves.toBeNull();
  });
  it('retains the old strict path for every caller that omits the new option', async () => {
    const { run, tx } = fixture();
    await expect(run()).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('cannot trust an enabling flag without a real same-case root', async () => {
    const { run, tx } = fixture();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(run(true)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
  });
  it('checks original source and exact audit/receipt independently', async () => {
    const { run, root } = fixture();
    root.original_source_valid = false;
    await expect(run(true)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    root.original_source_valid = true;
    root.audit_valid = false;
    await expect(run(true)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
  });
  it('verifies an exact register seed without weakening imported/finish predicates', async () => {
    const { run, root } = fixture();
    await expect(run(true)).resolves.toMatchObject({
      id: root.id,
      fromVersion: 1,
      toVersion: 2,
    });
    const text = readFileSync(
      resolve(process.cwd(), 'src/modules/cases/case-execution-source.ts'),
      'utf8',
    );
    expect(text).toContain('r.result_snapshot=jsonb_build_object');
    expect(text).toContain(
      "(a.details - 'authorizationRevision')=jsonb_build_object",
    );
    expect(text).toContain("NOT (a.details ? 'authorizationRevision')");
    expect(text).toContain(
      "jsonb_typeof(a.details->'authorizationRevision')='number'",
    );
    expect(text).toContain('BETWEEN 1 AND 9007199254740991');
    expect(text).toContain(
      "trunc((a.details->>'authorizationRevision')::numeric)",
    );
    expect(text).toContain("c.stage IN ('WAITING_ARCHIVE','ARCHIVED')");
    expect(text).toContain(
      "CASE WHEN c.stage='ARCHIVED' THEN (SELECT v.to_version FROM case_closure_versions v",
    );
    expect(text).toContain(
      'WHERE v.id=h.current_version_id AND v.case_id=c.id AND v.department_id=c.department_id',
    );
    expect(text).toContain(
      'case_closure_source_terminal_version(c.id,c.department_id,NULL,e.to_version)',
    );
    expect(text).toContain("start !== 'WAITING_ARCHIVE'");
    expect(text).toContain("start !== 'EXECUTING'");
  });
  it('accepts an independently validated external source root and rejects a failed audit', async () => {
    const { tx, root } = fixture();
    const source = {
      kind: 'EXTERNAL_ENTRY' as const,
      entryId: id('5'),
      initialStage: 'PENDING_MATCH' as const,
      stageReachedOn: '2026-01-01',
      known: {
        courtId: null,
        courtCaseNo: null,
        acceptedOn: null,
        secondInstanceAcceptedOn: null,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
    };
    await expect(
      assertExecutionSourceChain(
        tx as unknown as Prisma.TransactionClient,
        id('1'),
        id('2'),
        source,
        true,
      ),
    ).resolves.toMatchObject({ id: root.id });
    root.audit_valid = false;
    await expect(
      assertExecutionSourceChain(
        tx as unknown as Prisma.TransactionClient,
        id('1'),
        id('2'),
        source,
        true,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
  });
});
