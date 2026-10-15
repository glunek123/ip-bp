import {
  projectSectionRecord,
  sectionRecordFiles,
} from './case-section-record-edit-read';

const first = {
  id: 'correction-1',
  priorCorrectionId: null,
  fromRevision: 0,
  toRevision: 1,
  correctionReason: '纠正日期',
  recordedAt: new Date('2026-10-01T00:00:00Z'),
  recordedByUserId: 'operator',
  date: '2026-09-30',
  caseAnchorSnapshot: { stage: 'ARCHIVED' },
  auditEventId: 'audit',
};

describe('section record projection', () => {
  it('keeps an uncorrected actual record at revision zero', () => {
    const original = { date: null };
    expect(projectSectionRecord(original, [], () => original)).toEqual({
      revision: 0,
      original,
      effective: original,
      history: [],
    });
  });
  it('separates frozen original and effective values without leaking private anchors', () => {
    const original = { date: '2026-09-29' };
    const result = projectSectionRecord(original, [first], (row) => ({
      date: row.date,
    }));
    expect(result.original).toEqual(original);
    expect(result.effective).toEqual({ date: '2026-09-30' });
    expect(result.history[0]).toEqual({
      id: 'correction-1',
      priorCorrectionId: null,
      fromRevision: 0,
      toRevision: 1,
      date: '2026-09-30',
      correctionReason: '纠正日期',
      recordedAt: '2026-10-01T00:00:00.000Z',
      recordedByUserId: 'operator',
    });
    expect(original).toEqual({ date: '2026-09-29' });
  });
  it.each([
    [{ ...first, fromRevision: 1, toRevision: 2 }],
    [{ ...first, priorCorrectionId: 'foreign-record' }],
    [
      first,
      {
        ...first,
        id: 'correction-2',
        fromRevision: 1,
        toRevision: 2,
        priorCorrectionId: 'foreign-record',
      },
    ],
  ])(
    'rejects a broken chain rather than inventing effective values',
    (...corrections) => {
      expect(() =>
        projectSectionRecord({ date: '' }, corrections, (row) => ({
          date: row.date,
        })),
      ).toThrow('资料更正来源不一致');
    },
  );
  it('retains exact version IDs and safe file metadata', () => {
    expect(
      sectionRecordFiles([
        {
          materialId: 'material',
          contentVersionId: 'version',
          contentVersion: {
            originalFilename: '回执.pdf',
            mimeType: 'application/pdf',
          },
        },
      ]),
    ).toEqual([
      {
        materialId: 'material',
        contentVersionId: 'version',
        originalFilename: '回执.pdf',
        mimeType: 'application/pdf',
      },
    ]);
  });
});
