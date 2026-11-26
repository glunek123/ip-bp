import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

    const data: Record<string, Date | string | null> = {};
    const putDate = (key: string, value: string | null | undefined) => {
      if (value === undefined) return;
      if (value === null || value.trim() === '') {
        data[key] = null;
        return;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()))
        throw new BadRequestException({ code: 'DATE_INVALID' });
      data[key] = parsed;
    };
    putDate('legacySubmitRegisterOn', input.submitRegisterOn);
    putDate('legacyPleadingsApproveOn', input.pleadingsApproveOn);
    putDate('legacyPleadingsConfirmOn', input.pleadingsConfirmOn);
    putDate('legacyPrepayOn', input.prepayOn);
    putDate('legacyCourtFeeOn', input.courtFeeOn);
    if (input.customerSettlement !== undefined)
      data['legacyCustomerSettlement'] = input.customerSettlement;
    if (input.lawyerSettlement !== undefined)
      data['legacyLawyerSettlement'] = input.lawyerSettlement;

    if (Object.keys(data).length > 0)
      await this.db.case.update({ where: { id: caseId }, data });
    return { id: caseId };
  }
}
