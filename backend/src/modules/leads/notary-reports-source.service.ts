import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AccessControlService,
  ReportView,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class NotaryReportsSourceService {
  constructor(private readonly access: AccessControlService) {}

  // The report composer must supply its existing RepeatableRead transaction.
  // This helper cannot open another snapshot or infer a domain right from cases.
  private async scope(
    actor: ActorContext,
    view: ReportView,
    reader: Prisma.TransactionClient,
  ): Promise<Prisma.NotaryMatterWhereInput> {
    let where: Prisma.NotaryMatterWhereInput;
    try {
      await this.access.buildReportScope(actor, view, 'export', reader);
      if (view === 'department') {
        await this.access.authorizeDepartmentAction(actor, 'lead.read', reader);
        where = {
          departmentId: actor.departmentId,
          stage: { not: 'ARCHIVED' },
          sourceLead: { departmentId: actor.departmentId },
        };
      } else {
        const readScope = await this.access.buildLeadScope(
          actor,
          'lead.read',
          reader,
        );
        where = {
          departmentId: actor.departmentId,
          stage: { not: 'ARCHIVED' },
          sourceLead: {
            AND: [
              readScope,
              {
                departmentId: actor.departmentId,
                responsibleUserId: actor.userId,
              },
            ],
          },
        };
      }
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new ForbiddenException({
          code: 'ACTION_FORBIDDEN',
          message: '无权导出当前范围的公证统计',
        });
      throw error;
    }
    return where;
  }

  async assertExportable(
    actor: ActorContext,
    view: ReportView,
    reader: Prisma.TransactionClient,
  ): Promise<void> {
    await this.scope(actor, view, reader);
  }

  async count(
    actor: ActorContext,
    view: ReportView,
    reader: Prisma.TransactionClient,
  ): Promise<number> {
    const where = await this.scope(actor, view, reader);
    const total = await reader.notaryMatter.count({ where });
    if (!Number.isSafeInteger(total) || total < 0)
      throw new InternalServerErrorException({
        code: 'REPORT_SOURCE_INVALID',
        message: '报表来源数据不完整',
      });
    return total;
  }
}
