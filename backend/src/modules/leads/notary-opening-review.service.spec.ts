import { ForbiddenException } from '@nestjs/common';
import { NotaryOpeningReviewService } from './notary-opening-review.service';

const internal = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const client = {
  ...internal,
  clientCustomerId: '33333333-3333-4333-8333-333333333333',
};
const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const photoVersionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input = { result: 'INFRINGEMENT' as const, expectedVersion: 3 };

function fixture() {
  const matter = {
    id: matterId,
    departmentId: internal.departmentId,
    customerId: client.clientCustomerId,
    stage: 'UNBOX_REVIEW',
    version: 3,
    opening: { matterId },
    sourceLead: {
      responsibleUserId: internal.userId,
      teamId: null,
      pushedAt: new Date(),
      pushedByUserId: internal.userId,
    },
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
    notaryMatter: {
      findFirst: jest.fn().mockResolvedValue(matter),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        active: true,
        displayName: '运营',
      }),
    },
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        customerId: client.clientCustomerId,
        user: { displayName: '客户' },
      }),
    },
    materialReference: {
      findMany: jest.fn().mockResolvedValue([
        {
          contentVersionId: photoVersionId,
          actionEvent: { details: { contentVersionIds: [photoVersionId] } },
        },
      ]),
    },
    notaryOpeningReviewReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    notaryOpeningReviewDecision: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: '55555555-5555-4555-8555-555555555555',
        decidedAt: data.decidedAt,
      })),
    },
    notaryOpeningReviewAuditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  const service = new NotaryOpeningReviewService(
    database as never,
    access as never,
  );
  return { service, tx, access, matter };
}

async function committedReplayFixture() {
  const f = fixture();
  const result = await f.service.review(internal, matterId, 'key', input);
  const stored = f.tx.notaryOpeningReviewReceipt.create.mock.calls[0][0].data;
  const decision =
    f.tx.notaryOpeningReviewDecision.create.mock.calls[0][0].data;
  f.tx.notaryOpeningReviewReceipt.findUnique.mockResolvedValue(stored);
  f.tx.notaryOpeningReviewDecision.findUnique.mockResolvedValue({
    ...decision,
    id: stored.reviewDecisionId,
  });
  return { ...f, result, stored, decision };
}

describe('NotaryOpeningReviewService', () => {
  it('records an internal decision, audit and receipt in one transaction', async () => {
    const f = fixture();
    const result = await f.service.review(internal, matterId, 'key-1', input);
    expect(result).toMatchObject({
      id: matterId,
      stage: 'ISSUANCE_DECISION',
      version: 4,
    });
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      internal,
      'notary.opening.review',
      expect.anything(),
      f.tx,
    );
    expect(f.tx.materialReference.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        departmentId: internal.departmentId,
        resourceId: matterId,
        purpose: 'NOTARY_OPENING_PHOTO',
        actionEvent: expect.objectContaining({
          action: 'notary.opening_recorded',
          resourceId: matterId,
        }),
        material: expect.objectContaining({
          ownerId: matterId,
          status: 'ACTIVE',
        }),
        contentVersion: { status: 'AVAILABLE' },
      }),
      select: {
        contentVersionId: true,
        actionEvent: { select: { details: true } },
      },
    });
    expect(f.tx.notaryOpeningReviewDecision.create).toHaveBeenCalled();
    expect(f.tx.notaryOpeningReviewAuditEvent.create).toHaveBeenCalled();
    expect(f.tx.notaryOpeningReviewReceipt.create).toHaveBeenCalled();
  });

  it('accepts a bound client without borrowing internal grants', async () => {
    const f = fixture();
    const result = await f.service.review(client, matterId, 'key-2', {
      result: 'NO_INFRINGEMENT',
      reason: ' 无侵权 ',
      expectedVersion: 3,
    });
    expect(result).toMatchObject({
      stage: 'ARCHIVED',
      reviewDecision: { reason: '无侵权' },
    });
    expect(f.access.authorizeLead).not.toHaveBeenCalled();
    expect(f.tx.notaryOpeningReviewDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorKind: 'CLIENT',
        customerAccountBindingId: expect.any(String),
        archivedAt: expect.any(Date),
      }),
    });
  });

  it('rejects revoked authorization before replay lookup', async () => {
    const f = fixture();
    f.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.review(internal, matterId, 'key-1', input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.notaryOpeningReviewReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects another enterprise, inactive binding, inactive client and unpushed source', async () => {
    for (const alter of [
      (f: ReturnType<typeof fixture>) =>
        f.tx.notaryMatter.findFirst.mockResolvedValue({
          ...f.matter,
          customerId: '66666666-6666-4666-8666-666666666666',
        }),
      (f: ReturnType<typeof fixture>) =>
        f.tx.customerAccountBinding.findFirst.mockResolvedValue(null),
      (f: ReturnType<typeof fixture>) =>
        f.tx.notaryMatter.findFirst.mockResolvedValue({
          ...f.matter,
          sourceLead: { ...f.matter.sourceLead, pushedAt: null },
        }),
    ]) {
      const f = fixture();
      alter(f);
      await expect(
        f.service.review(client, matterId, 'key', input),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.tx.notaryOpeningReviewReceipt.findUnique).not.toHaveBeenCalled();
    }
  });

  it('rejects missing opening, missing frozen photo, wrong state and old version', async () => {
    for (const change of [{ opening: null }, { stage: 'WAITING_UNBOX' }]) {
      const f = fixture();
      f.tx.notaryMatter.findFirst.mockResolvedValue({ ...f.matter, ...change });
      await expect(
        f.service.review(internal, matterId, 'key', input),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    }
    const noPhoto = fixture();
    noPhoto.tx.materialReference.findMany.mockResolvedValue([]);
    await expect(
      noPhoto.service.review(internal, matterId, 'key', input),
    ).rejects.toMatchObject({ response: { code: 'OPENING_PHOTO_REQUIRED' } });
    const stale = fixture();
    await expect(
      stale.service.review(internal, matterId, 'key', {
        ...input,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('rejects a material reference absent from the committed opening photo versions', async () => {
    const f = fixture();
    f.tx.materialReference.findMany.mockResolvedValue([
      {
        contentVersionId: photoVersionId,
        actionEvent: {
          details: {
            contentVersionIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
          },
        },
      },
    ]);
    await expect(
      f.service.review(internal, matterId, 'key', input),
    ).rejects.toMatchObject({ response: { code: 'OPENING_PHOTO_REQUIRED' } });
    expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
    expect(f.tx.notaryOpeningReviewDecision.create).not.toHaveBeenCalled();
  });

  it('replays the same request without new writes and rejects a changed payload', async () => {
    const f = await committedReplayFixture();
    f.tx.notaryOpeningReviewDecision.create.mockClear();
    f.tx.notaryOpeningReviewAuditEvent.create.mockClear();
    await expect(
      f.service.review(internal, matterId, 'key', input),
    ).resolves.toEqual(f.result);
    await expect(
      f.service.review(internal, matterId, 'key', {
        ...input,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.notaryOpeningReviewDecision.create).not.toHaveBeenCalled();
    expect(f.tx.notaryOpeningReviewAuditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a replay snapshot with missing decision fields', async () => {
    const f = await committedReplayFixture();
    f.tx.notaryOpeningReviewReceipt.findUnique.mockResolvedValue({
      ...f.stored,
      resultSnapshot: {
        id: matterId,
        version: 4,
        stage: 'ARCHIVED',
        reviewDecision: {},
      },
    });
    await expect(
      f.service.review(internal, matterId, 'key', input),
    ).rejects.toMatchObject({
      response: { code: 'RECEIPT_CORRUPT' },
    });
  });

  it('rejects replay fields contradicted by the immutable decision', async () => {
    const f = await committedReplayFixture();
    for (const snapshot of [
      { ...f.result, stage: 'ARCHIVED' },
      {
        ...f.result,
        stage: 'ARCHIVED',
        reviewDecision: {
          ...f.result.reviewDecision,
          result: 'NO_INFRINGEMENT',
          reason: '伪造原因',
          archivedAt: f.result.reviewDecision.decidedAt,
        },
      },
      {
        ...f.result,
        reviewDecision: { ...f.result.reviewDecision, actorKind: 'CLIENT' },
      },
      {
        ...f.result,
        reviewDecision: {
          ...f.result.reviewDecision,
          decidedAt: '2000-01-01T00:00:00.000Z',
        },
      },
      {
        ...f.result,
        reviewDecision: { ...f.result.reviewDecision, actorDisplayName: '' },
      },
      { ...f.result, untrusted: 'extra' },
      {
        ...f.result,
        reviewDecision: { ...f.result.reviewDecision, untrusted: 'extra' },
      },
    ]) {
      f.tx.notaryOpeningReviewReceipt.findUnique.mockResolvedValue({
        ...f.stored,
        resultSnapshot: snapshot,
      });
      await expect(
        f.service.review(internal, matterId, 'key', input),
      ).rejects.toMatchObject({
        response: { code: 'RECEIPT_CORRUPT' },
      });
    }
  });

  it('validates reason and key before starting a transaction', async () => {
    for (const invalid of [
      { result: 'NO_INFRINGEMENT' as const, expectedVersion: 3, reason: ' ' },
      {
        result: 'INFRINGEMENT' as const,
        expectedVersion: 3,
        reason: 'unexpected',
      },
      { result: 'INFRINGEMENT' as const, expectedVersion: 0 },
    ]) {
      const f = fixture();
      await expect(
        f.service.review(internal, matterId, 'key', invalid),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
    }
  });

  it('propagates decision, audit and receipt failures for transaction rollback', async () => {
    for (const operation of [
      'notaryOpeningReviewDecision',
      'notaryOpeningReviewAuditEvent',
      'notaryOpeningReviewReceipt',
    ] as const) {
      const f = fixture();
      f.tx[operation].create.mockRejectedValue(
        new Error(`${operation} failed`),
      );
      await expect(
        f.service.review(internal, matterId, 'key', input),
      ).rejects.toThrow(`${operation} failed`);
      expect(f.tx.notaryMatter.updateMany).toHaveBeenCalledTimes(1);
    }
  });
});
