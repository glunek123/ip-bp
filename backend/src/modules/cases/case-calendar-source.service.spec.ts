import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { CaseCalendarSourceService } from './case-calendar-source.service';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 3,
};
const caseRow = {
  id: 'case-1',
  businessNo: 'BUS-1',
  rightsHolder: { name: '权利人' },
  defendants: [{ name: '被告' }],
  currentHearingArrangement: {
    id: 'h-1',
    hearingAt: new Date('2026-10-13T00:00:00.000Z'),
  },
  currentSecondInstanceProgress: {
    id: 'h-2',
    hearingAt: new Date('2026-10-20T00:00:00.000Z'),
    hearingPlace: '内部地点',
    judgeName: '内部法官',
  },
};

describe('CaseCalendarSourceService', () => {
  it('uses a corrected hearing date for client calendar without exposing internal metadata', async () => {
    const { service, database } = fixture('CLIENT');
    database.case.findMany.mockResolvedValue([
      {
        ...caseRow,
        currentHearingArrangement: {
          ...caseRow.currentHearingArrangement,
          hearingAt: null,
          recordCorrections: [
            {
              hearingAt: new Date('2026-10-14T00:00:00Z'),
              correctionReason: '内部更正原因',
              recordedByUserId: 'operator',
            },
          ],
        },
      },
    ]);
    const facts = await service.list({
      ...actor,
      clientCustomerId: 'customer-1',
    });
    expect(facts.find((fact) => fact.sourceId === 'h-1')).toEqual({
      sourceType: 'FIRST_INSTANCE_HEARING',
      sourceId: 'h-1',
      date: '2026-10-14',
      caseId: 'case-1',
      businessNo: 'BUS-1',
      party: '权利人',
      defendant: '被告',
      place: null,
      judge: null,
    });
    expect(JSON.stringify(facts)).not.toContain('内部更正原因');
  });
  it('removes an effective unknown hearing date instead of falling back to its frozen date', async () => {
    const { service, database } = fixture('INTERNAL');
    database.case.findMany.mockResolvedValue([
      {
        ...caseRow,
        currentHearingArrangement: {
          ...caseRow.currentHearingArrangement,
          recordCorrections: [{ hearingAt: null }],
        },
      },
    ]);
    expect(
      (await service.list(actor)).some((fact) => fact.sourceId === 'h-1'),
    ).toBe(false);
  });
  function fixture(accountType: 'INTERNAL' | 'LAWYER' | 'CLIENT') {
    const database = {
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          accountType,
          authorizationRevision: 3,
        }),
      },
      lawyerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding' }),
      },
      customerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding' }),
      },
      case: { findMany: jest.fn().mockResolvedValue([caseRow]) },
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CaseCalendarSourceService(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
    );
    return { database, access, service };
  }

  it('requires the existing internal case.read department grant', async () => {
    const { service, access, database } = fixture('INTERNAL');
    access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(service.list(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.case.findMany).not.toHaveBeenCalled();
  });
  it('projects only owner facts, original formal registration time and case responsibility epoch', async () => {
    const { service, database } = fixture('INTERNAL');
    database.case.findMany.mockResolvedValue([
      {
        id: 'case-1',
        businessNo: 'BUS-1',
        responsibilityEpoch: 2,
        currentHearingArrangement: null,
        currentSecondInstanceProgress: null,
        judgmentFacts: [
          { id: 'j-1', recordedAt: new Date('2026-10-26T17:30:00Z') },
        ],
        secondInstanceResults: [
          { id: 's-1', recordedAt: new Date('2026-10-27T01:00:00Z') },
        ],
      },
    ]);
    const facts = await service.listOwnedReminders(actor);
    expect(facts).toMatchObject([
      {
        sourceType: 'FIRST_INSTANCE_JUDGMENT',
        sourceId: 'j-1',
        date: '2026-10-27',
        ownerEpoch: 'case-1:2',
      },
      {
        sourceType: 'SECOND_INSTANCE_RESULT',
        sourceId: 's-1',
        date: '2026-10-27',
        ownerEpoch: 'case-1:2',
      },
    ]);
    expect(database.case.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      },
      select: {
        judgmentFacts: {
          where: { kind: 'REGISTER', trialRound: { revokedAt: null } },
        },
        secondInstanceResults: {
          where: { revocation: { is: null }, trialRound: { revokedAt: null } },
        },
      },
    });
  });

  it('uses the current PRIMARY lawyer predicate', async () => {
    const { service, database } = fixture('LAWYER');
    await service.list({ ...actor, lawyerAccountId: actor.userId });
    expect(
      database.case.findMany.mock.calls[0][0].where.lawyers.some,
    ).toMatchObject({ role: 'PRIMARY', endedAt: null });
  });

  it('uses the admitted client binding and confirmed complaint predicate, without internal court details', async () => {
    const { service, database } = fixture('CLIENT');
    const events = await service.list({
      ...actor,
      clientCustomerId: 'customer-1',
    });
    expect(
      database.customerAccountBinding.findFirst.mock.calls[0][0].where,
    ).toMatchObject({
      customerId: 'customer-1',
      customer: { profileStatus: 'ADMITTED' },
    });
    expect(database.case.findMany.mock.calls[0][0].where).toMatchObject({
      customerId: 'customer-1',
      complaintConfirmation: { isNot: null },
    });
    expect(events.map((event) => event.sourceType)).toEqual([
      'FIRST_INSTANCE_HEARING',
      'SECOND_INSTANCE_HEARING',
    ]);
    expect(events[1]).toMatchObject({
      place: null,
      judge: null,
      businessNo: 'BUS-1',
    });
  });

  it('rejects an outdated authorization revision before reading cases', async () => {
    const { service, database } = fixture('INTERNAL');
    await expect(
      service.list({ ...actor, authorizationRevision: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.case.findMany).not.toHaveBeenCalled();
  });

  it('rejects a lawyer binding revoked during the case read', async () => {
    const { service, database } = fixture('LAWYER');
    database.lawyerAccountBinding.findFirst
      .mockResolvedValueOnce({ id: 'binding' })
      .mockResolvedValueOnce(null);
    await expect(
      service.list({ ...actor, lawyerAccountId: actor.userId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a case removed from the current PRIMARY lawyer scope', async () => {
    const { service, database } = fixture('LAWYER');
    database.case.findMany
      .mockResolvedValueOnce([caseRow])
      .mockResolvedValueOnce([]);
    await expect(
      service.list({ ...actor, lawyerAccountId: actor.userId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.case.findMany.mock.calls[1][0].where).toMatchObject({
      id: { in: ['case-1'] },
      lawyers: {
        some: {
          role: 'PRIMARY',
          endedAt: null,
        },
      },
    });
  });

  it('rejects an updated current hearing pointer before returning old facts', async () => {
    const { service, database } = fixture('INTERNAL');
    database.case.findMany
      .mockResolvedValueOnce([caseRow])
      .mockResolvedValueOnce([
        {
          ...caseRow,
          currentHearingArrangement: {
            id: 'h-new',
            hearingAt: new Date('2026-10-14T00:00:00.000Z'),
          },
        },
      ]);
    await expect(service.list(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
