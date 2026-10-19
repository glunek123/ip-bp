import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { readNotaryRecordEdits } from './notary-record-edit-read';

const actor: ActorContext = {
  userId: 'actor-1',
  departmentId: 'department-1',
  authorizationRevision: 1,
};
const originalLogistics = {
  id: 'real-original-id',
  companyState: 'NONE' as const,
  companyValue: null,
  trackingState: 'PRESENT' as const,
  trackingValue: 'old-number',
};
const revisedLogistics = {
  ...originalLogistics,
  id: 'real-revision-id',
  trackingValue: 'new-number',
};
function fixture() {
  const matter = {
    id: 'matter-1',
    departmentId: actor.departmentId,
    stage: 'UNBOX_REVIEW' as const,
    sourceLead: { responsibleUserId: actor.userId, teamId: null },
    evidence: {
      evidenceAt: new Date('2026-10-15'),
      logistics: [originalLogistics],
    },
    opening: { senderName: 'old', senderPhone: null, senderAddress: null },
    evidenceCorrections: [
      {
        id: 'correction-1',
        revision: 1,
        correctionReason: '核对物流',
        actorUserId: actor.userId,
        recordedAt: new Date('2026-10-18T01:00:00Z'),
        evidenceAt: new Date('2026-10-16'),
        logistics: [revisedLogistics],
      },
    ],
    openingSenderCorrections: [
      {
        id: 'correction-2',
        revision: 1,
        correctionReason: '核对寄件人',
        actorUserId: actor.userId,
        recordedAt: new Date('2026-10-18T02:00:00Z'),
        senderName: null,
        senderPhone: null,
        senderAddress: 'new',
      },
    ],
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  return { matter, access };
}

describe('notary record correction read', () => {
  it('projects original, effective, and ascending history with real logistics IDs', async () => {
    const { matter, access } = fixture();
    const result = await readNotaryRecordEdits(
      access as unknown as AccessControlService,
      actor,
      matter,
    );
    expect(result.evidence).toMatchObject({
      canCorrect: true,
      revision: 1,
      original: {
        evidenceAt: '2026-10-15',
        logistics: [{ id: 'real-original-id' }],
      },
      effective: {
        evidenceAt: '2026-10-16',
        logistics: [{ id: 'real-revision-id' }],
      },
      history: [
        {
          correctionId: 'correction-1',
          revision: 1,
          correctionReason: '核对物流',
          actorUserId: actor.userId,
          before: { logistics: [{ id: 'real-original-id' }] },
          after: { logistics: [{ id: 'real-revision-id' }] },
        },
      ],
    });
    expect(result.openingSender).toMatchObject({
      original: { senderName: 'old' },
      effective: { senderName: null, senderAddress: 'new' },
    });
  });

  it('hides write capability after archive or authorization loss and rejects a history gap', async () => {
    const { matter, access } = fixture();
    const archived = await readNotaryRecordEdits(
      access as unknown as AccessControlService,
      actor,
      { ...matter, stage: 'ARCHIVED' },
    );
    expect(archived.evidence?.canCorrect).toBe(false);
    expect(archived.openingSender?.canCorrect).toBe(false);
    access.authorizeLead.mockRejectedValue(new ForbiddenException());
    const revoked = await readNotaryRecordEdits(
      access as unknown as AccessControlService,
      actor,
      matter,
    );
    expect(revoked.evidence?.canCorrect).toBe(false);
    await expect(
      readNotaryRecordEdits(access as unknown as AccessControlService, actor, {
        ...matter,
        evidenceCorrections: [
          { ...matter.evidenceCorrections[0], revision: 2 },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
  });
});
