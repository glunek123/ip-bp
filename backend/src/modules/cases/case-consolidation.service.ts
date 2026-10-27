import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import type {
  CreateCaseConsolidationDto,
  PreviewCaseConsolidationDto,
  CaseConsolidationResultDto,
} from './case-consolidation.dto';

const failure = (code: string, message: string) => {
  const body = { code, message };
  if (code === 'VALIDATION_ERROR') return new BadRequestException(body);
  if (code === 'ACTION_FORBIDDEN') return new ForbiddenException(body);
  if (code === 'CASE_NOT_FOUND') return new NotFoundException(body);
  return new ConflictException(body);
};

type MemberInput = PreviewCaseConsolidationDto['members'][number];
type Source = Awaited<
  ReturnType<CaseConsolidationService['readSources']>
>[number];

@Injectable()
export class CaseConsolidationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  private normalize(input: PreviewCaseConsolidationDto) {
    if (
      !input ||
      !Array.isArray(input.members) ||
      input.members.length < 2 ||
      input.members.length > 20
    )
      throw failure('VALIDATION_ERROR', '请选择2至20个案件');
    const members = input.members.map((member) => {
      if (!member || typeof member !== 'object')
        throw failure('VALIDATION_ERROR', '请逐案确认完整被告身份和版本');
      const defendant = member.defendant;
      if (!defendant)
        throw failure('VALIDATION_ERROR', '请逐案确认完整被告身份和版本');
      const name = typeof defendant.name === 'string' ? defendant.name : '';
      const idNo = typeof defendant.idNo === 'string' ? defendant.idNo : '';
      const checks = [
        member.confirmed !== true,
        !Number.isInteger(member.expectedVersion),
        member.expectedVersion < 1,
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          member.caseId,
        ),
        !['PERSON', 'ORGANIZATION'].includes(defendant.kind),
        !name.trim(),
        name !== name.trim(),
        name.length > 200,
        !idNo.trim(),
        idNo !== idNo.trim(),
        idNo.length > 100,
      ];
      const invalid = checks.some(Boolean);
      if (invalid)
        throw failure('VALIDATION_ERROR', '请逐案确认完整被告身份和版本');
      return {
        caseId: member.caseId.toLowerCase(),
        expectedVersion: member.expectedVersion,
        confirmed: true as const,
        defendant: {
          kind: defendant.kind,
          name,
          idNo,
        },
      };
    });
    if (new Set(members.map((member) => member.caseId)).size !== members.length)
      throw failure('VALIDATION_ERROR', '不能重复选择案件');
    const identity = JSON.stringify(members[0].defendant);
    if (members.some((member) => JSON.stringify(member.defendant) !== identity))
      throw failure('VALIDATION_ERROR', '参与案件的被告身份必须一致');
    const mainCaseId =
      typeof input.mainCaseId === 'string'
        ? input.mainCaseId.toLowerCase()
        : input.mainCaseId;
    if (mainCaseId && !members.some((member) => member.caseId === mainCaseId))
      throw failure('VALIDATION_ERROR', '主案必须在参与案件中');
    return {
      members: members.sort((a, b) => a.caseId.localeCompare(b.caseId)),
      mainCaseId,
    };
  }

  private async assertActor(actor: ActorContext, tx: Prisma.TransactionClient) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw failure('ACTION_FORBIDDEN', '仅当前部门内部办理人可合案');
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw failure('ACTION_FORBIDDEN', '仅当前部门内部办理人可合案');
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw failure('ACTION_FORBIDDEN', '无权读取本部门案件');
      throw error;
    }
  }

  private async readSources(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    ids: string[],
  ) {
    const rows = await tx.case.findMany({
      where: { id: { in: ids }, departmentId: actor.departmentId },
      select: {
        id: true,
        businessNo: true,
        createdAt: true,
        customerId: true,
        rightsHolderId: true,
        departmentId: true,
        responsibleUserId: true,
        stage: true,
        version: true,
        responsibleMembership: { select: { teamId: true } },
        consolidationMembership: { select: { consolidationId: true } },
        consolidationAsMain: { select: { id: true } },
        defendants: { select: { kind: true, name: true, idNo: true } },
        sourceLead: {
          select: {
            id: true,
            platform: true,
            shopName: true,
            shopExternalId: true,
          },
        },
        externalEntry: { select: { known: true } },
      },
    });
    if (rows.length !== ids.length)
      throw failure('CASE_NOT_FOUND', '参与案件不存在或不在当前部门');
    return rows;
  }

  private shop(source: Source) {
    if (source.sourceLead)
      return {
        platform: source.sourceLead.platform,
        externalId: source.sourceLead.shopExternalId?.trim() ?? '',
        name: source.sourceLead.shopName,
      };
    const known = source.externalEntry?.known;
    if (!known || typeof known !== 'object' || Array.isArray(known))
      throw failure('SOURCE_CONFLICT', '案件缺少可核对的店铺来源');
    return {
      platform: typeof known.platform === 'string' ? known.platform : '',
      externalId:
        typeof known.shopExternalId === 'string'
          ? known.shopExternalId.trim()
          : '',
      name: typeof known.shopName === 'string' ? known.shopName : '',
    };
  }

  private async validateSources(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    members: MemberInput[],
    sources: Source[],
  ) {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const first = sources[0];
    const firstShop = this.shop(first);
    if (!firstShop.platform || !firstShop.externalId)
      throw failure('SOURCE_CONFLICT', '请先补齐可核对的平台和店铺ID');
    for (const member of members) {
      const source = byId.get(member.caseId)!;
      if (
        source.stage !== 'PENDING_MATCH' ||
        source.consolidationMembership ||
        source.consolidationAsMain
      )
        throw failure('INVALID_STATE', '参与案件不在待匹配阶段或已合案');
      if (source.version !== member.expectedVersion)
        throw failure('VERSION_CONFLICT', '参与案件版本已变化，请重新预览');
      if (
        source.customerId !== first.customerId ||
        source.rightsHolderId !== first.rightsHolderId
      )
        throw failure('SOURCE_CONFLICT', '客户或权利主体不一致');
      const shop = this.shop(source);
      if (
        shop.platform !== firstShop.platform ||
        shop.externalId !== firstShop.externalId
      )
        throw failure(
          'SOURCE_CONFLICT',
          '平台或店铺ID不一致，不能仅凭店铺名称合案',
        );
      if (
        source.defendants.some(
          (party) =>
            party.kind !== member.defendant.kind ||
            party.name !== member.defendant.name ||
            party.idNo !== member.defendant.idNo,
        )
      )
        throw failure('SOURCE_CONFLICT', '既有被告与逐案确认身份冲突');
      if (source.defendants.length > 1)
        throw failure(
          'SOURCE_CONFLICT',
          '多名既有被告需要先核实，不能自动覆盖',
        );
      if (source.responsibleUserId !== actor.userId)
        throw failure('ACTION_FORBIDDEN', '只能合并本人办理的案件');
      try {
        await this.access.authorizeCase(
          actor,
          'case.consolidate',
          {
            departmentId: source.departmentId,
            responsibleUserId: source.responsibleUserId,
            ...(source.responsibleMembership.teamId
              ? { teamId: source.responsibleMembership.teamId }
              : {}),
          },
          tx,
        );
      } catch (error) {
        if (error instanceof ForbiddenException)
          throw failure('ACTION_FORBIDDEN', '缺少合并起诉权限');
        throw error;
      }
    }
    return firstShop;
  }

  async preview(actor: ActorContext, input: PreviewCaseConsolidationDto) {
    const normalized = this.normalize(input);
    return this.database.$transaction(async (tx) => {
      await this.assertActor(actor, tx);
      const sources = await this.readSources(
        tx,
        actor,
        normalized.members.map((member) => member.caseId),
      );
      const shop = await this.validateSources(
        tx,
        actor,
        normalized.members,
        sources,
      );
      const ordered = sources.sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
      const main =
        ordered.find((source) => source.id === normalized.mainCaseId) ??
        ordered[0];
      return {
        mainCaseId: main.id,
        mainBusinessNo: main.businessNo,
        caseCount: ordered.length,
        shop,
        cases: ordered.map((source) => ({
          id: source.id,
          businessNo: source.businessNo,
          version: source.version,
          createdAt: source.createdAt.toISOString(),
          isMain: source.id === main.id,
        })),
      };
    });
  }

  async create(
    actor: ActorContext,
    input: CreateCaseConsolidationDto,
  ): Promise<CaseConsolidationResultDto> {
    const normalized = this.normalize(input);
    if (
      !normalized.mainCaseId ||
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim() ||
      input.idempotencyKey !== input.idempotencyKey.trim() ||
      input.idempotencyKey.length > 128
    )
      throw failure('VALIDATION_ERROR', '请先固定主案并提供提交键');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await this.assertActor(actor, tx);
            const ids = normalized.members.map((member) => member.caseId);
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id" = ANY($1::uuid[]) AND "department_id" = $2::uuid ORDER BY "id" FOR UPDATE',
              ids,
              actor.departmentId,
            );
            if (locked.length !== ids.length)
              throw failure('CASE_NOT_FOUND', '参与案件不存在或不在当前部门');
            const sources = await this.readSources(tx, actor, ids);
            for (const source of sources) {
              if (source.responsibleUserId !== actor.userId)
                throw failure('ACTION_FORBIDDEN', '只能合并本人办理的案件');
              try {
                await this.access.authorizeCase(
                  actor,
                  'case.consolidate',
                  {
                    departmentId: source.departmentId,
                    responsibleUserId: source.responsibleUserId,
                    ...(source.responsibleMembership.teamId
                      ? { teamId: source.responsibleMembership.teamId }
                      : {}),
                  },
                  tx,
                );
              } catch (error) {
                if (error instanceof ForbiddenException)
                  throw failure('ACTION_FORBIDDEN', '缺少合并起诉权限');
                throw error;
              }
            }
            const prior = await tx.caseConsolidationReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            if (prior) {
              if (prior.requestFingerprint !== fingerprint)
                throw failure(
                  'IDEMPOTENCY_CONFLICT',
                  '提交键已用于不同合案请求',
                );
              return prior.resultSnapshot as unknown as CaseConsolidationResultDto;
            }
            await this.validateSources(tx, actor, normalized.members, sources);
            const main = sources.find(
              (source) => source.id === normalized.mainCaseId,
            )!;
            for (const member of normalized.members) {
              const changed = await tx.case.updateMany({
                where: {
                  id: member.caseId,
                  departmentId: actor.departmentId,
                  stage: 'PENDING_MATCH',
                  version: member.expectedVersion,
                  consolidationMembership: { is: null },
                },
                data: { version: { increment: 1 } },
              });
              if (changed.count !== 1)
                throw failure('VERSION_CONFLICT', '参与案件版本已变化');
            }
            const id = randomUUID();
            const createdAt = new Date();
            await tx.caseConsolidation.create({
              data: {
                id,
                departmentId: actor.departmentId,
                mainCaseId: main.id,
                createdByUserId: actor.userId,
                createdAt,
              },
            });
            await tx.caseConsolidationMember.createMany({
              data: normalized.members.map((member) => ({
                consolidationId: id,
                caseId: member.caseId,
                departmentId: actor.departmentId,
                isMain: member.caseId === main.id,
                originalVersion: member.expectedVersion,
                defendantKind: member.defendant.kind,
                defendantName: member.defendant.name,
                defendantIdNo: member.defendant.idNo,
              })),
            });
            const result: CaseConsolidationResultDto = {
              id,
              mainCaseId: main.id,
              mainBusinessNo: main.businessNo,
              caseCount: normalized.members.length,
              caseIds: ids,
              createdAt: createdAt.toISOString(),
            };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE_CONSOLIDATION',
                resourceId: id,
                action: 'case.consolidated',
                details: {
                  mainCaseId: main.id,
                  caseIds: ids,
                  originalVersions: normalized.members.map((member) => ({
                    caseId: member.caseId,
                    version: member.expectedVersion,
                  })),
                  defendant: normalized.members[0].defendant,
                },
              },
            });
            await tx.caseConsolidationReceipt.create({
              data: {
                consolidationId: id,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: result as unknown as Prisma.InputJsonValue,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === 'P2034' || code === '40001') {
          if (attempt < 2) continue;
          throw failure('VERSION_CONFLICT', '参与案件已被同时修改');
        }
        if (code === 'P2002')
          throw failure('IDEMPOTENCY_CONFLICT', '案件已被合并或提交键重复');
        throw error;
      }
    }
    throw failure('VERSION_CONFLICT', '参与案件已被同时修改');
  }

  async read(actor: ActorContext, caseId: string) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw failure('ACTION_FORBIDDEN', '无权查看合案来源');
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw failure('ACTION_FORBIDDEN', '无权查看合案来源');
      throw error;
    }
    const membership = await this.database.caseConsolidationMember.findFirst({
      where: { caseId, departmentId: actor.departmentId },
      select: { consolidationId: true },
    });
    if (!membership) return null;
    const root = await this.database.caseConsolidation.findFirst({
      where: {
        id: membership.consolidationId,
        departmentId: actor.departmentId,
      },
      select: {
        id: true,
        mainCaseId: true,
        createdAt: true,
        members: {
          orderBy: [
            { isMain: 'desc' },
            { case: { createdAt: 'asc' } },
            { caseId: 'asc' },
          ],
          select: {
            caseId: true,
            isMain: true,
            originalVersion: true,
            defendantKind: true,
            defendantName: true,
            defendantIdNo: true,
            case: {
              select: {
                businessNo: true,
                stage: true,
                sourceLeadId: true,
                sourceNotaryMatterId: true,
                certificateId: true,
                sourceLead: {
                  select: {
                    id: true,
                    businessNo: true,
                    departmentId: true,
                    responsibleUserId: true,
                    teamId: true,
                    products: {
                      orderBy: { position: 'asc' },
                      select: {
                        id: true,
                        position: true,
                        title: true,
                        url: true,
                        screenshots: {
                          select: { materialId: true, contentVersionId: true },
                        },
                      },
                    },
                  },
                },
                sourceNotaryMatter: {
                  select: {
                    id: true,
                    businessNo: true,
                    selectedMaterials: {
                      select: {
                        materialId: true,
                        contentVersionId: true,
                        material: {
                          select: { ownerType: true, ownerId: true },
                        },
                      },
                    },
                  },
                },
                feeRecords: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (!root) throw failure('INVALID_STATE', '合案来源记录缺失');
    const filingSources =
      await this.database.caseFilingConsolidationSource.findMany({
        where: { caseId: root.mainCaseId, departmentId: actor.departmentId },
        select: {
          sourceCaseId: true,
          materialId: true,
          contentVersionId: true,
        },
      });
    let canReadFees = true;
    try {
      await this.access.authorizeDepartmentAction(actor, 'fee.read');
    } catch (error) {
      if (error instanceof ForbiddenException) canReadFees = false;
      else throw error;
    }
    const cases = await Promise.all(
      root.members.map(async (member) => {
        const source = member.case.sourceLead;
        let canReadLead = false;
        if (source) {
          try {
            await this.access.authorizeLead(actor, 'lead.read', {
              departmentId: source.departmentId,
              responsibleUserId: source.responsibleUserId,
              ...(source.teamId ? { teamId: source.teamId } : {}),
            });
            canReadLead = true;
          } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
          }
        }
        const caseMaterials = await this.materials.listOwnerMaterials(
          actor,
          'CASE',
          member.caseId,
        );
        const sourceMaterials =
          canReadLead && source
            ? await this.materials.listOwnerMaterials(actor, 'LEAD', source.id)
            : null;
        let notaryMaterials: Awaited<
          ReturnType<MaterialService['listOwnerMaterials']>
        > | null = null;
        if (canReadLead && member.case.sourceNotaryMatter) {
          try {
            notaryMaterials = await this.materials.listOwnerMaterials(
              actor,
              'NOTARY_MATTER',
              member.case.sourceNotaryMatter.id,
            );
          } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
          }
        }
        const references = canReadLead
          ? (member.case.sourceNotaryMatter?.selectedMaterials ?? [])
          : [];
        const authorizedMaterialIds = new Set([
          ...caseMaterials.items.map((material) => material.id),
          ...(sourceMaterials?.items.map((material) => material.id) ?? []),
          ...(notaryMaterials?.items.map((material) => material.id) ?? []),
        ]);
        return {
          caseId: member.caseId,
          businessNo: member.case.businessNo,
          stage: member.case.stage,
          isMain: member.isMain,
          originalVersion: member.originalVersion,
          defendant: {
            kind: member.defendantKind,
            name: member.defendantName,
            idNo: member.defendantIdNo,
          },
          sourceLead:
            canReadLead && source
              ? {
                  id: source.id,
                  businessNo: source.businessNo,
                  products: source.products.map((product) => ({
                    ...product,
                    screenshots: product.screenshots.map((screenshot) => ({
                      ...screenshot,
                    })),
                  })),
                }
              : null,
          sourceNotaryMatter: canReadLead
            ? member.case.sourceNotaryMatter && {
                id: member.case.sourceNotaryMatter.id,
                businessNo: member.case.sourceNotaryMatter.businessNo,
              }
            : null,
          certificateId: canReadLead ? member.case.certificateId : null,
          materials: [
            ...caseMaterials.items.map((material) => ({
              sourceCaseId: member.caseId,
              ...material,
            })),
            ...(sourceMaterials?.items.map((material) => ({
              sourceCaseId: member.caseId,
              ...material,
            })) ?? []),
            ...(notaryMaterials?.items.map((material) => ({
              sourceCaseId: member.caseId,
              ...material,
            })) ?? []),
          ],
          selectedMaterialVersions: references
            .filter((reference) =>
              authorizedMaterialIds.has(reference.materialId),
            )
            .map((reference) => ({
              materialId: reference.materialId,
              contentVersionId: reference.contentVersionId,
              ownerType: reference.material.ownerType,
              ownerId: reference.material.ownerId,
            })),
          filingReferences: filingSources.filter(
            (reference) =>
              reference.sourceCaseId === member.caseId &&
              authorizedMaterialIds.has(reference.materialId),
          ),
          feeRecordIds: canReadFees
            ? member.case.feeRecords.map((fee) => fee.id)
            : [],
        };
      }),
    );
    return {
      id: root.id,
      mainCaseId: root.mainCaseId,
      createdAt: root.createdAt.toISOString(),
      caseCount: cases.length,
      cases,
    };
  }
}
