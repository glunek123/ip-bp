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
      select: { id: true },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
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
}
