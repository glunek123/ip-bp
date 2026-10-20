import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { NotaryRecordEditService } from './notary-record-edit.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = '33333333-3333-4333-8333-333333333333';
const evidence = {
  expectedVersion: 3,
  expectedRevision: 0,
  correctionReason: '  凭单核对  ',
  evidenceAt: '2026-10-17',
  logistics: [
    {
      companyState: 'PRESENT' as const,
      companyValue: ' 真实快递 ',
      trackingState: 'PRESENT' as const,
      trackingValue: ' 真实单号 ',
    },
  ],
};
function fixture() {
  const state = {
    stage: 'UNBOX_REVIEW',
    version: 3,
    evidence: { matterId },
    opening: { matterId },
    sourceLead: { responsibleUserId: actor.userId, teamId: 'team-1' },
    departmentId: actor.departmentId,
  };
  const receipts = new Map<string, Record<string, unknown>>();
  let evidenceRevision = 0;
  let senderRevision = 0;
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
    notaryMatter: {
      findFirst: jest.fn().mockImplementation(async () => ({ ...state })),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    notaryMatterCommandReceipt: {
      findUnique: jest.fn().mockImplementation(
        async ({
          where,
        }: {
          where: {
            departmentId_actorUserId_action_idempotencyKey: {
              action: string;
              idempotencyKey: string;
            };
          };
        }) => {
          const identity = where.departmentId_actorUserId_action_idempotencyKey;
          return (
            receipts.get(`${identity.action}:${identity.idempotencyKey}`) ??
            null
          );
        },
      ),
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => {
            receipts.set(`${data.action}:${data.idempotencyKey}`, {
              requestFingerprint: data.requestFingerprint,
              resultMatterId: data.resultMatterId,
              resultSnapshot: data.resultSnapshot,
            });
            return data;
          },
        ),
    },
    notaryEvidenceCorrection: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          evidenceRevision === 0 ? null : { revision: evidenceRevision },
        ),
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: { revision: number } }) => {
            evidenceRevision = data.revision;
            return data;
          },
        ),
    },
    notaryOpeningSenderCorrection: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          senderRevision === 0 ? null : { revision: senderRevision },
        ),
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: { revision: number } }) => {
            senderRevision = data.revision;
            return data;
          },
        ),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const db = {
    $transaction: jest
      .fn()
      .mockImplementation(
        async (body: (client: typeof tx) => Promise<unknown>) => body(tx),
      ),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  const service = new NotaryRecordEditService(
    db as unknown as DatabaseService,
    access as unknown as AccessControlService,
  );
  return { state, tx, db, access, service };
}

describe('notary record corrections', () => {
  it('appends a real-ID evidence revision, audit and receipt without mutating workflow or original facts', async () => {
    const f = fixture();
    const result = await f.service.correctEvidence(
      actor,
      matterId,
      'unchanged-key',
      evidence,
    );
    expect(result).toMatchObject({ matterId, kind: 'EVIDENCE', revision: 1 });
    expect(result.correctionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(f.tx.notaryEvidenceCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 1,
        correctionReason: '凭单核对',
        logistics: {
          create: [
            expect.objectContaining({
              id: expect.any(String),
              companyValue: '真实快递',
              trackingValue: '真实单号',
              position: 1,
            }),
          ],
        },
      }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.notaryMatterCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'unchanged-key',
        resultMatterVersion: 3,
        resultSnapshot: { ...result },
      }),
    });
    expect(f.state).toMatchObject({ stage: 'UNBOX_REVIEW', version: 3 });
    expect(f.tx.notaryMatter).not.toHaveProperty('updateMany');
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'notary.record.correct',
      expect.objectContaining({
        departmentId: actor.departmentId,
        teamId: 'team-1',
      }),
      f.tx,
    );
  });

  it('replays an authorized success even after archive and workflow change, but rejects changed parameters', async () => {
    const f = fixture();
    const first = await f.service.correctEvidence(
      actor,
      matterId,
      'same-key',
      evidence,
    );
    f.state.stage = 'ARCHIVED';
    f.state.version = 9;
    await expect(
      f.service.correctEvidence(actor, matterId, 'same-key', evidence),
    ).resolves.toEqual(first);
    expect(f.tx.notaryEvidenceCorrection.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.correctEvidence(actor, matterId, 'same-key', {
        ...evidence,
        evidenceAt: '2026-10-16',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    await expect(
      f.service.correctEvidence(actor, matterId, 'new-key', {
        ...evidence,
        expectedVersion: 9,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    f.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.correctEvidence(actor, matterId, 'same-key', evidence),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });

  it('validates sender fields and independent revision without touching photos', async () => {
    const f = fixture();
    const input = {
      expectedVersion: 3,
      expectedRevision: 0,
      correctionReason: ' 地址更新 ',
      senderName: null,
      senderPhone: null,
      senderAddress: '新地址',
    };
    const result = await f.service.correctOpeningSender(
      actor,
      matterId,
      'sender-key',
      input,
    );
    expect(result).toMatchObject({ kind: 'OPENING_SENDER', revision: 1 });
    expect(f.tx.notaryOpeningSenderCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderName: null,
        senderPhone: null,
        senderAddress: '新地址',
        correctionReason: '地址更新',
      }),
    });
    await expect(
      f.service.correctOpeningSender(actor, matterId, 'new-key', {
        ...input,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    for (const invalid of [
      { ...input, senderName: undefined },
      { ...input, senderPhone: 123 },
      { ...input, correctionReason: '   ' },
      { ...input, senderAddress: 'x'.repeat(501) },
    ]) {
      await expect(
        f.service.correctOpeningSender(
          actor,
          matterId,
          'invalid-key',
          invalid as typeof input,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('rejects stale workflow version, absent original facts, inactive actor, and lock miss before any write', async () => {
    for (const setup of [
      (f: ReturnType<typeof fixture>) => {
        f.state.version = 4;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.evidence = null as unknown as typeof f.state.evidence;
      },
      (f: ReturnType<typeof fixture>) => {
        f.tx.userAccount.findUnique.mockResolvedValue({
          accountType: 'INTERNAL',
          active: false,
        });
      },
      (f: ReturnType<typeof fixture>) => {
        f.tx.$queryRawUnsafe.mockResolvedValue([]);
      },
    ]) {
      const f = fixture();
      setup(f);
      await expect(
        f.service.correctEvidence(actor, matterId, 'key', evidence),
      ).rejects.toBeDefined();
      expect(f.tx.notaryEvidenceCorrection.create).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      expect(f.tx.notaryMatterCommandReceipt.create).not.toHaveBeenCalled();
    }
  });

  it('does not produce a successful result when audit or receipt persistence fails', async () => {
    for (const failed of ['audit', 'receipt'] as const) {
      const f = fixture();
      if (failed === 'audit')
        f.tx.auditEvent.create.mockRejectedValue(new Error('audit failed'));
      else
        f.tx.notaryMatterCommandReceipt.create.mockRejectedValue(
          new Error('receipt failed'),
        );
      await expect(
        f.service.correctEvidence(actor, matterId, 'key', evidence),
      ).rejects.toThrow(`${failed} failed`);
    }
  });

  it('keeps the SQL enum boundary, immutable rows, scope FKs, and unique revisions', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261018000100_notary_record_corrections/migration.sql',
      ),
      'utf8',
    );
    expect(
      sql.indexOf("ADD VALUE IF NOT EXISTS 'notary.record.correct'"),
    ).toBeLessThan(sql.indexOf('BEGIN;'));
    for (const table of [
      'notary_evidence_corrections',
      'notary_evidence_correction_logistics',
      'notary_opening_sender_corrections',
    ]) {
      expect(sql).toContain(`BEFORE UPDATE OR DELETE ON "${table}"`);
    }
    expect(sql).toContain('UNIQUE ("matter_id", "revision")');
    expect(sql).toContain('UNIQUE ("correction_id", "position")');
    expect(sql).toContain('FOREIGN KEY ("matter_id", "department_id")');
    expect(sql).not.toMatch(
      /\bUPDATE\s+"notary_matter_(?:evidence|opening|logistics)"|\bINSERT\s+INTO\s+"(?:role_grants|role_templates)"/iu,
    );
  });
});
