import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '../../generated/prisma/client';
import { assertSettlementUploadContentTarget } from './settlement-upload-target-draft';
const actor = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};
const input = {
  targetId: 'target',
  caseId: 'case',
  expectedClosureVersionId: 'closure',
  contentVersionId: 'content',
};
describe('settlement upload target internal verifier draft', () => {
  it('keeps current revision, live scope and reverse linkage in the SQL contract', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261030290000_settlement_upload_target_draft/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('u.authorization_revision=target_revision');
    expect(sql).toContain("g.scope IN ('SELF','DEPARTMENT')");
    expect(sql).toContain("team.status='ACTIVE'");
    expect(sql).toContain('FOR SHARE NOWAIT');
    expect(sql).toContain(
      "'settlement upload authorization facts busy' USING ERRCODE='55P03'",
    );
    expect(sql).toContain(
      "'settlement upload authorization requires serializable scope' USING ERRCODE='23514'",
    );
    expect(sql).toContain(
      'DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_settlement_upload_target_reverse_final()',
    );
    expect(sql).toContain('d.settlement_update_upload_target_id=NEW.id');
  });
  it('binds exact target, current case/closure, actor, draft and content', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'content' }]);
    const tx = {
      $queryRawUnsafe: query,
    } as unknown as Prisma.TransactionClient;
    await assertSettlementUploadContentTarget(tx, actor, input);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('v.source_upload_draft_id=d.id'),
      'target',
      'case',
      'department',
      'actor',
      'closure',
      'content',
      1,
    );
  });
  it('rejects a missing authoritative provenance match', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    } as unknown as Prisma.TransactionClient;
    await expect(
      assertSettlementUploadContentTarget(tx, actor, input),
    ).rejects.toThrow('SETTLEMENT_UPLOAD_TARGET_CHANGED');
  });
  it('rejects an external actor before querying provenance', async () => {
    const query = jest.fn();
    const tx = {
      $queryRawUnsafe: query,
    } as unknown as Prisma.TransactionClient;
    await expect(
      assertSettlementUploadContentTarget(
        tx,
        { ...actor, lawyerAccountId: 'lawyer' },
        input,
      ),
    ).rejects.toThrow('SETTLEMENT_UPLOAD_FORBIDDEN');
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['stale revision', 'inactive team'])(
    'propagates current authorization rejection for %s before reading content',
    async () => {
      const query = jest
        .fn()
        .mockRejectedValueOnce(
          new Error('settlement upload actor stale or inactive'),
        );
      const tx = {
        $queryRawUnsafe: query,
      } as unknown as Prisma.TransactionClient;
      await expect(
        assertSettlementUploadContentTarget(tx, actor, input),
      ).rejects.toThrow();
      expect(query).toHaveBeenCalledTimes(1);
    },
  );
});
