import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

export type CaseDisclosureInput = {
  license?: string | null;
  entityName?: string | null;
  address?: string | null;
  entityType?: string | null;
  idNumber?: string | null;
  legalPerson?: string | null;
  phone?: string | null;
  emergencyPhone?: string | null;
  extraInfo?: string | null;
  salesAmount?: string | null;
  disclosedOn?: string | null;
};

const FIELDS = [
  'license',
  'entityName',
  'address',
  'entityType',
  'idNumber',
  'legalPerson',
  'phone',
  'emergencyPhone',
  'extraInfo',
  'salesAmount',
] as const;

/**
 * 披露信息的维护：历史迁移案件先有快照，后续由运营在案件详情里补录或更正。
 */
@Injectable()
export class CaseDisclosureService {
  constructor(private readonly db: DatabaseService) {}

  async update(
    actor: ActorContext,
    caseId: string,
    input: CaseDisclosureInput,
  ): Promise<{ id: string }> {
    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });

    const data: Record<string, string | null> = {};
    for (const key of FIELDS) {
      const value = input[key];
      if (value !== undefined) data[key] = value === null ? null : value;
    }
    const disclosedOn =
      input.disclosedOn === undefined
        ? undefined
        : input.disclosedOn === null
          ? null
          : new Date(input.disclosedOn);

    const saved = await this.db.caseDisclosure.upsert({
      where: { caseId },
      create: {
        caseId,
        departmentId: actor.departmentId,
        ...data,
        ...(disclosedOn !== undefined ? { disclosedOn } : {}),
      },
      update: {
        ...data,
        ...(disclosedOn !== undefined ? { disclosedOn } : {}),
      },
      select: { id: true },
    });
    return { id: saved.id };
  }

  async remove(actor: ActorContext, caseId: string): Promise<{ id: string }> {
    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    await this.db.caseDisclosure.deleteMany({ where: { caseId } });
    return { id: caseId };
  }
}
