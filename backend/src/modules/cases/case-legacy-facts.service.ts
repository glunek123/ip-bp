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

    const sets: string[] = [];
    const params: Array<string | null> = [];
    const putDate = (key: string, value: string | null | undefined) => {
      if (value === undefined) return;
      if (value === null || value.trim() === '') {
        params.push(null);
      } else {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime()))
          throw new BadRequestException({ code: 'DATE_INVALID' });
        params.push(value.slice(0, 10));
      }
      sets.push(`"${key}" = $${params.length}::date`);
    };
    putDate('legacy_submit_register_on', input.submitRegisterOn);
    putDate('legacy_pleadings_approve_on', input.pleadingsApproveOn);
    putDate('legacy_pleadings_confirm_on', input.pleadingsConfirmOn);
    putDate('legacy_prepay_on', input.prepayOn);
    putDate('legacy_court_fee_on', input.courtFeeOn);
    const putText = (key: string, value: string | null | undefined) => {
      if (value === undefined) return;
      params.push(value === null || value === '' ? null : value);
      sets.push(`"${key}" = $${params.length}`);
    };
    putText('legacy_customer_settlement', input.customerSettlement);
    putText('legacy_lawyer_settlement', input.lawyerSettlement);
    if (sets.length === 0) return { id: caseId };

    params.push(caseId);
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = 'replica'",
      );
      await tx.$executeRawUnsafe(
        `UPDATE cases SET ${sets.join(', ')} WHERE id = $${params.length}::uuid`,
        ...params,
      );
    });
    return { id: caseId };
  }
}
