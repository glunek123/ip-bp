import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { maxLength } from 'class-validator';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CaseStage } from '../../generated/prisma/enums';
import {
  caseKnownCourtId,
  caseListDisplay,
  caseListDisplaySelect,
} from './case-list-display-read';
import { CaseListExportInput } from './case-list-export.dto';
import { CaseListExportCapabilityDto } from './case-list-export-capability.dto';
import {
  caseListOrderBy,
  caseListSortBy,
  caseListSortDirections,
  caseListDepartmentTextWhere,
  caseListCaseTypes,
  CaseListTextQuery,
} from './case-list-query';

const maxRows = 1000;
const headings = [
  '编号',
  '阶段',
  '客户',
  '权利主体',
  '被告',
  '法院',
  '法院案号',
];
const stageLabels: Record<CaseStage, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};

type ExportFilter = CaseListTextQuery & {
  view: 'mine' | 'department';
  stage?: CaseStage;
  stageGroup?: 'COMPLAINT_PREPARATION' | 'EXECUTION_PREPARATION';
};

type ExportRow = {
  businessNo: string;
  stage: CaseStage;
  customerName: string;
  rightsHolderName: string;
  defendants: string[];
  courtName: string | null;
  courtCaseNo: string | null;
};

function csvCell(value: string | null): string {
  const original = value ?? '';
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(original)
    ? `'${original}`
    : original;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function caseListExportCsv(rows: readonly ExportRow[]): string {
  const lines = [headings.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.businessNo,
        stageLabels[row.stage],
        row.customerName,
        row.rightsHolderName,
        row.defendants.join('；'),
        row.courtName,
        row.courtCaseNo,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

@Injectable()
export class CaseListExportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async capability(actor: ActorContext): Promise<CaseListExportCapabilityDto> {
    return this.database.$transaction(
      async (tx) => {
        if (
          actor.clientCustomerId !== undefined ||
          actor.notaryOfficeId !== undefined ||
          actor.lawyerAccountId !== undefined
        )
          throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
        const account = await tx.userAccount.findUnique({
          where: { id: actor.userId },
          select: { accountType: true, active: true },
        });
        if (account?.accountType !== 'INTERNAL' || account.active !== true)
          throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
        await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
        try {
          await this.access.authorizeDepartmentAction(actor, 'case.export', tx);
          return { canExport: true };
        } catch (error) {
          if (error instanceof ForbiddenException) return { canExport: false };
          throw error;
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }

  private invalid(): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '案件列表导出条件无效',
    });
  }

  private normalize(input: CaseListExportInput): ExportFilter {
    const allowed = [
      'view',
      'stage',
      'stageGroup',
      'q',
      'customerName',
      'rightsHolderName',
      'courtCaseNo',
      'shopName',
      'defendantName',
      'courtName',
      'lawyerName',
      'caseType',
      'sortBy',
      'sortDirection',
    ];
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.includes(key)) ||
      (input.view !== undefined &&
        !['mine', 'department'].includes(input.view)) ||
      (input.stage !== undefined &&
        !Object.values(CaseStage).includes(input.stage)) ||
      (input.stageGroup !== undefined &&
        !['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'].includes(
          input.stageGroup,
        )) ||
      (input.stage !== undefined && input.stageGroup !== undefined) ||
      (input.sortBy !== undefined && !caseListSortBy.includes(input.sortBy)) ||
      (input.caseType !== undefined &&
        !caseListCaseTypes.includes(input.caseType)) ||
      (input.sortDirection !== undefined &&
        !caseListSortDirections.includes(input.sortDirection))
    )
      throw this.invalid();
    const filter: ExportFilter = {
      view: input.view ?? 'department',
      sortBy: input.sortBy ?? 'createdAt',
      sortDirection: input.sortDirection ?? 'desc',
      ...(input.stage === undefined ? {} : { stage: input.stage }),
      ...(input.caseType === undefined ? {} : { caseType: input.caseType }),
      ...(input.stageGroup === undefined
        ? {}
        : { stageGroup: input.stageGroup }),
    };
    for (const key of [
      'q',
      'customerName',
      'rightsHolderName',
      'courtCaseNo',
      'shopName',
      'defendantName',
      'courtName',
      'lawyerName',
    ] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw this.invalid();
      const trimmed = value.trim();
      if (!maxLength(trimmed, 200)) throw this.invalid();
      if (trimmed !== '') filter[key] = trimmed;
    }
    return filter;
  }

  async export(
    actor: ActorContext,
    input: CaseListExportInput,
  ): Promise<{ csv: string }> {
    const filter = this.normalize(input);
    return this.database.$transaction(
      async (tx) => {
        if (
          actor.clientCustomerId !== undefined ||
          actor.notaryOfficeId !== undefined ||
          actor.lawyerAccountId !== undefined
        )
          throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
        const account = await tx.userAccount.findUnique({
          where: { id: actor.userId },
          select: { accountType: true, active: true },
        });
        if (account?.accountType !== 'INTERNAL' || account.active !== true)
          throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
        await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
        await this.access.authorizeDepartmentAction(actor, 'case.export', tx);
        const textWhere = await caseListDepartmentTextWhere(
          tx,
          actor.departmentId,
          filter,
        );
        const where: Prisma.CaseWhereInput = {
          departmentId: actor.departmentId,
          ...(filter.view === 'mine'
            ? { responsibleUserId: actor.userId }
            : {}),
          ...textWhere,
          ...(filter.stage !== undefined
            ? { stage: filter.stage }
            : filter.stageGroup === 'COMPLAINT_PREPARATION'
              ? {
                  stage: {
                    in: [
                      'WAITING_COMPLAINT',
                      'WAITING_COMPLAINT_CONFIRMATION',
                      'WAITING_COMPLAINT_STAMP',
                    ],
                  },
                }
              : filter.stageGroup === 'EXECUTION_PREPARATION'
                ? {
                    stage: {
                      in: [
                        'WAITING_EXECUTION_DOCUMENTS',
                        'WAITING_EXECUTION_CONFIRMATION',
                        'WAITING_EXECUTION_STAMP',
                      ],
                    },
                  }
                : {}),
        };
        const rows = await tx.case.findMany({
          where,
          orderBy: caseListOrderBy(filter),
          take: maxRows + 1,
          select: {
            ...caseListDisplaySelect,
            businessNo: true,
            stage: true,
          },
        });
        if (rows.length > maxRows)
          throw new BadRequestException({
            code: 'CASE_EXPORT_LIMIT_EXCEEDED',
            message: '案件列表导出超过1000条，请缩小范围',
          });
        const courtIds = [
          ...new Set(
            rows.flatMap((row) => {
              const id = caseKnownCourtId(row);
              return id === null ? [] : [id];
            }),
          ),
        ];
        const courts =
          courtIds.length === 0
            ? []
            : await tx.filingCourt.findMany({
                where: {
                  departmentId: actor.departmentId,
                  id: { in: courtIds },
                },
                select: { id: true, name: true },
              });
        const courtById = new Map(courts.map((court) => [court.id, court]));
        const csv = caseListExportCsv(
          rows.map((row) => {
            const summary = caseListDisplay(
              row,
              courtById.get(caseKnownCourtId(row) ?? '') ?? null,
            );
            return {
              businessNo: row.businessNo,
              stage: row.stage,
              customerName: summary.customerName,
              rightsHolderName: summary.rightsHolderName,
              defendants: summary.defendants.map(({ name }) => name),
              courtName: summary.court?.name ?? null,
              courtCaseNo: summary.courtCaseNo,
            };
          }),
        );
        await tx.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            internalActorUserId: actor.userId,
            resourceType: 'case-list-export',
            resourceId: randomUUID(),
            action: 'case.list.exported',
            details: {
              filter: { ...filter },
              rowCount: rows.length,
              columnVersion: 1,
            },
          },
        });
        return { csv };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15_000,
      },
    );
  }
}
