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
        ownerType: 'CASE',
        ownerId: caseId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!material) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.database.material.update({
      where: { id: materialId },
      data: { deletedAt: new Date(), status: 'DELETED', version: { increment: 1 } },
    });
    return { removed: true };
  }
}
