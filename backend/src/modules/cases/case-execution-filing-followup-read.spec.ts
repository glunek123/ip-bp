import { projectExecutionFilingFollowups } from './case-execution-filing-followup-read';

const recordedAt = new Date('2026-10-16T01:00:00Z');
const first = {
  id: 'feedback-root',
  feedbackId: 'feedback-root',
  priorVersionId: null,
  fromRevision: 0,
  toRevision: 1,
  correctionReason: null,
  recordedAt,
  feedbackOn: null,
  courtCaseNo: null,
  content: '尚未知法院案号的真实反馈',
};
const second = {
  ...first,
  id: 'feedback-v2',
  priorVersionId: first.id,
  fromRevision: 1,
  toRevision: 2,
  correctionReason: '内部更正原因',
  feedbackOn: new Date('2027-01-01T00:00:00Z'),
  courtCaseNo: '真实案号',
  content: '更正的反馈内容',
  recordedAt: new Date('2026-10-16T02:00:00Z'),
};
const documents = [
  {
    materialId: 'material-1',
    contentVersionId: 'file-v1',
    contentVersion: {
      originalFilename: '原补交.pdf',
      mimeType: 'application/pdf',
    },
  },
];
const supplement = {
  id: 'supplement-root',
  supplementId: 'supplement-root',
  priorVersionId: null,
  fromRevision: 0,
  toRevision: 1,
  correctionReason: null,
  recordedAt,
  submittedOn: null,
  note: null,
  documents,
};
const input = {
  filingId: 'filing-1',
  internal: true,
  permissions: [true, false, true, false] as const,
  feedbacks: [second, first],
  supplements: [supplement],
};
describe('execution filing followup exact read projection', () => {
  it('projects latest real revisions and preserves every earlier date/file, including the initial version', () => {
    const before = structuredClone(input);
    const result = projectExecutionFilingFollowups(input);
    expect(result.canRecordFeedback).toBe(true);
    expect(result.canSubmitSupplement).toBe(true);
    expect(result.feedbacks[0]).toMatchObject({
      feedbackId: first.feedbackId,
      canCorrect: false,
      current: {
        id: second.id,
        revision: 2,
        feedbackOn: '2027-01-01',
        courtCaseNo: '真实案号',
      },
    });
    expect(result.feedbacks[0]!.history.map((v) => v.revision)).toEqual([1, 2]);
    expect(result.feedbacks[0]!.history[0]).toMatchObject({
      feedbackOn: null,
      courtCaseNo: null,
      correctionReason: null,
    });
    expect(result.feedbacks[0]!.history[1]?.correctionReason).toBe(
      '内部更正原因',
    );
    expect(result.supplements[0]!.current.files).toEqual([
      {
        materialId: 'material-1',
        contentVersionId: 'file-v1',
        originalFilename: '原补交.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    expect(input).toEqual(before);
  });
  it('returns only whitelisted business/history metadata to lawyers without internal reasons or actor/audit IDs', () => {
    const privateFields = {
      recordedByUserId: 'private-operator',
      auditEventId: 'private-audit',
      actorType: 'INTERNAL',
      internalActorUserId: 'private-user',
    };
    const result = projectExecutionFilingFollowups({
      ...input,
      feedbacks: [
        { ...first, ...privateFields },
        { ...second, ...privateFields },
      ],
      internal: false,
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'correctionReason',
      'recordedByUserId',
      'auditEventId',
      'actorType',
      'internalActorUserId',
      'lawyerAccountBindingId',
      'priorVersionId',
    ])
      expect(serialized).not.toContain(forbidden);
    expect(result.feedbacks[0]!.history.map((v) => v.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(result.supplements[0]!.history[0]!.files[0]!.contentVersionId).toBe(
      'file-v1',
    );
  });
  it('does not manufacture feedback or a received status for an existing empty filing', () => {
    expect(
      projectExecutionFilingFollowups({
        ...input,
        feedbacks: [],
        supplements: [],
        permissions: [false, false, false, false],
      }),
    ).toEqual({
      filingId: 'filing-1',
      canRecordFeedback: false,
      canSubmitSupplement: false,
      feedbacks: [],
      supplements: [],
    });
  });
  it('keeps each supplement version bound to its original exact files after a correction', () => {
    const correctedSupplement = {
      ...supplement,
      id: 'supplement-v2',
      priorVersionId: supplement.id,
      fromRevision: 1,
      toRevision: 2,
      correctionReason: '更正补交资料',
      submittedOn: new Date('2027-02-03T00:00:00Z'),
      note: '补交说明',
      documents: [
        {
          materialId: 'material-2',
          contentVersionId: 'file-v2',
          contentVersion: {
            originalFilename: '更正补交.png',
            mimeType: 'image/png',
          },
        },
      ],
    };
    const result = projectExecutionFilingFollowups({
      ...input,
      supplements: [correctedSupplement, supplement],
    }).supplements[0]!;
    expect(result.current).toMatchObject({
      id: correctedSupplement.id,
      revision: 2,
      submittedOn: '2027-02-03',
      files: [
        {
          materialId: 'material-2',
          contentVersionId: 'file-v2',
          originalFilename: '更正补交.png',
          mimeType: 'image/png',
        },
      ],
    });
    expect(
      result.history.map((v) => v.files.map((file) => file.contentVersionId)),
    ).toEqual([['file-v1'], ['file-v2']]);
    expect(result.history[0]).toMatchObject({
      submittedOn: null,
      note: null,
      correctionReason: null,
    });
    expect(result.history[1]?.correctionReason).toBe('更正补交资料');
  });
  it.each(
    [
      [{ ...second, fromRevision: 0 }],
      [{ ...first, id: 'not-the-root' }],
      [first, { ...second, toRevision: 3 }],
      [first, { ...second, priorVersionId: 'unrelated-version' }],
      [first, { ...second, correctionReason: null }],
      [first, { ...second, correctionReason: '  ' }],
      [first, { ...first, id: 'fork' }],
    ].map((feedbacks) => ({ feedbacks })),
  )(
    'rejects broken roots, revisions, prior links or missing correction provenance',
    ({ feedbacks }) => {
      expect(() =>
        projectExecutionFilingFollowups({ ...input, feedbacks }),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'INVALID_RECORD_SOURCE' }),
        }),
      );
    },
  );
  it('uses root registration order, independently of later correction timestamps', () => {
    const other = {
      ...first,
      id: 'older-root',
      feedbackId: 'older-root',
      recordedAt: new Date('2026-10-15T00:00:00Z'),
    };
    const result = projectExecutionFilingFollowups({
      ...input,
      feedbacks: [other, second, first],
    });
    expect(result.feedbacks.map((v) => v.feedbackId)).toEqual([
      first.feedbackId,
      'older-root',
    ]);
  });
});
