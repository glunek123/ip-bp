import { ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import type { DatabaseService } from '../../database/database.service';
import type { MaterialService } from '../materials';
import { CaseFeeStatisticsDto } from './fee.dto';
import { FeeService } from './fee.service';

const actor: ActorContext = {
  userId: 'operator',
  departmentId: 'department',
  authorizationRevision: 1,
};
const caseId = 'f7245b91-cdd0-46e8-903c-30b136be5a24';

function fixture() {
  const database = { feeRecord: { findMany: jest.fn() } };
  const access = { authorizeDepartmentAction: jest.fn() };
  const service = new FeeService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
    {} as OrganizationService,
    {} as MaterialService,
  );
  return { database, access, service };
}

describe('case fee source statistics', () => {
  it('counts all active source rows, shared proof versions and nonempty notes', async () => {
    const { database, access, service } = fixture();
    database.feeRecord.findMany.mockResolvedValue([
      { note: '已核实', proofMaterialId: 'proof', proofContentVersionId: 'v1' },
      { note: '  ', proofMaterialId: 'proof', proofContentVersionId: 'v1' },
      { note: null, proofMaterialId: 'proof', proofContentVersionId: 'v2' },
      { note: '说明', proofMaterialId: null, proofContentVersionId: null },
    ]);
    await expect(service.caseStatistics(actor, { caseId })).resolves.toEqual({
      caseId,
      scope: 'CASE_ACTIVE_SOURCE_RECORDS',
      recordCount: 4,
      proofRecordCount: 3,
      proofVersionCount: 2,
      noteRecordCount: 2,
    });
    expect(access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'fee.read',
    );
    expect(database.feeRecord.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        caseId,
        deletedAt: null,
        cancellation: { is: null },
      },
      select: {
        note: true,
        proofMaterialId: true,
        proofContentVersionId: true,
      },
    });
  });

  it('rejects without fee.read before reading any case facts', async () => {
    const { database, access, service } = fixture();
    access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.caseStatistics(actor, { caseId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.feeRecord.findMany).not.toHaveBeenCalled();
  });

  it('requires a concrete case id', async () => {
    expect(await validate(new CaseFeeStatisticsDto())).not.toHaveLength(0);
    expect(
      await validate(Object.assign(new CaseFeeStatisticsDto(), { caseId })),
    ).toHaveLength(0);
  });
});
