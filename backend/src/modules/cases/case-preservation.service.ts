import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ActorContext } from '../../access-control/actor-context';
import type { DatabaseService } from '../../database/database.service';

export type PreservationInput = {
  documentVersionId?: string | null;
  documentName?: string | null;
  preservedOn: string;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

@Injectable()
export class CasePreservationService {
  constructor(private readonly db: DatabaseService) {}

  /** 保全费／保全保费以费用明细（fee_records）为准，实时汇总。 */
  private async feeTotals(actor: ActorContext, caseId: string) {
    const rows = await this.db.feeRecord.groupBy({
      by: ['type'],
      where: {
        caseId,
        departmentId: actor.departmentId,
        type: { in: ['保全费', '保全保费'] },
      },
      _sum: { amount: true },
    });
    const total = (type: string) =>
      rows
        .filter((row) => row.type === type)
        .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0)
        .toFixed(2);
    return { fee: total('保全费'), premium: total('保全保费') };
  }

  async get(actor: ActorContext, caseId: string) {
    await this.assertCase(actor, caseId);
    const totals = await this.feeTotals(actor, caseId);
    const row = await this.db.casePreservation.findFirst({
      where: { caseId, departmentId: actor.departmentId },
      orderBy: { recordedAt: 'desc' },
    });
    if (!row)
      return {
        id: null,
        documentVersionId: null,
        documentName: null,
        preservedOn: null,
        feeAmount: totals.fee,
        premiumAmount: totals.premium,
        recordedAt: null,
      };
    return {
      id: row.id,
      documentVersionId: row.documentVersionId,
      documentName: row.documentName,
      preservedOn: row.preservedOn.toISOString().slice(0, 10),
      feeAmount: totals.fee,
      premiumAmount: totals.premium,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  async save(actor: ActorContext, caseId: string, input: PreservationInput) {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    await this.assertCase(actor, caseId);
    if (input.documentVersionId && !uuid.test(input.documentVersionId))
      throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.preservedOn))
      throw new BadRequestException({ code: 'INVALID_PRESERVED_ON' });
    const totals = await this.feeTotals(actor, caseId);
    const row = await this.db.casePreservation.create({
      data: {
        departmentId: actor.departmentId,
        caseId,
        documentVersionId: input.documentVersionId ?? null,
        documentName: input.documentName?.trim() || null,
        preservedOn: new Date(`${input.preservedOn}T00:00:00.000Z`),
        feeAmount: totals.fee,
        premiumAmount: totals.premium,
        recordedByUserId: actor.userId,
      },
    });
    return {
      id: row.id,
      documentVersionId: row.documentVersionId,
      documentName: row.documentName,
      preservedOn: row.preservedOn.toISOString().slice(0, 10),
      feeAmount: totals.fee,
      premiumAmount: totals.premium,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  private async assertCase(actor: ActorContext, caseId: string): Promise<void> {
    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
  }
}
