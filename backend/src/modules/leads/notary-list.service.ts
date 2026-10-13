import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { NOTARY_LIST_STAGES, NotaryListStage } from './notary-list.dto';
import {
  NOTARY_DISPLAY_CERTIFICATE_SELECT,
  NOTARY_DISPLAY_LEAD_SELECT,
  notaryDisplayCapabilities,
  readNotaryDisplay,
} from './notary-display-read';

@Injectable()
export class NotaryListService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    stage?: NotaryListStage,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active !== true)
      throw this.forbidden();

    let leadScope: Prisma.LeadWhereInput;
    try {
      leadScope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
    const baseWhere: Prisma.NotaryMatterWhereInput = {
      departmentId: actor.departmentId,
      sourceLead: leadScope,
    };
    const itemWhere: Prisma.NotaryMatterWhereInput =
      stage === undefined ? baseWhere : { ...baseWhere, stage };
    const [items, total, groups] = await Promise.all([
      this.database.notaryMatter.findMany({
        where: itemWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          stage: true,
          createdAt: true,
          departmentId: true,
          customerId: true,
          rightsHolderId: true,
          evidenceMode: true,
          evidence: {
            select: {
              evidenceAt: true,
              sampleFeeState: true,
              sampleFeeAmount: true,
            },
          },
          opening: {
            select: {
              senderName: true,
              senderPhone: true,
              senderAddress: true,
            },
          },
          openingReviewDecision: {
            select: { result: true, reason: true, archivedAt: true },
          },
          issuanceDecision: { select: { decision: true } },
          certificate: { select: NOTARY_DISPLAY_CERTIFICATE_SELECT },
          sourceLead: { select: NOTARY_DISPLAY_LEAD_SELECT },
          notaryOffice: { select: { id: true, name: true } },
        },
      }),
      this.database.notaryMatter.count({ where: itemWhere }),
      this.database.notaryMatter.groupBy({
        by: ['stage'],
        where: baseWhere,
        orderBy: { stage: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(
      NOTARY_LIST_STAGES.map((key) => [key, 0]),
    ) as Record<NotaryListStage, number>;
    for (const group of groups) {
      const listedStage = NOTARY_LIST_STAGES.find(
        (stage) => stage === group.stage,
      );
      if (listedStage !== undefined) counts[listedStage] = group._count._all;
    }
    return {
      items: await Promise.all(
        items.map(async (item) => ({
          id: item.id,
          businessNo: item.businessNo,
          stage: item.stage,
          sourceLead: {
            id: item.sourceLead.id,
            businessNo: item.sourceLead.businessNo,
          },
          notaryOffice: item.notaryOffice,
          createdAt: item.createdAt.toISOString(),
          ...(await readNotaryDisplay(this.database, this.access, actor, item)),
          capabilities: await notaryDisplayCapabilities(
            this.access,
            actor,
            item,
          ),
        })),
      ),
      total,
      page,
      pageSize,
      counts,
    };
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权执行该操作',
    });
  }
}
