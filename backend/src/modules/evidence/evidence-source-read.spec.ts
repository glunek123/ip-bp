import type { Prisma } from '../../generated/prisma/client';
import {
  listEvidenceSources,
  readEvidenceSource,
} from './evidence-source-read';

const externalCase = {
  id: 'case-external',
  departmentId: 'dept-1',
  businessNo: 'IP-EXTERNAL',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  version: 3,
  stage: 'WAITING_HEARING',
  courtCaseNo: null,
  sourceNotaryMatterId: null,
  certificateId: null,
  externalEntry: {
    known: { platform: 'TAOBAO', shopName: '真实外部来源店铺' },
  },
  sourceLead: null,
  lawyers: [{ lawyer: { fullName: 'Lin' } }, { lawyer: { fullName: 'Chen' } }],
  hearingArrangements: [],
  currentSecondInstanceProgress: null,
  closure: null,
};
const normalCase = {
  ...externalCase,
  id: 'case-normal',
  sourceNotaryMatterId: 'matter-1',
  certificateId: 'certificate-1',
  externalEntry: null,
  sourceLead: { platform: 'TAOBAO', shopName: '真实公证来源店铺' },
};
const notary = {
  id: 'matter-1',
  departmentId: 'dept-1',
  businessNo: 'N-1',
  version: 8,
  createdAt: new Date('2026-10-02T00:00:00Z'),
  sourceSnapshot: { shopName: '真实公证来源店铺', platform: 'TAOBAO' },
  sourceLead: normalCase.sourceLead,
  notaryOffice: { name: '实际公证处' },
  evidence: { evidenceAt: new Date('2026-09-30T00:00:00Z') },
  certificate: {
    id: 'certificate-1',
    actorUserId: 'notary-actor',
    notaryOfficeAccountBindingId: 'binding-1',
    certificateNo: '证书号1',
    certificateDate: new Date('2026-10-02T00:00:00Z'),
  },
  case: normalCase,
};

function fixture() {
  const store = {
    case: { findFirst: jest.fn(), findMany: jest.fn() },
    notaryMatter: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  return { store, reader: store as unknown as Prisma.TransactionClient };
}

describe('evidence source reads', () => {
  it('uses one canonical notary source for an issued matter and its transferred case, with department-scoped reads', async () => {
    const f = fixture();
    f.store.case.findFirst.mockResolvedValue(normalCase);
    f.store.notaryMatter.findFirst.mockResolvedValue(notary);
    const fromCase = await readEvidenceSource(
      f.reader,
      'dept-1',
      'CASE',
      'case-normal',
    );
    expect(fromCase).toEqual(
      await readEvidenceSource(f.reader, 'dept-1', 'NOTARY_MATTER', 'matter-1'),
    );
    expect(fromCase.sourceKind).toBe('NOTARY_MATTER');
    expect(fromCase.case.lawyerName).toBe('Lin / Chen');
    expect(f.store.case.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case-normal', departmentId: 'dept-1' },
      }),
    );
    expect(f.store.notaryMatter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'matter-1',
          departmentId: 'dept-1',
          certificate: { isNot: null },
        },
      }),
    );
  });

  it('projects the effective hearing and closure corrections rather than the old dates', async () => {
    const f = fixture();
    const metadata = {
      id: 'edit-1',
      priorCorrectionId: null,
      fromRevision: 0,
      toRevision: 1,
      correctionReason: '核对原始资料',
      recordedAt: new Date('2026-10-10T00:00:00Z'),
      recordedByUserId: 'internal-1',
    };
    f.store.case.findFirst.mockResolvedValue({
      ...externalCase,
      hearingArrangements: [
        {
          hearingAt: new Date('2026-10-01T00:00:00Z'),
          recordCorrections: [
            { ...metadata, hearingAt: new Date('2026-10-12T00:00:00Z') },
          ],
        },
      ],
      closure: {
        currentVersion: {
          id: 'closure-1',
          closeAt: new Date('2026-10-14T00:00:00Z'),
        },
        recordCorrections: [
          {
            ...metadata,
            sourceClosureVersionId: 'closure-1',
            closeAt: new Date('2026-10-16T00:00:00Z'),
          },
        ],
      },
    });
    const source = await readEvidenceSource(
      f.reader,
      'dept-1',
      'CASE',
      externalCase.id,
    );
    expect(source.hearingOn).toBe('2026-10-12');
    expect(source.closedOn).toBe('2026-10-16');
    expect(source.certificate).toBeNull();
  });

  it('discovers real sources without needing an item, a warehouse row or a write method', async () => {
    const f = fixture();
    f.store.case.findMany.mockResolvedValue([externalCase]);
    f.store.notaryMatter.findMany.mockResolvedValue([notary]);
    const sources = await listEvidenceSources(f.reader, 'dept-1');
    expect(sources.map((source) => source.sourceKind)).toEqual([
      'NOTARY_MATTER',
      'CASE',
    ]);
    expect(sources).toHaveLength(2);
    expect(f.store.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { departmentId: 'dept-1', sourceNotaryMatterId: null },
      }),
    );
  });
});
