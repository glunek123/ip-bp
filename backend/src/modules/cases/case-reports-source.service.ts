import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import {
  AccessControlService,
  ReportReadScope,
  ReportView,
} from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  CaseStage,
  LeadCaseType,
  LeadPlatform,
} from '../../generated/prisma/enums';

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
const centerSelect = {
  ...select,
  id: true,
  departmentId: true,
  responsibleUserId: true,
  customerId: true,
  rightsHolderId: true,
  stage: true,
  sourceLeadId: true,
  sourceNotaryMatterId: true,
  certificateId: true,
  customer: { select: { id: true, departmentId: true } },
  rightsHolder: { select: { id: true, departmentId: true } },
  externalEntry: { select: { caseId: true, departmentId: true, known: true } },
  sourceLead: {
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      rightsHolderId: true,
      caseType: true,
      platform: true,
    },
  },
  sourceNotaryMatter: {
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      rightsHolderId: true,
      sourceLeadId: true,
    },
  },
  acceptance: {
    select: {
      caseId: true,
      departmentId: true,
      courtId: true,
      court: { select: { id: true, name: true, departmentId: true } },
    },
  },
  filingSubmission: {
    select: {
      caseId: true,
      departmentId: true,
      courtId: true,
      courtName: true,
    },
  },
} satisfies Prisma.CaseSelect;
type CenterRow = Prisma.CaseGetPayload<{ select: typeof centerSelect }>;
type CenterFact = {
  caseType: LeadCaseType | null;
  platform: LeadPlatform | null;
  court: { id: string; name: string } | null;
};
export type CaseReportsCenterSnapshot = CaseReportsSnapshot & {
  view: ReportView;
  availableViews: ReportView[];
  exportViews: ReportView[];
  allClaims: CaseReportAmount[];
  distributionCases: CenterFact[];
};
export type CaseReportsExportSnapshot = CaseReportsCenterSnapshot & {
  stageCounts: Array<{ value: CaseStage; count: number }>;
};
const invalidSource = () =>
  new InternalServerErrorException({
    code: 'REPORT_SOURCE_INVALID',
    message: '报表来源数据不完整',
  });

function optionalEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  if (value === null) return null;
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) throw invalidSource();
  return matched;
}

function distributionSource(
  row: CenterRow,
  departmentId: string,
): Omit<CenterFact, 'court'> & {
  court: CenterFact['court'];
  externalCourtId: string | null;
} {
  const {
    sourceLead: lead,
    sourceNotaryMatter: matter,
    externalEntry: external,
  } = row;
  const isExternal =
    row.sourceLeadId === null &&
    row.sourceNotaryMatterId === null &&
    row.certificateId === null &&
    lead === null &&
    matter === null &&
    external !== null &&
    external.caseId === row.id &&
    external.departmentId === departmentId;
  const isNormal =
    external === null &&
    row.sourceLeadId !== null &&
    row.sourceNotaryMatterId !== null &&
    row.certificateId !== null &&
    lead !== null &&
    matter !== null &&
    lead.id === row.sourceLeadId &&
    matter.id === row.sourceNotaryMatterId &&
    matter.sourceLeadId === lead.id &&
    lead.departmentId === departmentId &&
    matter.departmentId === departmentId &&
    lead.customerId === row.customerId &&
    matter.customerId === row.customerId &&
    lead.rightsHolderId === row.rightsHolderId &&
    matter.rightsHolderId === row.rightsHolderId;
  if (
    row.departmentId !== departmentId ||
    !row.customer ||
    !row.rightsHolder ||
    row.customer.id !== row.customerId ||
    row.customer.departmentId !== departmentId ||
    row.rightsHolder.id !== row.rightsHolderId ||
    row.rightsHolder.departmentId !== departmentId ||
    (!isNormal && !isExternal) ||
    !Object.values(CaseStage).includes(row.stage)
  )
    throw invalidSource();
  const known = external?.known;
  if (
    isExternal &&
    (typeof known !== 'object' || known === null || Array.isArray(known))
  )
    throw invalidSource();
  const caseType = optionalEnum(
    isNormal
      ? lead?.caseType
      : typeof known === 'object' && known !== null && !Array.isArray(known)
        ? known.caseType
        : undefined,
    Object.values(LeadCaseType),
  );
  const platform = optionalEnum(
    isNormal
      ? lead?.platform
      : typeof known === 'object' && known !== null && !Array.isArray(known)
        ? known.platform
        : undefined,
    Object.values(LeadPlatform),
  );
  if (isNormal && (caseType === null || platform === null))
    throw invalidSource();
  let court: CenterFact['court'] = null;
  const acceptance = row.acceptance;
  if (acceptance !== null) {
    if (
      acceptance.departmentId !== departmentId ||
      acceptance.caseId !== row.id
    )
      throw invalidSource();
    if (acceptance.court !== null) {
      if (
        acceptance.court.id !== acceptance.courtId ||
        acceptance.court.departmentId !== departmentId ||
        acceptance.court.name.trim().length === 0
      )
        throw invalidSource();
      court = { id: acceptance.court.id, name: acceptance.court.name };
    } else if (acceptance.courtId !== null) throw invalidSource();
  }
  if (court === null && row.filingSubmission !== null) {
    const filing = row.filingSubmission;
    if (
      filing.departmentId !== departmentId ||
      filing.caseId !== row.id ||
      filing.courtName.trim().length === 0
    )
      throw invalidSource();
    court = { id: filing.courtId, name: filing.courtName };
  }
  let externalCourtId: string | null = null;
  if (
    court === null &&
    isExternal &&
    typeof known === 'object' &&
    known !== null &&
    !Array.isArray(known)
  ) {
    const id = known.courtId;
    if (id !== null) {
      if (
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          id,
        )
      )
        throw invalidSource();
      externalCourtId = id.toLowerCase();
    }
  }
  return { caseType, platform, court, externalCourtId };
}

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
    view: ReportView | undefined,
    operation: 'read' | 'export' = 'read',
  ): Promise<ReportReadScope> {
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
      return await this.access.buildReportScope(actor, view, operation, tx);
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
          await this.authorize(actor, tx, undefined);
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
        const scope = await this.authorize(actor, tx, 'department');
        // Count the complete current department, never infer it from archived rows.
        const totalCases = await tx.case.count({
          where: scope.where,
        });
        const rows = await tx.case.findMany({
          where: { ...scope.where, stage: 'ARCHIVED' },
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

  async centerSnapshot(
    actor: ActorContext,
    view?: ReportView,
  ): Promise<CaseReportsCenterSnapshot> {
    return this.database.$transaction(
      (tx) => this.centerSnapshotInTransaction(actor, view, tx),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }

  async centerSnapshotInTransaction(
    actor: ActorContext,
    view: ReportView | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<CaseReportsCenterSnapshot> {
    return this.readCenterSnapshot(actor, view, tx, 'read');
  }

  async exportSnapshot(
    actor: ActorContext,
    view: ReportView,
    tx: Prisma.TransactionClient,
  ): Promise<CaseReportsExportSnapshot> {
    return this.readCenterSnapshot(actor, view, tx, 'export');
  }

  private async readCenterSnapshot(
    actor: ActorContext,
    view: ReportView | undefined,
    tx: Prisma.TransactionClient,
    operation: 'read' | 'export',
  ): Promise<CaseReportsExportSnapshot> {
    const scope = await this.authorize(actor, tx, view, operation);
    const rows = await tx.case.findMany({
      where: scope.where,
      select: centerSelect,
    });
    if (
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      (scope.view === 'mine' &&
        rows.some((row) => row.responsibleUserId !== actor.userId))
    )
      throw invalidSource();
    const projected = rows.map((row) =>
      distributionSource(row, actor.departmentId),
    );
    const ids = [
      ...new Set(
        projected.flatMap((row) =>
          row.externalCourtId === null ? [] : [row.externalCourtId],
        ),
      ),
    ].sort();
    const courts =
      ids.length === 0
        ? []
        : await tx.filingCourt.findMany({
            where: { departmentId: actor.departmentId, id: { in: ids } },
            select: { id: true, name: true, departmentId: true },
          });
    const byId = new Map<string, { id: string; name: string }>();
    for (const court of courts) {
      if (
        court.departmentId !== actor.departmentId ||
        !ids.includes(court.id) ||
        byId.has(court.id) ||
        court.name.trim().length === 0
      )
        throw invalidSource();
      byId.set(court.id, { id: court.id, name: court.name });
    }
    const distributionCases = projected.map((row) => {
      const court =
        row.externalCourtId === null
          ? row.court
          : byId.get(row.externalCourtId);
      if (court === undefined) throw invalidSource();
      return { caseType: row.caseType, platform: row.platform, court };
    });
    const archived = rows.filter((row) => row.stage === 'ARCHIVED');
    const stages = new Map<CaseStage, number>();
    for (const row of rows)
      stages.set(row.stage, (stages.get(row.stage) ?? 0) + 1);
    return {
      view: scope.view,
      availableViews: scope.availableViews,
      // Cross-domain availability belongs to the report composer.
      exportViews: [],
      generatedAt: new Date().toISOString(),
      totalCases: rows.length,
      inProgressCases: rows.length - archived.length,
      archivedClaims: archived.map(claim),
      allClaims: rows.map(claim),
      distributionCases,
      stageCounts: Object.values(CaseStage).flatMap((value) => {
        const count = stages.get(value);
        return count === undefined ? [] : [{ value, count }];
      }),
    };
  }
}
