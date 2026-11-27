import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

/**
 * 归档撤销：把案件从「已归档」退回「待归档」，回退后即可正常修改资料。
 * 归档记录与版本保留在撤销留痕里，不物理删除业务数据之外的内容。
 */
@Injectable()
export class CaseArchiveRevocationService {
  constructor(private readonly db: DatabaseService) {}

  async revoke(
    actor: ActorContext,
    caseId: string,
    reason: string,
  ): Promise<{ id: string; stage: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > 500)
      throw new BadRequestException({ code: 'REASON_INVALID' });

    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true, stage: true },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    if (found.stage !== 'ARCHIVED')
      throw new BadRequestException({ code: 'CASE_NOT_ARCHIVED' });

    const archive = await this.db.caseArchive.findFirst({
      where: { caseId },
      select: { id: true },
    });
    if (!archive)
      throw new BadRequestException({ code: 'ARCHIVE_NOT_FOUND' });

    await this.db.$executeRawUnsafe(
      'SELECT revoke_case_archive($1::uuid, $2::uuid, $3::uuid, $4)',
      caseId,
      actor.departmentId,
      actor.userId,
      trimmed,
    );
    return { id: caseId, stage: 'WAITING_ARCHIVE' };
  }
}
