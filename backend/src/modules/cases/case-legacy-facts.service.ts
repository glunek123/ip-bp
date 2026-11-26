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

    const flag = (value: unknown) => value !== undefined;
    const dateOf = (value: string | null | undefined): string | null => {
      if (value === undefined || value === null || value.trim() === '')
        return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()))
        throw new BadRequestException({ code: 'DATE_INVALID' });
      return value.slice(0, 10);
    };
    await this.db.$executeRawUnsafe(
      `SELECT update_case_legacy_facts(
        $1::uuid, $2::date, $3::date, $4::date, $5::date, $6::date,
        $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      caseId,
      dateOf(input.submitRegisterOn),
      dateOf(input.pleadingsApproveOn),
      dateOf(input.pleadingsConfirmOn),
      dateOf(input.prepayOn),
      dateOf(input.courtFeeOn),
      input.customerSettlement ?? null,
      input.lawyerSettlement ?? null,
      flag(input.submitRegisterOn),
      flag(input.pleadingsApproveOn),
      flag(input.pleadingsConfirmOn),
      flag(input.prepayOn),
      flag(input.courtFeeOn),
      flag(input.customerSettlement),
      flag(input.lawyerSettlement),
    );
    return { id: caseId };
  }
}
