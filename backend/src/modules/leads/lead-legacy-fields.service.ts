import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

export type LeadLegacyFieldsInput = {
  clueSource?: string | null;
  approvedOn?: string | null;
  confirmedOn?: string | null;
  purchasedOn?: string | null;
  reviewOpinion?: string | null;
  reviewNote?: string | null;
};

/** 旧库线索流程字段维护（归档线索的触发器会拒绝普通 UPDATE，走 DEFINER 函数）。 */
@Injectable()
export class LeadLegacyFieldsService {
  constructor(private readonly db: DatabaseService) {}

  async update(
    actor: ActorContext,
    leadId: string,
    input: LeadLegacyFieldsInput,
  ): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'LEAD_ACTION_FORBIDDEN' });
    const found = await this.db.lead.findFirst({
      where: { id: leadId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'LEAD_NOT_FOUND' });

    const date = (value: string | null | undefined) => {
      if (value === undefined || value === null || value.trim() === '')
        return null;
      return value.slice(0, 10);
    };
    const set = (value: unknown) => value !== undefined;

    await this.db.$executeRawUnsafe(
      `SELECT update_lead_legacy_fields(
        $1::uuid, $2, $3::date, $4::date, $5::date, $6, $7,
        $8, $9, $10, $11, $12, $13)`,
      leadId,
      input.clueSource ?? null,
      date(input.approvedOn),
      date(input.confirmedOn),
      date(input.purchasedOn),
      input.reviewOpinion ?? null,
      input.reviewNote ?? null,
      set(input.clueSource),
      set(input.approvedOn),
      set(input.confirmedOn),
      set(input.purchasedOn),
      set(input.reviewOpinion),
      set(input.reviewNote),
    );
    return { id: leadId };
  }
}
