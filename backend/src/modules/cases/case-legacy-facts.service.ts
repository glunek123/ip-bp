import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

export type CaseLegacyFactsInput = {
  submitRegisterOn?: string | null;
  pleadingsApproveOn?: string | null;
  pleadingsConfirmOn?: string | null;
  prepayOn?: string | null;
  courtFeeOn?: string | null;
  customerSettlement?: string | null;
  lawyerSettlement?: string | null;
};

/** 旧库迁移带入的补充字段维护：允许运营在案件详情里更正。 */
@Injectable()
export class CaseLegacyFactsService {
  constructor(private readonly db: DatabaseService) {}

  async update(
    actor: ActorContext,
    caseId: string,
    input: CaseLegacyFactsInput,
  ): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });

    const toDate = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : new Date(value);

    await this.db.case.update({
      where: { id: caseId },
      data: {
        ...(toDate(input.submitRegisterOn) !== undefined
          ? { legacySubmitRegisterOn: toDate(input.submitRegisterOn) }
          : {}),
        ...(toDate(input.pleadingsApproveOn) !== undefined
          ? { legacyPleadingsApproveOn: toDate(input.pleadingsApproveOn) }
          : {}),
        ...(toDate(input.pleadingsConfirmOn) !== undefined
          ? { legacyPleadingsConfirmOn: toDate(input.pleadingsConfirmOn) }
          : {}),
        ...(toDate(input.prepayOn) !== undefined
          ? { legacyPrepayOn: toDate(input.prepayOn) }
          : {}),
        ...(toDate(input.courtFeeOn) !== undefined
          ? { legacyCourtFeeOn: toDate(input.courtFeeOn) }
          : {}),
        ...(input.customerSettlement !== undefined
          ? { legacyCustomerSettlement: input.customerSettlement }
          : {}),
        ...(input.lawyerSettlement !== undefined
          ? { legacyLawyerSettlement: input.lawyerSettlement }
          : {}),
      },
      select: { id: true },
    });
    return { id: caseId };
  }
}
