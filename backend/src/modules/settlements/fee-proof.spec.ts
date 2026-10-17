import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { FeeService } from './fee.service';
import { financialFingerprint } from './settlement-input';

const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};
const input = {
  expectedVersion: 2,
  materialId: 'material',
  contentVersionId: 'cv',
  idempotencyKey: 'original-key',
};
function setup(allowed = true) {
  const events: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      if (strings.join('').includes('FROM cases')) {
        events.push('case-lock');
        return [{ id: 'case' }];
      }
      return [];
    }),
    feeRecord: {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          id: 'fee',
          caseId: 'case',
          version: 2,
          deletedAt: null,
          proofMaterialId: null,
          proofContentVersionId: null,
        }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: {
      findMany: jest.fn(async () => {
        events.push('receipt');
        return [] as Array<{ details: unknown }>;
      }),
      create: jest.fn().mockResolvedValue({ id: 'audit' }),
    },
  };
  const database = {
    $transaction: jest.fn(
      async (work: (reader: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx as unknown as Prisma.TransactionClient),
    ),
  } as unknown as DatabaseService;
  const access = new AccessControlService({
    loadSnapshot: async (_user, _dep, reader) => {
      expect(reader).toBe(tx);
      events.push('current-auth');
      return {
        active: true,
        authorizationRevision: 1,
        grants: allowed ? [{ action: 'fee.update', scope: 'department' }] : [],
      };
    },
  });
  const organization = {
    lockDepartment: jest.fn(async () => {
      events.push('actor-lock');
    }),
  } as unknown as OrganizationService;
  const materials = {
    assertAvailableVersions: jest
      .fn()
      .mockResolvedValue([{ materialId: 'material', contentVersionId: 'cv' }]),
    freezeReferences: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const service = new FeeService(
    database,
    access,
    organization,
    materials as unknown as MaterialService,
  );
  return { tx, materials, service, events };
}
describe('fee proof commands', () => {
  it('checks current authorization before source/receipt and rejects a revoked successful retry', async () => {
    const f = setup(false);
    await expect(
      f.service.updateProof(actor, 'fee', input),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.tx.feeRecord.findFirst).not.toHaveBeenCalled();
    expect(f.events).toEqual(['actor-lock', 'current-auth']);
  });
  it('freezes exactly the selected CV with the fee audit in the same transaction after case lock and CAS', async () => {
    const f = setup();
    await expect(f.service.updateProof(actor, 'fee', input)).resolves.toEqual({
      id: 'fee',
      version: 3,
    });
    expect(f.events).toEqual([
      'actor-lock',
      'current-auth',
      'case-lock',
      'receipt',
    ]);
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        contentVersionIds: ['cv'],
      }),
    );
    expect(f.materials.freezeReferences).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        departmentId: actor.departmentId,
        resourceType: 'fee',
        resourceId: 'fee',
        actionEventId: 'audit',
      }),
    );
  });
  it('rejects a material/CV pair from another case even when a validator returned a different material', async () => {
    const f = setup();
    f.materials.assertAvailableVersions.mockResolvedValue([
      { materialId: 'other-case-material', contentVersionId: 'cv' },
    ]);
    await expect(
      f.service.updateProof(actor, 'fee', input),
    ).rejects.toMatchObject({ response: { code: 'INVALID_FEE_PROOF' } });
    expect(f.tx.feeRecord.updateMany).not.toHaveBeenCalled();
    expect(f.materials.freezeReferences).not.toHaveBeenCalled();
  });
  it('does not save or freeze when a concurrent change wins the CAS', async () => {
    const f = setup();
    f.tx.feeRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      f.service.updateProof(actor, 'fee', input),
    ).rejects.toMatchObject({ response: { code: 'FEE_CHANGED' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.materials.freezeReferences).not.toHaveBeenCalled();
  });
  it('replays the original request after a later version change without another update or freeze', async () => {
    const f = setup();
    f.tx.auditEvent.findMany.mockResolvedValue([
      {
        details: {
          requestFingerprint: financialFingerprint({
            command: 'UPDATE_FEE_PROOF',
            feeId: 'fee',
            expectedVersion: 2,
            materialId: 'material',
            contentVersionId: 'cv',
          }),
          toVersion: 3,
        },
      },
    ]);
    f.tx.feeRecord.findFirst.mockResolvedValue({
      id: 'fee',
      caseId: 'case',
      version: 9,
      deletedAt: null,
      proofMaterialId: null,
      proofContentVersionId: null,
    });
    await expect(f.service.updateProof(actor, 'fee', input)).resolves.toEqual({
      id: 'fee',
      version: 3,
    });
    expect(f.tx.feeRecord.updateMany).not.toHaveBeenCalled();
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
  });
  it('rejects a reused key for different proof contents', async () => {
    const f = setup();
    f.tx.auditEvent.findMany.mockResolvedValue([
      { details: { requestFingerprint: 'different', toVersion: 3 } },
    ]);
    await expect(
      f.service.updateProof(actor, 'fee', input),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.feeRecord.updateMany).not.toHaveBeenCalled();
  });
  it('clears only the current slot and audits it, retaining original references and file history', async () => {
    const f = setup();
    await expect(
      f.service.updateProof(actor, 'fee', {
        ...input,
        materialId: null,
        contentVersionId: null,
      }),
    ).resolves.toEqual({ id: 'fee', version: 3 });
    expect(f.tx.feeRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          proofMaterialId: null,
          proofContentVersionId: null,
          version: { increment: 1 },
        },
      }),
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalled();
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(f.materials.freezeReferences).not.toHaveBeenCalled();
  });
});
