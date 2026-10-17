import {
  evidenceCounts,
  assertEvidenceFilter,
  matchesEvidenceFilter,
  prepareEvidenceRows,
  type EvidenceListRow,
} from './evidence-rules';

describe('evidence rules', () => {
  it('rejects impossible days and reversed date ranges', () => {
    expect(() => assertEvidenceFilter({ hearFrom: '2026-02-30' })).toThrow(
      'INVALID_EVIDENCE_DATE',
    );
    expect(() =>
      assertEvidenceFilter({ closeFrom: '2026-10-17', closeTo: '2026-10-16' }),
    ).toThrow('INVALID_EVIDENCE_DATE_RANGE');
    expect(() =>
      assertEvidenceFilter({ hearFrom: '2026-10-17', hearTo: '2026-10-17' }),
    ).not.toThrow();
  });
  it('stocks an undelivered row after missing code and shelf are filled', () => {
    expect(
      prepareEvidenceRows(
        [
          {
            id: 'a',
            displayCode: 'EV-1',
            shelfLocation: null,
            status: 'UNDELIVERED',
          },
        ],
        [
          {
            id: 'a',
            displayCode: 'EV-1',
            shelfLocation: 'A3',
            status: 'UNDELIVERED',
            manualStatus: false,
          },
        ],
      ),
    ).toEqual([
      { id: 'a', displayCode: 'EV-1', shelfLocation: 'A3', status: 'IN_STOCK' },
    ]);
  });

  it('keeps a manually chosen status and allows a genuinely empty group', () => {
    expect(
      prepareEvidenceRows(
        [],
        [
          {
            displayCode: 'EV-2',
            shelfLocation: 'B2',
            status: 'UNDELIVERED',
            manualStatus: true,
          },
          {
            displayCode: '',
            shelfLocation: '',
            status: 'UNDELIVERED',
            manualStatus: false,
          },
        ],
      ),
    ).toEqual([
      { displayCode: 'EV-2', shelfLocation: 'B2', status: 'UNDELIVERED' },
    ]);
    expect(
      prepareEvidenceRows(
        [
          {
            id: 'a',
            displayCode: null,
            shelfLocation: null,
            status: 'UNDELIVERED',
          },
        ],
        [],
      ),
    ).toEqual([]);
  });

  it('rejects unknown or repeated stable IDs', () => {
    const old = [
      {
        id: 'a',
        displayCode: null,
        shelfLocation: null,
        status: 'UNDELIVERED' as const,
      },
    ];
    const row = {
      id: 'a',
      displayCode: '',
      shelfLocation: '',
      status: 'UNDELIVERED' as const,
      manualStatus: false,
    };
    expect(() => prepareEvidenceRows(old, [row, row])).toThrow(
      'INVALID_EVIDENCE_ROW',
    );
    expect(() => prepareEvidenceRows(old, [{ ...row, id: 'b' }])).toThrow(
      'INVALID_EVIDENCE_ROW',
    );
  });

  const rows: EvidenceListRow[] = [
    {
      id: '1',
      caseId: 'case-a',
      status: 'IN_STOCK',
      stage: 'FILED',
      hearingOn: '2026-10-10',
      secondHearingOn: null,
      closedOn: null,
      lawyerName: 'Lin',
    },
    {
      id: '2',
      caseId: 'case-a',
      status: 'IN_STOCK',
      stage: 'FILED',
      hearingOn: '2026-10-10',
      secondHearingOn: null,
      closedOn: null,
      lawyerName: 'Lin',
    },
    {
      id: '3',
      caseId: 'case-b',
      status: 'UNDELIVERED',
      stage: 'SECOND_INSTANCE',
      hearingOn: null,
      secondHearingOn: '2026-10-12',
      closedOn: '2026-10-15',
      lawyerName: 'Chen',
    },
  ];

  it.each([
    ['SECOND_INSTANCE', '2026-10-20', '2026-10-20'],
    ['WAITING_HEARING', '2026-10-20', '2026-10-10'],
    ['SECOND_INSTANCE', null, null],
  ])(
    'filters the hearing date for stage %s with second date %s',
    (stage, secondHearingOn, expectedDay) => {
      const row = {
        ...rows[0],
        stage,
        hearingOn: '2026-10-10',
        secondHearingOn,
      };
      for (const day of ['2026-10-10', '2026-10-20']) {
        expect(matchesEvidenceFilter(row, { hearFrom: day, hearTo: day })).toBe(
          day === expectedDay,
        );
      }
      expect(matchesEvidenceFilter(row, {})).toBe(true);
    },
  );

  it('does not substitute a second hearing date for a missing first date at other stages', () => {
    expect(
      matchesEvidenceFilter(
        { ...rows[2], stage: 'WAITING_HEARING' },
        { hearFrom: '2026-10-12', hearTo: '2026-10-12' },
      ),
    ).toBe(false);
  });

  it('uses inclusive case dates and case-distinct stage counts', () => {
    expect(
      matchesEvidenceFilter(rows[2], {
        hearFrom: '2026-10-12',
        hearTo: '2026-10-12',
        lawyerQuery: 'cHe',
      }),
    ).toBe(true);
    expect(matchesEvidenceFilter(rows[0], { closeFrom: '2026-10-01' })).toBe(
      false,
    );
    expect(evidenceCounts(rows, { status: 'IN_STOCK' })).toEqual({
      statuses: {
        ALL: 3,
        UNDELIVERED: 1,
        IN_STOCK: 2,
        MAILED_TO_LAWYER: 0,
        DESTROYED: 0,
      },
      stages: { FILED: 1 },
      allStageCases: 1,
    });
  });
});
