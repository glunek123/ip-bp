import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  GenerateNotaryListExportDto,
  isValidExportScope,
  NOTARY_LIST_EXPORT_MAX_ROWS,
  PreviewNotaryListExportDto,
} from './notary-list-export.dto';
import { NotaryListStage } from './notary-list.dto';

const stageLabels: Record<NotaryListStage, string> = {
  PENDING_EVIDENCE: '待取证',
  WAITING_UNBOX: '待取件开箱',
  UNBOX_REVIEW: '开箱待审核',
  ISSUANCE_DECISION: '开箱待确认',
  WAITING_CERTIFICATE: '待出证',
  WAITING_RETURN: '待退货',
  ARCHIVED: '已归档',
};

function csvCell(value: string): string {
  const safe = value.replace(/^(\s*)(?=[=+\-@])/u, "$1'");
  return /[,"\r\n]/u.test(safe) || safe !== value
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

@Injectable()
export class NotaryListExportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async preview(actor: ActorContext, input: PreviewNotaryListExportDto) {
    const scope = this.validate(input, false);
    return this.database.$transaction(
      async (tx) => {
        const rows = await this.findAuthorizedRows(tx, actor, scope);
        this.requirePreviewRows(rows.length);
        return { count: rows.length, maxRows: NOTARY_LIST_EXPORT_MAX_ROWS };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async export(actor: ActorContext, input: GenerateNotaryListExportDto) {
    const scope = this.validate(input, true);
    return this.database.$transaction(
      async (tx) => {
        const rows = await this.findAuthorizedRows(tx, actor, scope);
        if (rows.length !== input.expectedCount) {
          throw new ConflictException({
            code: 'EXPORT_SCOPE_CHANGED',
            message: '导出范围已变化，请重新预览',
          });
        }
        const csv =
          '\uFEFF' +
          [
            '公证事项编号,阶段,来源线索编号,公证处,创建时间',
            ...rows.map((row) =>
              [
                row.businessNo,
                stageLabels[row.stage],
                row.sourceLead.businessNo,
                row.notaryOffice.name,
                row.createdAt.toISOString(),
              ]
                .map(csvCell)
                .join(','),
            ),
          ].join('\r\n') +
          '\r\n';
        const details =
          scope.mode === 'SELECTED'
            ? {
                mode: scope.mode,
                matterIds: scope.matterIds,
                actualIds: rows.map((row) => row.id),
                count: rows.length,
              }
            : {
                mode: scope.mode,
                ...(scope.stage === undefined ? {} : { stage: scope.stage }),
                actualIds: rows.map((row) => row.id),
                count: rows.length,
              };
        await tx.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            internalActorUserId: actor.userId,
            resourceType: 'notary-list-export',
            resourceId: randomUUID(),
            action: 'notary.list.export.generated',
            details,
          },
        });
        return { csv };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private validate<T extends PreviewNotaryListExportDto>(
    input: T,
    expectedCount: boolean,
  ): T {
    if (!isValidExportScope(input, expectedCount)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '导出范围参数无效',
      });
    }
    return input;
  }

  private async findAuthorizedRows(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    scope: PreviewNotaryListExportDto,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active !== true)
      throw this.forbidden();
    let readScope: Prisma.LeadWhereInput;
    let exportScope: Prisma.LeadWhereInput;
    try {
      readScope = await this.access.buildLeadScope(actor, 'lead.read', tx);
      exportScope = await this.access.buildLeadScope(
        actor,
        'notary.list.export',
        tx,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
    const where: Prisma.NotaryMatterWhereInput = {
      departmentId: actor.departmentId,
      AND: [{ sourceLead: readScope }, { sourceLead: exportScope }],
      ...(scope.mode === 'SELECTED' ? { id: { in: scope.matterIds } } : {}),
      ...(scope.mode === 'FILTERED' && scope.stage !== undefined
        ? { stage: scope.stage }
        : {}),
    };
    const rows = await tx.notaryMatter.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: NOTARY_LIST_EXPORT_MAX_ROWS + 1,
      select: {
        id: true,
        businessNo: true,
        stage: true,
        createdAt: true,
        sourceLead: { select: { businessNo: true } },
        notaryOffice: { select: { name: true } },
      },
    });
    if (scope.mode === 'SELECTED' && rows.length !== scope.matterIds?.length)
      throw this.forbidden();
    return rows;
  }

  private requirePreviewRows(count: number): void {
    if (count === 0)
      throw new BadRequestException({
        code: 'EXPORT_EMPTY',
        message: '范围内没有可导出事项',
      });
    if (count > NOTARY_LIST_EXPORT_MAX_ROWS)
      throw new BadRequestException({
        code: 'EXPORT_LIMIT_EXCEEDED',
        message: '导出超过1000条，请缩小范围',
      });
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权导出公证办理清单',
    });
  }
}
