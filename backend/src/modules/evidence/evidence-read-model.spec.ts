import {
  projectEvidenceGroup,
  type EvidenceGroupRecord,
} from './evidence-read-model';
import type { EvidenceSourceProjection } from './evidence-source-read';
import { matchesEvidenceFilter } from './evidence-rules';

const electronicFiles = [
  { materialId: 'm-1', contentVersionId: 'cv-1', filename: '一.pdf' },
  { materialId: 'm-2', contentVersionId: 'cv-2', filename: '二.pdf' },
];
const source: EvidenceSourceProjection = {
  sourceKind: 'NOTARY_MATTER',
  sourceId: 'matter-1',
  sourceVersion: 6,
  departmentId: 'dept-1',
  businessNo: 'N1',
  createdAt: new Date(),
  case: {
    id: 'case-1',
    platform: 'TAOBAO',
    shopName: '实际店铺',
    caseNo: null,
    stage: 'PENDING_MATCH',
    lawyerName: null,
  },
  hearingOn: null,
  secondHearingOn: null,
  closedOn: null,
  certificate: null,
};
const paper = {
  id: 'paper-1',
  departmentId: 'dept-1',
  groupId: 'group-1',
  caseId: 'case-1',
  sourceNotaryMatterId: 'matter-1',
  sourceKind: 'NOTARY_MATTER' as const,
  sourceId: 'matter-1',
  sourceCertificateId: 'certificate-1',
  number: 'N1',
  issuedOn: new Date('2026-10-01T00:00:00Z'),
  officeName: '实际公证处',
  pages: null,
  contentMaterialId: null,
  contentVersionId: null,
  contentVersion: null,
  status: 'NOT_ISSUED' as const,
  version: 1,
  removedAt: null,
  createdByUserId: 'notary-actor',
  updatedByUserId: 'notary-actor',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const group: EvidenceGroupRecord = {
  id: 'group-1',
  departmentId: 'dept-1',
  sourceKind: 'NOTARY_MATTER',
  sourceId: 'matter-1',
  caseId: 'case-1',
  sourceNotaryMatterId: 'matter-1',
  version: 2,
  sourceInitializedAt: new Date(),
  updatedAt: new Date(),
  items: [],
  paperCertificates: [
    paper,
    { ...paper, id: 'paper-2', number: 'N2', status: 'MAILED_TO_LAWYER' },
  ],
  auditEvents: [
    {
      id: 'source-audit',
      departmentId: 'dept-1',
      actorUserId: 'notary-actor',
      internalActorUserId: null,
      notaryOfficeAccountBindingId: 'binding-1',
      operation: 'IMPORT_NOTARY_SOURCE',
      groupId: 'group-1',
      itemId: null,
      paperCertificateId: 'paper-1',
      beforeSnapshot: null,
      afterSnapshot: { sourceCertificateId: 'certificate-1', electronicFiles },
      createdAt: new Date(),
    },
  ],
};

const item: EvidenceGroupRecord['items'][number] = {
  id: 'item-1',
  departmentId: group.departmentId,
  groupId: group.id,
  caseId: group.caseId,
  sourceNotaryMatterId: group.sourceNotaryMatterId,
  sourceKind: group.sourceKind,
  sourceId: group.sourceId,
  displayCode: null,
  name: null,
  kind: null,
  collectedOn: null,
  provenance: null,
  shelfLocation: null,
  keeperUserId: null,
  status: 'UNDELIVERED',
  remark: null,
  version: 1,
  removedAt: null,
  createdByUserId: 'notary-actor',
  updatedByUserId: 'notary-actor',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('evidence public read projection', () => {
  it.each([
    ['SECOND_INSTANCE', '2026-10-10', '2026-10-20', '2026-10-20'],
    ['WAITING_HEARING', '2026-10-10', '2026-10-20', '2026-10-10'],
    ['SECOND_INSTANCE', '2026-10-10', null, null],
    ['WAITING_HEARING', null, '2026-10-20', null],
    ['SECOND_INSTANCE', null, null, null],
  ])(
    'displays and filters the same hearing date at %s with dates %s / %s',
    (stage, hearingOn, secondHearingOn, expectedDay) => {
      const datedSource = {
        ...source,
        case: { ...source.case, stage },
        hearingOn,
        secondHearingOn,
      };
      const view = projectEvidenceGroup(
        { ...group, items: [item] },
        datedSource,
      );
      expect(view.items[0].hearingOn).toBe(expectedDay);
      const filterRow = {
        ...item,
        stage,
        hearingOn,
        secondHearingOn,
        closedOn: source.closedOn,
        lawyerName: source.case.lawyerName,
      };
      for (const day of ['2026-10-10', '2026-10-20']) {
        expect(
          matchesEvidenceFilter(filterRow, { hearFrom: day, hearTo: day }),
        ).toBe(view.items[0].hearingOn === day);
      }
    },
  );

  it('keeps a genuinely empty group addressable and preserves both books and all frozen files', () => {
    const view = projectEvidenceGroup(group, source);
    expect(view.groupId).toBe('group-1');
    expect(view.items).toEqual([]);
    expect(
      view.paperCertificates.map((entry) => [
        entry.id,
        entry.number,
        entry.status,
      ]),
    ).toEqual([
      ['paper-1', 'N1', 'NOT_ISSUED'],
      ['paper-2', 'N2', 'MAILED_TO_LAWYER'],
    ]);
    expect(view.paperCertificates[0].electronicFiles).toEqual(electronicFiles);
    expect(view.paperCertificates[1].electronicFiles).toEqual(electronicFiles);
  });
  it('rejects conflicting source audit bundles and mismatched group ownership instead of silently taking one', () => {
    expect(() =>
      projectEvidenceGroup(
        { ...group, auditEvents: [...group.auditEvents, ...group.auditEvents] },
        source,
      ),
    ).toThrow('证物来源或电子版本集合不完整');
    expect(() =>
      projectEvidenceGroup(group, { ...source, departmentId: 'foreign-dept' }),
    ).toThrow('证物来源或电子版本集合不完整');
  });
});
