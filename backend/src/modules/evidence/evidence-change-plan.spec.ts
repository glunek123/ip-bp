import {
  planEvidenceBulkStatus,
  planEvidenceGroupChange,
  planEvidenceSourceCreation,
  type EvidenceGroupSnapshot,
} from './evidence-change-plan';

const snapshot: EvidenceGroupSnapshot = {
  version: 7,
  items: [
    {
      id: 'a',
      displayCode: 'EV-A',
      shelfLocation: 'A3',
      status: 'IN_STOCK',
      remark: '原备注A',
    },
    {
      id: 'b',
      displayCode: 'EV-B',
      shelfLocation: null,
      status: 'UNDELIVERED',
      remark: '原备注B',
    },
  ],
  paperCertificates: [
    { id: 'paper-1', status: 'NOT_ISSUED' },
    { id: 'paper-2', status: 'NOT_ISSUED' },
  ],
};

describe('evidence change plans', () => {
  it('skips a blank first-source draft and never fabricates a code for a shelf-only entry', () => {
    const input = {
      expectedGroupVersion: 0 as const,
      expectedSourceVersion: 3,
      rows: [
        {
          displayCode: '',
          shelfLocation: '',
          status: 'UNDELIVERED' as const,
          manualStatus: false,
        },
      ],
    };
    expect(planEvidenceSourceCreation(input)).toEqual({
      created: [],
      changed: false,
    });
    expect(
      planEvidenceSourceCreation({
        ...input,
        rows: [{ ...input.rows[0], shelfLocation: 'A1' }],
      }).created,
    ).toEqual([
      {
        displayCode: null,
        shelfLocation: 'A1',
        status: 'UNDELIVERED',
        remark: null,
      },
    ]);
  });
  it('removes every current row while skipping a blank new row and keeps the snapshot intact', () => {
    const plan = planEvidenceGroupChange(snapshot, {
      expectedGroupVersion: 7,
      rows: [
        {
          displayCode: '',
          shelfLocation: '',
          status: 'UNDELIVERED',
          manualStatus: false,
        },
      ],
    });
    expect(plan.removedIds).toEqual(['a', 'b']);
    expect(plan.created).toEqual([]);
    expect(plan.changed).toBe(true);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.paperCertificates).toHaveLength(2);
  });
  it('preserves existing blank-submitted identifiers, shelves and mixed remarks', () => {
    const plan = planEvidenceGroupChange(snapshot, {
      expectedGroupVersion: 7,
      rows: snapshot.items.map((row) => ({
        id: row.id,
        displayCode: '',
        shelfLocation: '',
        status: row.status,
        manualStatus: false,
      })),
      remark: '',
    });
    expect(plan).toEqual({
      changed: false,
      removedIds: [],
      created: [],
      updated: [],
      paperUpdates: [],
    });
  });

  it('plans multiple new rows and a precise second-paper status while retaining removal history responsibility', () => {
    const plan = planEvidenceGroupChange(snapshot, {
      expectedGroupVersion: 7,
      rows: [
        {
          id: 'b',
          displayCode: 'EV-B',
          shelfLocation: 'B2',
          status: 'UNDELIVERED',
          manualStatus: false,
        },
        {
          displayCode: 'NEW-1',
          shelfLocation: '',
          status: 'UNDELIVERED',
          manualStatus: false,
        },
        {
          displayCode: 'NEW-2',
          shelfLocation: 'C3',
          status: 'DESTROYED',
          manualStatus: true,
        },
      ],
      remark: '统一备注',
      paperCertificates: [{ id: 'paper-2', status: 'MAILED_TO_LAWYER' }],
    });
    expect(plan.removedIds).toEqual(['a']);
    expect(plan.updated).toEqual([
      {
        id: 'b',
        displayCode: 'EV-B',
        shelfLocation: 'B2',
        status: 'IN_STOCK',
        remark: '统一备注',
      },
    ]);
    expect(plan.created.map((row) => row.status)).toEqual([
      'UNDELIVERED',
      'DESTROYED',
    ]);
    expect(plan.paperUpdates).toEqual([
      { id: 'paper-2', status: 'MAILED_TO_LAWYER' },
    ]);
    expect(snapshot.paperCertificates[0].status).toBe('NOT_ISSUED');
    expect(snapshot.items).toHaveLength(2);
  });

  it('rejects stale groups and foreign paper IDs before producing a write plan', () => {
    expect(() =>
      planEvidenceGroupChange(snapshot, { expectedGroupVersion: 6, rows: [] }),
    ).toThrow('EVIDENCE_VERSION_CONFLICT');
    expect(() =>
      planEvidenceGroupChange(snapshot, {
        expectedGroupVersion: 7,
        rows: [],
        paperCertificates: [{ id: 'foreign', status: 'NOT_ISSUED' }],
      }),
    ).toThrow('INVALID_PAPER_CERTIFICATE');
  });

  it('batch changes only explicitly selected records and returns no writes for equal status', () => {
    expect(
      planEvidenceBulkStatus(snapshot.items, snapshot.paperCertificates, {
        evidenceIds: ['a', 'b'],
        paperCertificateIds: ['paper-2'],
        evidenceStatus: 'IN_STOCK',
        paperStatus: 'MAILED_TO_LAWYER',
      }),
    ).toEqual({
      items: [{ id: 'b', status: 'IN_STOCK' }],
      papers: [{ id: 'paper-2', status: 'MAILED_TO_LAWYER' }],
    });
    expect(
      planEvidenceBulkStatus(snapshot.items, snapshot.paperCertificates, {
        evidenceIds: ['a'],
        paperCertificateIds: [],
        evidenceStatus: 'IN_STOCK',
      }),
    ).toEqual({ items: [], papers: [] });
  });
});
