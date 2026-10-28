import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { RoutineBusinessEditDto } from '../../common/routine-business-edit.dto';
import {
  applyRoutineProducts,
  corruptRoutineSource,
  isRoutineSerializationConflict,
  parseRoutineProducts,
  type RoutineProduct,
} from '../../common/routine-business-product';

/** Ordinary display values never update the source snapshot or material links. */
@Injectable()
export class NotaryRoutineEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async update(
    actor: ActorContext,
    matterId: string,
    input: RoutineBusinessEditDto,
  ) {
    const dto = plainToInstance(RoutineBusinessEditDto, input);
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length > 0
    )
      throw this.invalid();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            if (
              actor.clientCustomerId ||
              actor.notaryOfficeId ||
              actor.lawyerAccountId
            )
              throw this.forbidden();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            const scope = await this.access.buildLeadScope(
              actor,
              'lead.read',
              tx,
            );
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              matterId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const matter = await tx.notaryMatter.findFirst({
              where: {
                id: matterId,
                departmentId: actor.departmentId,
                sourceLead: scope,
              },
              select: {
                id: true,
                sourceSnapshot: true,
                selectedProducts: { select: { leadProductId: true } },
                sourceLead: {
                  select: { shopName: true, shopExternalId: true },
                },
                routineProfile: true,
              },
            });
            if (!matter) throw this.notFound();
            const revision = matter.routineProfile?.revision ?? 0;
            if (revision !== dto.expectedRevision) throw this.conflict();
            const frozen = this.sourceProducts(
              matter.sourceSnapshot,
              matter.selectedProducts.map((item) => item.leadProductId),
            );
            const products = matter.routineProfile
              ? parseRoutineProducts(
                  matter.routineProfile.products,
                  frozen.map((p) => p.id),
                )
              : frozen;
            const shopName = dto.shopName.trim();
            if (!shopName) throw this.invalid();
            const next = applyRoutineProducts(products, dto.products);
            const before = {
              shopName:
                matter.routineProfile?.shopName ?? matter.sourceLead.shopName,
              shopExternalId: matter.routineProfile
                ? matter.routineProfile.shopExternalId
                : matter.sourceLead.shopExternalId,
              products,
            };
            const after = {
              shopName,
              shopExternalId: before.shopExternalId,
              products: next,
            };
            const data = {
              shopName,
              shopExternalId: before.shopExternalId,
              products: next as Prisma.InputJsonArray,
            };
            if (!matter.routineProfile) {
              await tx.notaryRoutineProfile.create({
                data: { matterId, departmentId: actor.departmentId, ...data },
              });
            } else {
              const updated = await tx.notaryRoutineProfile.updateMany({
                where: { matterId, departmentId: actor.departmentId, revision },
                data: { ...data, revision: { increment: 1 } },
              });
              if (updated.count !== 1) throw this.conflict();
            }
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'notary_matter',
                resourceId: matterId,
                action: 'notary.routine.updated',
                details: {
                  fromRevision: revision,
                  toRevision: revision + 1,
                  before,
                  after,
                },
              },
            });
            return { revision: revision + 1, ...after };
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!isRoutineSerializationConflict(error)) throw error;
        if (attempt === 2) throw this.conflict();
      }
    }
    throw this.conflict();
  }

  private sourceProducts(
    snapshot: Prisma.JsonValue,
    ids: string[],
  ): RoutineProduct[] {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
      throw corruptRoutineSource();
    return parseRoutineProducts(snapshot.selectedProducts, ids);
  }

  private invalid() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '资料不符合要求',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权编辑资料',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'NOT_FOUND',
      message: '记录不存在或不可访问',
    });
  }
  private conflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '资料已更新，请刷新后重试',
    });
  }
}
