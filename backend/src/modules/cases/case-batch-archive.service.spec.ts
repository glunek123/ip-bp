import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { DatabaseService } from '../../database/database.service';
import type { CaseEarlyArchiveService } from './case-early-archive.service';
import { CaseBatchArchiveService } from './case-batch-archive.service';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const actor = { userId: a, departmentId: b, authorizationRevision: 1 };
function harness() {
  const tx = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
    },
    departmentMembership: {
      findUnique: jest.fn().mockResolvedValue({ active: true, teamId: null }),
    },
    caseConsolidationMember: { findFirst: jest.fn().mockResolvedValue(null) },
    caseEarlyArchiveBatchReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
  };
  const database = {
    $transaction: jest.fn(async (work: (reader: unknown) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const access = { authorizeCase: jest.fn() };
  const single = {
    archive: jest
      .fn()
      .mockResolvedValue({ id: a, stage: 'ARCHIVED', version: 2 }),
  };
  const service = new CaseBatchArchiveService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
    single as unknown as CaseEarlyArchiveService,
  );
  return { service, tx, access, single };
}
const input = () => ({
  idempotencyKey: 'batch-1',
  archiveAt: '2026-01-01',
  reason: '办理结束',
  items: [{ id: a, expectedVersion: 1 }],
});

describe('case batch early archive', () => {
  it('rejects duplicate cases before binding a batch', async () => {
    const f = harness();
    const body = input();
    body.items.push({ id: a, expectedVersion: 1 });
    await expect(f.service.archive(actor, body)).rejects.toThrow(
      BadRequestException,
    );
    expect(f.tx.caseEarlyArchiveBatchReceipt.create).not.toHaveBeenCalled();
  });
  it('binds the full request and returns the single-case success receipt', async () => {
    const f = harness();
    const result = await f.service.archive(actor, input());
    expect(result.items[0]).toMatchObject({
      id: a,
      status: 'SUCCEEDED',
      result: { version: 2 },
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.archive',
      expect.any(Object),
      f.tx,
    );
    expect(f.tx.caseEarlyArchiveBatchReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'batch-1',
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    });
  });
  it('rejects the whole batch before a receipt when any selected case is a merged child', async () => {
    const f = harness();
    f.tx.caseConsolidationMember.findFirst.mockResolvedValue({ caseId: a });
    await expect(f.service.archive(actor, input())).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx.caseEarlyArchiveBatchReceipt.create).not.toHaveBeenCalled();
    expect(f.single.archive).not.toHaveBeenCalled();
  });
  it('reports uncertain outcomes as UNKNOWN for same-key retry', async () => {
    const f = harness();
    f.single.archive.mockRejectedValue(new InternalServerErrorException());
    const result = await f.service.archive(actor, input());
    expect(result.items).toEqual([
      { id: a, status: 'UNKNOWN', code: 'RESULT_UNKNOWN' },
    ]);
    const creation = f.tx.caseEarlyArchiveBatchReceipt.create.mock
      .calls[0][0] as { data: { requestFingerprint: string } };
    f.tx.caseEarlyArchiveBatchReceipt.findUnique.mockResolvedValue({
      requestFingerprint: creation.data.requestFingerprint,
    });
    f.single.archive.mockResolvedValue({
      id: a,
      stage: 'ARCHIVED',
      version: 2,
    });
    await expect(f.service.archive(actor, input())).resolves.toMatchObject({
      items: [{ id: a, status: 'SUCCEEDED' }],
    });
  });
  it('rejects changed input under an existing batch key', async () => {
    const f = harness();
    f.tx.caseEarlyArchiveBatchReceipt.findUnique.mockResolvedValue({
      requestFingerprint: 'other',
    });
    await expect(f.service.archive(actor, input())).rejects.toThrow(
      ConflictException,
    );
    expect(f.single.archive).not.toHaveBeenCalled();
  });
});
