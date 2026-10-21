import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

export type CaseReportAmount =
  | { state: 'KNOWN'; amount: string }
  | { state: 'PENDING' | 'UNRECORDED'; amount: null };

export type CaseReportsSnapshot = {
  generatedAt: string;
  totalCases: number;
  inProgressCases: number;
  archivedClaims: CaseReportAmount[];
};

const select = {
  complaintSubmittedAt: true,
  complaintAmountState: true,
  complaintAmount: true,
  complaintConfirmation: { select: { amountState: true, amount: true } },
} satisfies Prisma.CaseSelect;
type Row = Prisma.CaseGetPayload<{ select: typeof select }>;
const invalidSource = () =>
  new InternalServerErrorException({
    code: 'REPORT_SOURCE_INVALID',
    message: '报表来源数据不完整',
  });

// Matches the effective claim precedence in caseListDisplay. Keep this narrow
// query within the cases owner; reports never queries another module's tables.
function claim(row: Row): CaseReportAmount {
  const confirmation = row.complaintConfirmation;
  if (confirmation === null && row.complaintSubmittedAt === null) {
    if (row.complaintAmountState !== null || row.complaintAmount !== null)
      throw invalidSource();
    return { state: 'UNRECORDED', amount: null };
  }
  const state = confirmation
    ? confirmation.amountState
    : row.complaintAmountState;
  const amount = confirmation ? confirmation.amount : row.complaintAmount;
  if (state === 'PENDING' && amount === null) return { state, amount: null };
  if (
    state === 'KNOWN' &&
    amount !== null &&
    amount.isFinite() &&
    amount.gte(0) &&
    amount.decimalPlaces() <= 2 &&
    amount.lte('99999999999999.99')
  ) {
    return { state, amount: amount.toFixed(2) };
  }
  throw invalidSource();
}

@Injectable()
export class CaseReportsSourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  private async authorize(
    actor: ActorContext,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权查看本部门报表',
      });
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true, authorizationRevision: true },
    });
    if (
      !account?.active ||
      account.accountType !== 'INTERNAL' ||
      account.authorizationRevision !== actor.authorizationRevision
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权查看本部门报表',
      });
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new ForbiddenException({
          code: 'ACTION_FORBIDDEN',
          message: '无权查看本部门报表',
        });
      throw error;
    }
  }

  async canRead(actor: ActorContext): Promise<boolean> {
    return this.database.$transaction(
      async (tx) => {
        try {
          await this.authorize(actor, tx);
          return true;
        } catch (error) {
          if (error instanceof ForbiddenException) return false;
          throw error;
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }

  async snapshot(actor: ActorContext): Promise<CaseReportsSnapshot> {
    return this.database.$transaction(
      async (tx) => {
        await this.authorize(actor, tx);
        // Count the complete current department, never infer it from archived rows.
        const totalCases = await tx.case.count({
          where: { departmentId: actor.departmentId },
        });
        const rows = await tx.case.findMany({
          where: { departmentId: actor.departmentId, stage: 'ARCHIVED' },
          select,
        });
        if (!Number.isSafeInteger(totalCases) || totalCases < rows.length)
          throw invalidSource();
        return {
          generatedAt: new Date().toISOString(),
          totalCases,
          inProgressCases: totalCases - rows.length,
          archivedClaims: rows.map(claim),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }
}
