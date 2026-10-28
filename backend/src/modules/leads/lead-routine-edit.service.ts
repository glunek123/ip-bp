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

@Injectable()
export class LeadRoutineEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async update(
    actor: ActorContext,
    leadId: string,
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
            const scope = await this.access.buildLeadScope(
              actor,
              'lead.read',
              tx,
            );
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              leadId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const lead = await tx.lead.findFirst({
              where: { id: leadId, ...scope },
              select: {
                id: true,
                version: true,
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
            });
            if (!lead) throw this.notFound();
            if (lead.version !== dto.expectedRevision) throw this.conflict();
            const products = lead.products.map((p) => ({
              ...p,
              unitPrice: p.unitPrice.toFixed(2),
              estimatedAmount: p.estimatedAmount.toFixed(2),
            }));
            const shopName = dto.shopName.trim();
            if (!shopName) throw this.invalid();
            const next = applyRoutineProducts(products, dto.products);
            const remark = dto.remark?.trim() || null;
            const [matters, cases] = await Promise.all([
              tx.notaryMatter.findMany({
                where: {
                  departmentId: actor.departmentId,
                  sourceLeadId: leadId,
                },
                select: {
                  id: true,
                  sourceSnapshot: true,
                  selectedProducts: { select: { leadProductId: true } },
                },
              }),
              tx.case.findMany({
                where: {
                  departmentId: actor.departmentId,
                  sourceLeadId: leadId,
                },
                select: { id: true },
              }),
            ]);
            const notaryProfiles = matters.map((matter) => {
              const snapshot = matter.sourceSnapshot;
              if (
                !snapshot ||
                typeof snapshot !== 'object' ||
                Array.isArray(snapshot)
              )
                throw corruptRoutineSource();
              const selected = parseRoutineProducts(
                snapshot.selectedProducts,
                matter.selectedProducts.map((item) => item.leadProductId),
              );
              return {
                matterId: matter.id,
                departmentId: actor.departmentId,
                shopName: lead.shopName,
                shopExternalId: lead.shopExternalId,
                products: selected as Prisma.InputJsonArray,
              };
            });
            if (notaryProfiles.length)
              await tx.notaryRoutineProfile.createMany({
                data: notaryProfiles,
                skipDuplicates: true,
              });
            if (cases.length)
              await tx.caseRoutineProfile.createMany({
                data: cases.map((item) => ({
                  caseId: item.id,
                  departmentId: actor.departmentId,
                  shopName: lead.shopName,
                  shopExternalId: lead.shopExternalId,
                  remark: lead.remark,
                  products: products as Prisma.InputJsonArray,
                })),
                skipDuplicates: true,
              });
            const changed = await tx.lead.updateMany({
              where: {
                id: leadId,
                departmentId: actor.departmentId,
                version: dto.expectedRevision,
              },
              data: { shopName, remark, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.conflict();
            for (const product of next)
              await tx.leadProduct.update({
                where: { id: product.id },
                data: {
                  title: product.title,
                  url: product.url,
                  quantity: product.quantity,
                  unitPrice: product.unitPrice,
                  estimatedAmount: product.estimatedAmount,
                },
              });
            const before = {
              shopName: lead.shopName,
              remark: lead.remark,
              products,
            };
            const after = { shopName, remark, products: next };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: leadId,
                action: 'lead.routine.updated',
                details: {
                  fromVersion: lead.version,
                  toVersion: lead.version + 1,
                  before,
                  after,
                },
              },
            });
            return { revision: lead.version + 1, ...after };
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
