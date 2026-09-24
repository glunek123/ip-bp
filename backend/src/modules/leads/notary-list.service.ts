import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { NOTARY_LIST_STAGES, NotaryListStage } from './notary-list.dto';

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
    if (actor.clientCustomerId !== undefined) throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active === false)
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
          sourceLead: { select: { id: true, businessNo: true } },
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
    for (const group of groups) counts[group.stage] = group._count._all;
    return {
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
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
