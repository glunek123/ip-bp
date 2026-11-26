import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

/**
 * 删除仅用于纠正误创建的案子：
 * 只要该案件已产生任何费用、付款、退费或结算记录，就由外键拦截并拒绝。
 */
@Injectable()
export class CaseDeleteService {
  constructor(private readonly db: DatabaseService) {}

  async remove(actor: ActorContext, caseId: string): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true, externalEntry: { select: { id: true } } },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    // 历史迁移案件带着成串的关联记录，按来源入口整体清理后再删主记录
    if (found.externalEntry !== null) {
      await this.removeLegacyCase(caseId);
      return { id: caseId };
    }
    try {
      await this.db.case.delete({
        where: { id: caseId, departmentId: actor.departmentId },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2003')
        throw new BadRequestException({
          code: 'CASE_HAS_RECORDS',
          message: '该案件已产生费用或关联数据，不能删除。',
        });
      if (code === 'P2025')
        throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
      throw error;
    }
    return { id: caseId };
  }

  /** 删除历史迁移案件：按 case_id 清理所有子表、审计与别名，再删主记录。 */
  private async removeLegacyCase(caseId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const tables = await tx.$queryRaw<{ table_name: string }[]>`
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.column_name = 'case_id'
          AND c.table_schema = 'public'
          AND c.table_name <> 'cases'
          AND t.table_type = 'BASE TABLE'
      `;
      for (const { table_name: table } of tables) {
        await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE case_id::text = $1`,
          caseId,
        );
      }
      await tx.$executeRawUnsafe(
        'DELETE FROM audit_events WHERE resource_id::text = $1',
        caseId,
      );
      await tx.$executeRawUnsafe(
        'DELETE FROM business_number_aliases WHERE entity_id::text = $1',
        caseId,
      );
      await tx.case.delete({ where: { id: caseId } });
    });
  }
}
