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
import { RoutineBusinessEditWithRemarkDto } from '../../common/routine-business-edit.dto';
import {
  applyRoutineProducts,
  corruptRoutineSource,
  isRoutineSerializationConflict,
  parseRoutineProducts,
} from '../../common/routine-business-product';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

const caseRoutineSelect = {
  id: true,
  responsibleUserId: true,
  routineProfile: true,
  sourceLead: {
    select: {
      shopName: true,
      shopExternalId: true,
      remark: true,
      products: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          title: true,
          url: true,
          quantity: true,
          unitPrice: true,
          commentCount: true,
          estimatedAmount: true,
        },
      },
    },
  },
  externalEntry: { select: { known: true } },
} satisfies Prisma.CaseSelect;
type RoutineRecord = Prisma.CaseGetPayload<{
  select: typeof caseRoutineSelect;
}>;

function currentRoutine(item: RoutineRecord) {
  const leadProducts = (item.sourceLead?.products ?? []).map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toFixed(2),
    estimatedAmount: p.estimatedAmount.toFixed(2),
  }));
  const sourceIds = new Set(leadProducts.map((p) => p.id));
  let products = leadProducts;
  if (item.routineProfile) {
    const raw = item.routineProfile.products;
    if (!Array.isArray(raw)) throw corruptRoutineSource();
    const ids = raw.map((product) => {
      if (
        !product ||
        typeof product !== 'object' ||
        Array.isArray(product) ||
        typeof product.id !== 'string' ||
        !sourceIds.has(product.id)
      )
        throw corruptRoutineSource();
      return product.id;
    });
    products = parseRoutineProducts(raw, ids);
  }
  const known = item.externalEntry?.known;
  const external =
    known && typeof known === 'object' && !Array.isArray(known) ? known : null;
  return {
    shopName: item.routineProfile
      ? item.routineProfile.shopName
      : (item.sourceLead?.shopName ??
        (typeof external?.shopName === 'string' ? external.shopName : null)),
    shopExternalId: item.routineProfile
      ? item.routineProfile.shopExternalId
      : (item.sourceLead?.shopExternalId ??
        (typeof external?.shopExternalId === 'string'
          ? external.shopExternalId
          : null)),
    remark: item.routineProfile
      ? item.routineProfile.remark
      : (item.sourceLead?.remark ?? null),
    products,
  };
}

@Injectable()
export class CaseRoutineEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  private async canEditAnotherOwner(
    actor: ActorContext,
    reader: Prisma.TransactionClient,
  ): Promise<boolean> {
    try {
      await this.access.authorizeDepartmentProxyAction(
        actor,
        'case.routine.edit',
        { departmentId: actor.departmentId },
        reader,
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  async get(actor: ActorContext, caseId: string) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw this.forbidden();
    return this.database.$transaction(
      async (tx) => {
        const account = await tx.userAccount.findUnique({
          where: { id: actor.userId },
          select: { accountType: true, active: true },
        });
        if (account?.accountType !== 'INTERNAL' || !account.active)
          throw this.forbidden();
        await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
        const item = await tx.case.findFirst({
          where: { id: caseId, departmentId: actor.departmentId },
          select: caseRoutineSelect,
        });
        if (!item) throw this.notFound();
        return {
          revision: item.routineProfile?.revision ?? 0,
          canEdit:
            item.responsibleUserId === actor.userId ||
            (await this.canEditAnotherOwner(actor, tx)),
          ...currentRoutine(item),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async update(
    actor: ActorContext,
    caseId: string,
    input: RoutineBusinessEditWithRemarkDto,
  ) {
    const dto = plainToInstance(RoutineBusinessEditWithRemarkDto, input);
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
            await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const item = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              select: caseRoutineSelect,
            });
            if (!item) throw this.notFound();
            if (item.responsibleUserId !== actor.userId) {
              await this.access.authorizeDepartmentProxyAction(
                actor,
                'case.routine.edit',
                { departmentId: actor.departmentId },
                tx,
              );
            }
            const revision = item.routineProfile?.revision ?? 0;
            if (revision !== dto.expectedRevision) throw this.conflict();
            const before = currentRoutine(item);
            const shopName = dto.shopName.trim();
            if (!shopName) throw this.invalid();
            const next = applyRoutineProducts(before.products, dto.products);
            const remark = dto.remark?.trim() || null;
            const after = {
              shopName,
              shopExternalId: before.shopExternalId,
              remark,
              products: next,
            };
            const data = {
              shopName,
              shopExternalId: before.shopExternalId,
              remark,
              products: next as Prisma.InputJsonArray,
            };
            if (!item.routineProfile)
              await tx.caseRoutineProfile.create({
                data: { caseId, departmentId: actor.departmentId, ...data },
              });
            else {
              const updated = await tx.caseRoutineProfile.updateMany({
                where: { caseId, departmentId: actor.departmentId, revision },
                data: { ...data, revision: { increment: 1 } },
              });
              if (updated.count !== 1) throw this.conflict();
            }
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.routine.updated',
                details: {
                  fromRevision: revision,
                  toRevision: revision + 1,
                  before,
                  after,
                  ...(item.responsibleUserId === actor.userId
                    ? {}
                    : {
                        proxyAuthorization: {
                          responsibleUserId: item.responsibleUserId,
                          action: 'case.routine.edit',
                          scope: 'DEPARTMENT',
                        },
                      }),
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
