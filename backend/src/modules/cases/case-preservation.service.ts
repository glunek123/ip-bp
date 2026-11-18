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
  feeAmount?: string | null;
  premiumAmount?: string | null;
};

const money = /^(?:0|[1-9]\d{0,15})\.\d{2}$/u;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

@Injectable()
export class CasePreservationService {
  constructor(private readonly db: DatabaseService) {}

  async get(actor: ActorContext, caseId: string) {
    await this.assertCase(actor, caseId);
    const row = await this.db.casePreservation.findFirst({
      where: { caseId, departmentId: actor.departmentId },
      orderBy: { recordedAt: 'desc' },
    });
    return row
      ? {
          id: row.id,
          documentVersionId: row.documentVersionId,
      documentName: row.documentName,
          preservedOn: row.preservedOn.toISOString().slice(0, 10),
          feeAmount: row.feeAmount?.toFixed(2) ?? null,
          premiumAmount: row.premiumAmount?.toFixed(2) ?? null,
          recordedAt: row.recordedAt.toISOString(),
        }
      : null;
  }

  async save(actor: ActorContext, caseId: string, input: PreservationInput) {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    await this.assertCase(actor, caseId);
    if (input.documentVersionId && !uuid.test(input.documentVersionId))
      throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.preservedOn))
      throw new BadRequestException({ code: 'INVALID_PRESERVED_ON' });
    for (const value of [input.feeAmount, input.premiumAmount]) {
      if (value === undefined || value === null || value === '') continue;
      if (!money.test(value))
        throw new BadRequestException({ code: 'INVALID_AMOUNT' });
    }
    const row = await this.db.casePreservation.create({
      data: {
        departmentId: actor.departmentId,
        caseId,
        documentVersionId: input.documentVersionId ?? null,
        documentName: input.documentName?.trim() || null,
        preservedOn: new Date(`${input.preservedOn}T00:00:00.000Z`),
        feeAmount: input.feeAmount ? input.feeAmount : null,
        premiumAmount: input.premiumAmount ? input.premiumAmount : null,
        recordedByUserId: actor.userId,
      },
    });
    return {
      id: row.id,
      documentVersionId: row.documentVersionId,
      documentName: row.documentName,
      preservedOn: row.preservedOn.toISOString().slice(0, 10),
      feeAmount: row.feeAmount?.toFixed(2) ?? null,
      premiumAmount: row.premiumAmount?.toFixed(2) ?? null,
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
