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
  customerSettleNote?: string | null;
  lawyerSettleNote?: string | null;
  mediationNo?: string | null;
  hearingOn?: string | null;
  notarizationNumber?: string | null;
  executionNo?: string | null;
  executionOn?: string | null;
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

    const dateOf = (value: string | null | undefined): Date | null => {
      if (value === undefined || value === null || value.trim() === '')
        return null;
      const normalized = value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized))
        throw new BadRequestException({ code: 'DATE_INVALID' });
      const parsed = new Date(`${normalized}T00:00:00.000Z`);
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== normalized
      ) {
        throw new BadRequestException({ code: 'DATE_INVALID' });
      }
      return parsed;
    };
    const textOf = (value: string | null | undefined): string | null => {
      if (value === undefined || value === null) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const data: Record<string, Date | string | null> = {};
    if (input.submitRegisterOn !== undefined)
      data.legacySubmitRegisterOn = dateOf(input.submitRegisterOn);
    if (input.pleadingsApproveOn !== undefined)
      data.legacyPleadingsApproveOn = dateOf(input.pleadingsApproveOn);
    if (input.pleadingsConfirmOn !== undefined)
      data.legacyPleadingsConfirmOn = dateOf(input.pleadingsConfirmOn);
    if (input.prepayOn !== undefined)
      data.legacyPrepayOn = dateOf(input.prepayOn);
    if (input.courtFeeOn !== undefined)
      data.legacyCourtFeeOn = dateOf(input.courtFeeOn);
    if (input.customerSettlement !== undefined)
      data.legacyCustomerSettlement = textOf(input.customerSettlement);
    if (input.lawyerSettlement !== undefined)
      data.legacyLawyerSettlement = textOf(input.lawyerSettlement);
    if (input.customerSettleNote !== undefined)
      data.legacyCustomerSettleNote = textOf(input.customerSettleNote);
    if (input.lawyerSettleNote !== undefined)
      data.legacyLawyerSettleNote = textOf(input.lawyerSettleNote);
    if (input.mediationNo !== undefined)
      data.legacyMediationNo = textOf(input.mediationNo);
    if (input.hearingOn !== undefined)
      data.legacyHearingOn = dateOf(input.hearingOn);
    if (input.notarizationNumber !== undefined)
      data.legacyNotarizationNumber = textOf(input.notarizationNumber);
    if (input.executionNo !== undefined)
      data.legacyExecutionNo = textOf(input.executionNo);
    if (input.executionOn !== undefined)
      data.legacyExecutionOn = dateOf(input.executionOn);

    if (Object.keys(data).length > 0) {
      await this.db.case.update({
        where: { id: caseId },
        data,
      });
    }
    return { id: caseId };
  }
}
