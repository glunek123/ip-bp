import { ForbiddenException } from '@nestjs/common';
import { CaseReportsSourceService, CaseReportsSnapshot } from '../cases';
import { ReportsService } from './reports.service';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 3,
};
const base: CaseReportsSnapshot = {
  generatedAt: '2026-10-21T08:00:00.000Z',
  totalCases: 5,
  inProgressCases: 3,
  archivedClaims: [
    { state: 'KNOWN', amount: '1000' },
    { state: 'KNOWN', amount: '3000' },
  ],
};
function fixture(snapshot: CaseReportsSnapshot = base) {
  const source = {
    canRead: jest.fn().mockResolvedValue(true),
    snapshot: jest.fn().mockResolvedValue(snapshot),
  };
  return {
    source,
    service: new ReportsService(source as unknown as CaseReportsSourceService),
  };
}
describe('ReportsService', () => {
  it('returns only the fixed definition and authorized counts with the average', async () => {
    const { source, service } = fixture();
    await expect(service.overview(actor)).resolves.toEqual({
      metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
      currency: 'CNY',
      scope: 'DEPARTMENT',
      period: 'ALL_TIME',
      definitionVersion: 'RP001-1',
      generatedAt: base.generatedAt,
      totalCases: 5,
      inProgressCases: 3,
      archivedCases: 2,
      status: 'VALUE',
      amount: '2000.00',
      reason: null,
    });
    expect(source.snapshot).toHaveBeenCalledWith(actor);
  });
  it('keeps non-archived case counts when there are no archived cases', async () => {
    const { service } = fixture({
      ...base,
      inProgressCases: 5,
      archivedClaims: [],
    });
    await expect(service.overview(actor)).resolves.toMatchObject({
      totalCases: 5,
      inProgressCases: 5,
      archivedCases: 0,
      status: 'NO_RECORDS',
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
    });
  });
  it('distinguishes existing archives with no known amount from a real zero', async () => {
    const { source, service } = fixture({
      ...base,
      archivedClaims: [
        { state: 'PENDING', amount: null },
        { state: 'UNRECORDED', amount: null },
      ],
    });
    await expect(service.overview(actor)).resolves.toMatchObject({
      archivedCases: 2,
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
    });
    source.snapshot.mockResolvedValue({
      ...base,
      archivedClaims: [
        { state: 'KNOWN', amount: '0' },
        { state: 'PENDING', amount: null },
      ],
    });
    await expect(service.overview(actor)).resolves.toMatchObject({
      status: 'VALUE',
      amount: '0.00',
      reason: null,
    });
  });
  it('does not convert authorization failures into successful no-data results', async () => {
    const { source, service } = fixture();
    source.snapshot.mockRejectedValue(
      new ForbiddenException({ code: 'ACTION_FORBIDDEN' }),
    );
    await expect(service.overview(actor)).rejects.toThrow(ForbiddenException);
  });
  it('maps invalid decimal sources to the stable public error', async () => {
    const { service } = fixture({
      ...base,
      archivedClaims: [{ state: 'KNOWN', amount: 'NaN' }],
    });
    await expect(service.overview(actor)).rejects.toMatchObject({
      response: { code: 'REPORT_SOURCE_INVALID' },
    });
  });
  it('returns capability without requesting an overview', async () => {
    const { source, service } = fixture();
    source.canRead.mockResolvedValue(false);
    await expect(service.capability(actor)).resolves.toEqual({
      canRead: false,
    });
    expect(source.snapshot).not.toHaveBeenCalled();
  });
});
