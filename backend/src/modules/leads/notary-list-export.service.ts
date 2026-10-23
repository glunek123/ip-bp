import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
import { notaryDisplayFee, notaryTransferredDate } from './notary-display-read';

const exportHeader =
  '公证编号,权利主体,平台,店铺名,店铺ID,案件进展,推送日期,取证日期,发货人,发货电话,发货地址,公证费,调查费,样品费,披露费,快递公司,快递单号,公证处,公证书编号,出证日期';
const platformLabels = {
  TAOBAO: '淘宝',
  TMALL: '天猫',
  PINDUODUO: '拼多多',
  JD: '京东',
  DOUYIN: '抖音',
  ALIBABA_1688: '1688',
  XIAOHONGSHU: '小红书',
  KUAISHOU: '快手',
  XIANYU: '闲鱼',
  WECHAT: '微信',
  MEITUAN: '美团',
  DIANPING: '大众点评',
  MAP: '地图',
  OTHER: '其他',
};

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
        const holders = await tx.rightsHolder.findMany({
          where: {
            departmentId: actor.departmentId,
            id: { in: [...new Set(rows.map((row) => row.rightsHolderId))] },
          },
          select: { id: true, name: true },
        });
        const holderNames = new Map(
          holders.map((holder) => [holder.id, holder.name]),
        );
        const csv =
          '\uFEFF' +
          [
            exportHeader,
            ...rows.map((row) => {
              const holderName = holderNames.get(row.rightsHolderId);
              if (holderName === undefined || !holderName.trim()) {
                throw new InternalServerErrorException({
                  code: 'INTERNAL_ERROR',
                  message: '公证事项来源数据不完整',
                });
              }
              const evidence = row.evidenceCorrections[0] ?? row.evidence;
              const sender = row.openingSenderCorrections[0] ?? row.opening;
              const logistics = evidence?.logistics ?? [];
              const fee = (category: string) =>
                notaryDisplayFee(
                  row.certificate?.fees.find(
                    (item) => item.category === category,
                  ),
                ).amount ?? '';
              return [
                row.businessNo,
                holderName,
                platformLabels[row.sourceLead.platform],
                row.sourceLead.shopName,
                row.sourceLead.shopExternalId ?? '',
                stageLabels[row.stage],
                row.sourceLead.pushedAt === null
                  ? ''
                  : notaryTransferredDate(row.sourceLead.pushedAt),
                evidence?.evidenceAt.toISOString().slice(0, 10) ?? '',
                sender?.senderName ?? '',
                sender?.senderPhone ?? '',
                sender?.senderAddress ?? '',
                fee('NOTARY'),
                fee('INVESTIGATION'),
                notaryDisplayFee(
                  row.evidence === null
                    ? null
                    : {
                        state: row.evidence.sampleFeeState,
                        amount: row.evidence.sampleFeeAmount,
                      },
                ).amount ?? '',
                fee('DISCLOSURE'),
                logistics.map((item) => item.companyValue ?? '').join('\n'),
                logistics.map((item) => item.trackingValue ?? '').join('\n'),
                row.notaryOffice.name,
                row.certificate?.certificateNo ?? '',
                row.certificate?.certificateDate.toISOString().slice(0, 10) ??
                  '',
              ]
                .map(csvCell)
                .join(',');
            }),
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
        rightsHolderId: true,
        sourceLead: {
          select: {
            businessNo: true,
            platform: true,
            shopName: true,
            shopExternalId: true,
            pushedAt: true,
          },
        },
        evidence: { include: { logistics: { orderBy: { position: 'asc' } } } },
        evidenceCorrections: {
          orderBy: { revision: 'desc' },
          take: 1,
          include: { logistics: { orderBy: { position: 'asc' } } },
        },
        opening: {
          select: { senderName: true, senderPhone: true, senderAddress: true },
        },
        openingSenderCorrections: {
          orderBy: { revision: 'desc' },
          take: 1,
          select: { senderName: true, senderPhone: true, senderAddress: true },
        },
        certificate: {
          select: {
            certificateNo: true,
            certificateDate: true,
            fees: {
              where: {
                category: { in: ['NOTARY', 'INVESTIGATION', 'DISCLOSURE'] },
              },
              select: { category: true, state: true, amount: true },
            },
          },
        },
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
