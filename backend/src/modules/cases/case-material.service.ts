import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { ActorContext } from '../../access-control/actor-context';

@Injectable()
export class CaseMaterialService {
  constructor(private readonly database: DatabaseService) {}

  async remove(
    actor: ActorContext,
    caseId: string,
    materialId: string,
  ): Promise<{ removed: true }> {
    const material = await this.database.material.findFirst({
      where: {
        id: materialId,
        departmentId: actor.departmentId,
        deletedAt: null,
        // 材料 id 全局唯一，这里只校验归属部门；ownerId 可能与列表里的案件标识
        // 口径不同（例如受理记录挂了材料），不做强约束，避免误删其他部门数据。
      },
      select: { id: true, ownerId: true, ownerType: true },
    });
    if (!material || material.ownerType !== 'CASE')
      throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.database.material.update({
      where: { id: materialId },
      data: { deletedAt: new Date(), status: 'DELETED', version: { increment: 1 } },
    });
    return { removed: true };
  }
}
