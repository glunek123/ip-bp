import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import {
  isLawyerAssignableStage,
  isLawyerBackfillStage,
} from './case-lawyer-assignable';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  AssignCaseLawyerDto,
  AssignCaseLawyerResponseDto,
  AssignmentViewDto,
} from './case-lawyer-assignment.dto';

@Injectable()
export class CaseLawyerAssignmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async capability(
    actor: ActorContext,
    caseId: string,
  ): Promise<{
    canAssign: boolean;
    reason?: 'INVALID_STATE' | 'LAWYER_ASSIGNMENT_CONFLICT';
    caseVersion: number;
    currentAssignment: AssignmentViewDto | null;
  }> {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw this.forbidden();
    const record = await this.database.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        departmentId: true,
        stage: true,
        version: true,
        matchedAt: true,
        matchedOn: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
        consolidationMembership: { select: { isMain: true } },
      },
    });
    if (!record) throw this.notFound();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
    const facts = {
      departmentId: record.departmentId,
      responsibleUserId: record.responsibleUserId,
      ...(record.responsibleMembership.teamId
        ? { teamId: record.responsibleMembership.teamId }
        : {}),
    };
    try {
      await this.access.authorizeCase(actor, 'case.read', facts);
      await this.access.authorizeCase(actor, 'case.lawyer.assign', facts);
      if (record.responsibleUserId !== actor.userId)
        await this.access.authorizeDepartmentProxyAction(
          actor,
          'case.lawyer.assign',
          facts,
        );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
    if (record.consolidationMembership?.isMain === false)
      return {
        canAssign: false,
        reason: 'INVALID_STATE',
        caseVersion: record.version,
        currentAssignment: null,
      };
    const assignments = await this.database.caseLawyerAssignment.findMany({
      where: { caseId, departmentId: actor.departmentId },
      select: {
        id: true,
        lawyerId: true,
        role: true,
        startedAt: true,
        endedAt: true,
        lawyer: {
          select: {
            departmentId: true,
            status: true,
            accountBinding: { select: { userId: true } },
          },
        },
      },
    });
    // 承办门禁只看档案：账号有无、账号启停不再构成冲突（P-01）。
    if (
      assignments.length > 1 ||
      assignments.some(
        (item) =>
          item.role !== 'PRIMARY' ||
          item.endedAt !== null ||
          item.lawyer.departmentId !== actor.departmentId ||
          item.lawyer.status !== 'ACTIVE',
      )
    )
      return {
        canAssign: false,
        reason: 'LAWYER_ASSIGNMENT_CONFLICT',
        caseVersion: record.version,
        currentAssignment: null,
      };
    const current = assignments[0];
    // 已有承办律师时只在原变更窗口内可改派；空缺则可随时补指派。
    if (
      current
        ? !isLawyerAssignableStage(record.stage)
        : !isLawyerBackfillStage(record.stage)
    )
      return {
        canAssign: false,
        reason: 'INVALID_STATE',
        caseVersion: record.version,
        currentAssignment: null,
      };
    return {
      canAssign: true,
      caseVersion: record.version,
      currentAssignment: current
        ? {
            id: current.id,
            lawyerProfileId: current.lawyerId,
            lawyerAccountId: current.lawyer.accountBinding?.userId ?? null,
            assignedAt: current.startedAt.toISOString(),
          }
        : null,
    };
  }

  async assign(
    actor: ActorContext,
    caseId: string,
    input: AssignCaseLawyerDto,
  ): Promise<AssignCaseLawyerResponseDto> {
    const request = this.normalize(input);
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw this.forbidden();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const record = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              select: {
                id: true,
                departmentId: true,
                stage: true,
                version: true,
                matchedAt: true,
                matchedOn: true,
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
                consolidationMembership: { select: { isMain: true } },
              },
            });
            if (!record) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            try {
              await this.access.authorizeCase(
                actor,
                'case.read',
                {
                  departmentId: record.departmentId,
                  responsibleUserId: record.responsibleUserId,
                  ...(record.responsibleMembership.teamId
                    ? { teamId: record.responsibleMembership.teamId }
                    : {}),
                },
                tx,
              );
              await this.access.authorizeCase(
                actor,
                'case.lawyer.assign',
                {
                  departmentId: record.departmentId,
                  responsibleUserId: record.responsibleUserId,
                  ...(record.responsibleMembership.teamId
                    ? { teamId: record.responsibleMembership.teamId }
                    : {}),
                },
                tx,
              );
              if (record.responsibleUserId !== actor.userId)
                await this.access.authorizeDepartmentProxyAction(
                  actor,
                  'case.lawyer.assign',
                  {
                    departmentId: record.departmentId,
                    responsibleUserId: record.responsibleUserId,
                  },
                  tx,
                );
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
            const prior = await tx.caseLawyerAssignmentReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: request.idempotencyKey,
                },
              },
            });
            if (prior) {
              if (prior.caseId !== caseId) throw this.idempotencyConflict();
              // v1 回执按旧公式（含账号）重放，不需要解析档案。
              if (
                prior.requestFingerprint ===
                this.legacyFingerprint(caseId, request)
              )
                return this.readReceipt(prior.resultSnapshot, caseId, request);
              // v2 回执自带档案快照，重放不查库：档案后来停用也能原样返回。
              const snapshotTarget = this.snapshotTarget(prior.resultSnapshot);
              if (
                snapshotTarget &&
                prior.requestFingerprint ===
                  this.fingerprint(
                    caseId,
                    request.expectedVersion,
                    snapshotTarget.profileId,
                  )
              )
                return this.readReceipt(
                  prior.resultSnapshot,
                  caseId,
                  request,
                  snapshotTarget,
                );
              throw this.idempotencyConflict();
            }
            if (
              !isLawyerBackfillStage(record.stage) ||
              record.consolidationMembership?.isMain === false
            )
              throw this.invalidState();
            if (record.version !== request.expectedVersion)
              throw this.versionConflict();
            const target = await this.resolveTargetProfile(
              tx,
              actor.departmentId,
              request,
            );
            const fingerprint = this.fingerprint(
              caseId,
              request.expectedVersion,
              target.profileId,
            );
            const assignments = await tx.caseLawyerAssignment.findMany({
              where: { caseId, departmentId: actor.departmentId },
              select: {
                id: true,
                lawyerId: true,
                role: true,
                startedAt: true,
                endedAt: true,
                lawyer: {
                  select: {
                    departmentId: true,
                    status: true,
                    accountBinding: { select: { userId: true } },
                  },
                },
              },
              orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            });
            if (
              assignments.some((item) => item.role !== 'PRIMARY') ||
              assignments.length > 1 ||
              assignments.some((item) => item.endedAt !== null)
            )
              throw this.relationshipConflict();
            const current = assignments[0];
            // 账号有无、账号启停不再判冲突；只校验档案本身同部门且启用（P-01）。
            if (
              current &&
              (current.lawyer.departmentId !== actor.departmentId ||
                current.lawyer.status !== 'ACTIVE')
            )
              throw this.relationshipConflict();
            // 已建立的承办关系在正式立案后锁定：只能补空缺，不能换人。
            if (current && !isLawyerAssignableStage(record.stage))
              throw this.invalidState();
            const previousAssignment: AssignmentViewDto | null = current
              ? {
                  id: current.id,
                  lawyerProfileId: current.lawyerId,
                  lawyerAccountId:
                    current.lawyer.accountBinding?.userId ?? null,
                  assignedAt: current.startedAt.toISOString(),
                }
              : null;
            let outcome: AssignCaseLawyerResponseDto['outcome'];
            let currentAssignment = previousAssignment;
            let version = record.version;
            if (current) {
              if (current.lawyerId === target.profileId) outcome = 'NO_CHANGE';
              else {
                // 变更承办律师：结束旧指派、建立新指派，阶段不变。
                const now = new Date();
                const changed = await tx.case.updateMany({
                  where: {
                    id: caseId,
                    departmentId: actor.departmentId,
                    version: request.expectedVersion,
                  },
                  data: { version: { increment: 1 } },
                });
                if (changed.count !== 1) throw this.versionConflict();
                await tx.caseLawyerAssignment.update({
                  where: { id: current.id },
                  data: { endedAt: now },
                });
                const created = await tx.caseLawyerAssignment.create({
                  data: {
                    caseId,
                    departmentId: actor.departmentId,
                    lawyerId: target.profileId,
                    role: 'PRIMARY',
                    startedAt: now,
                  },
                  select: { id: true },
                });
                currentAssignment = {
                  id: created.id,
                  lawyerProfileId: target.profileId,
                  lawyerAccountId: target.accountUserId,
                  assignedAt: now.toISOString(),
                };
                version += 1;
                outcome = 'REASSIGNED';
                await tx.auditEvent.create({
                  data: {
                    departmentId: actor.departmentId,
                    actorUserId: actor.userId,
                    internalActorUserId: actor.userId,
                    resourceType: 'CASE',
                    resourceId: caseId,
                    action: 'case.lawyer.reassign.succeeded',
                    details: {
                      fromVersion: record.version,
                      toVersion: version,
                      previousAssignment: previousAssignment
                        ? { ...previousAssignment }
                        : null,
                      currentAssignment: { ...currentAssignment },
                      outcome,
                    },
                  },
                });
              }
            } else {
              const now = new Date();
              const changed = await tx.case.updateMany({
                where: {
                  id: caseId,
                  departmentId: actor.departmentId,
                  // 补指派允许在任意阶段发生，阶段本身不变；版本仍必须精确。
                  stage: record.stage,
                  version: request.expectedVersion,
                },
                data: { version: { increment: 1 } },
              });
              if (changed.count !== 1) throw this.versionConflict();
              const created = await tx.caseLawyerAssignment.create({
                data: {
                  caseId,
                  departmentId: actor.departmentId,
                  lawyerId: target.profileId,
                  role: 'PRIMARY',
                  startedAt: now,
                },
                select: { id: true },
              });
              currentAssignment = {
                id: created.id,
                lawyerProfileId: target.profileId,
                lawyerAccountId: target.accountUserId,
                assignedAt: now.toISOString(),
              };
              version += 1;
              outcome = 'ASSIGNED';
              await tx.auditEvent.create({
                data: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  internalActorUserId: actor.userId,
                  resourceType: 'CASE',
                  resourceId: caseId,
                  action: 'case.lawyer.assign.succeeded',
                  details: {
                    fromVersion: record.version,
                    toVersion: version,
                    previousAssignment: null,
                    currentAssignment: { ...currentAssignment },
                    outcome,
                  },
                },
              });
            }
            const result: AssignCaseLawyerResponseDto = {
              id: caseId,
              stage: record.stage,
              version,
              outcome,
              requestedLawyerProfileId: target.profileId,
              requestedLawyerAccountId: target.accountUserId,
              previousAssignment,
              currentAssignment,
            };
            await tx.caseLawyerAssignmentReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                idempotencyKey: request.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: {
                  id: result.id,
                  stage: result.stage,
                  version: result.version,
                  outcome: result.outcome,
                  requestedLawyerProfileId: result.requestedLawyerProfileId,
                  requestedLawyerAccountId: result.requestedLawyerAccountId,
                  previousAssignment: result.previousAssignment
                    ? { ...result.previousAssignment }
                    : null,
                  currentAssignment: result.currentAssignment
                    ? { ...result.currentAssignment }
                    : null,
                },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerialization(error)) {
          if (attempt < 2) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) throw this.idempotencyConflict();
        // 历史案件的终态事实不完整时，数据库守卫会拒绝递增版本（23514）。
        // 这是确定失败，必须给明确提示，不能让前端当成「结果未知」去重试。
        if (this.isTerminalGuard(error))
          throw new ConflictException({
            code: 'CASE_TERMINAL_STATE_BLOCKED',
            message:
              '该案件的结案或归档记录不完整，暂不能补指派。请联系管理员核实该案归档信息后再试。',
          });
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: AssignCaseLawyerDto): AssignCaseLawyerDto {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const profileValid =
      typeof input.lawyerProfileId === 'string' &&
      uuid.test(input.lawyerProfileId);
    const accountValid =
      typeof input.lawyerAccountId === 'string' &&
      uuid.test(input.lawyerAccountId);
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey ||
      input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      // 档案是承办主体；账号仅作旧调用方兼容，二者至少提供一个。
      (!profileValid && !accountValid)
    )
      throw this.validation();
    return input;
  }
  private fingerprint(
    caseId: string,
    expectedVersion: number,
    lawyerProfileId: string,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify({ caseId, expectedVersion, lawyerProfileId }))
      .digest('hex');
  }
  /** 2026-11-23 之前的回执按账号计算指纹，重放时需按原公式复算。 */
  private legacyFingerprint(
    caseId: string,
    request: AssignCaseLawyerDto,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: request.expectedVersion,
          lawyerAccountId: request.lawyerAccountId ?? null,
          lawyerProfileId: request.lawyerProfileId ?? null,
        }),
      )
      .digest('hex');
  }
  /** 解析承办主体：档案必须同部门且启用；账号只用来带出线上身份。 */
  private async resolveTargetProfile(
    tx: Prisma.TransactionClient,
    departmentId: string,
    request: AssignCaseLawyerDto,
  ): Promise<{ profileId: string; accountUserId: string | null }> {
    if (request.lawyerProfileId) {
      await tx.$queryRawUnsafe(
        'SELECT "id" FROM "lawyer_profiles" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR SHARE',
        request.lawyerProfileId,
        departmentId,
      );
      const profile = await tx.lawyerProfile.findFirst({
        where: {
          id: request.lawyerProfileId,
          departmentId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          accountBinding: {
            select: {
              userId: true,
              active: true,
              user: { select: { active: true, accountType: true } },
            },
          },
        },
      });
      if (profile === null) throw this.forbidden();
      const binding = profile.accountBinding;
      const accountUserId =
        binding &&
        binding.active &&
        binding.user.active &&
        binding.user.accountType === 'LAWYER'
          ? binding.userId
          : null;
      if (request.lawyerAccountId && accountUserId !== request.lawyerAccountId)
        throw this.forbidden();
      return { profileId: profile.id, accountUserId };
    }
    // 旧调用方只给账号：沿用原规则，取最早的有效绑定档案。
    const binding = await tx.lawyerAccountBinding.findFirst({
      where: {
        userId: request.lawyerAccountId,
        departmentId,
        active: true,
        user: {
          accountType: 'LAWYER',
          active: true,
          localCredential: { isNot: null },
        },
        profile: { status: 'ACTIVE' },
      },
      select: { profileId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (binding === null) throw this.forbidden();
    return {
      profileId: binding.profileId,
      accountUserId: request.lawyerAccountId ?? null,
    };
  }
  /** 回执里已固化的承办主体，用于不查库重放。 */
  private snapshotTarget(
    value: unknown,
  ): { profileId: string; accountUserId: string | null } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const row = value as Record<string, unknown>;
    if (typeof row.requestedLawyerProfileId !== 'string') return null;
    return {
      profileId: row.requestedLawyerProfileId,
      accountUserId:
        typeof row.requestedLawyerAccountId === 'string'
          ? row.requestedLawyerAccountId
          : null,
    };
  }
  private readReceipt(
    value: unknown,
    caseId: string,
    request: AssignCaseLawyerDto,
    target?: { profileId: string; accountUserId: string | null },
  ): AssignCaseLawyerResponseDto {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const assignment = (item: unknown): item is AssignmentViewDto => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return false;
      const row = item as Record<string, unknown>;
      return (
        typeof row.id === 'string' &&
        uuid.test(row.id) &&
        typeof row.lawyerProfileId === 'string' &&
        uuid.test(row.lawyerProfileId) &&
        (row.lawyerAccountId === null ||
          (typeof row.lawyerAccountId === 'string' &&
            uuid.test(row.lawyerAccountId))) &&
        typeof row.assignedAt === 'string' &&
        !Number.isNaN(Date.parse(row.assignedAt))
      );
    };
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw this.corruptReceipt();
    const row = value as Record<string, unknown>;
    const previous = row.previousAssignment;
    const current = row.currentAssignment;
    // 旧回执没有 requestedLawyerProfileId，只按账号比对；新回执按档案比对。
    const expectedProfileId =
      target?.profileId ?? request.lawyerProfileId ?? null;
    const expectedAccountId = target
      ? target.accountUserId
      : (request.lawyerAccountId ?? null);
    const snapshotProfileId =
      typeof row.requestedLawyerProfileId === 'string'
        ? row.requestedLawyerProfileId
        : null;
    const snapshotAccountId =
      typeof row.requestedLawyerAccountId === 'string'
        ? row.requestedLawyerAccountId
        : null;
    const matchesTarget = (item: AssignmentViewDto) =>
      expectedProfileId !== null
        ? item.lawyerProfileId === expectedProfileId
        : item.lawyerAccountId === expectedAccountId;
    const shared =
      row.id === caseId &&
      typeof row.stage === 'string' &&
      isLawyerBackfillStage(row.stage) &&
      (expectedProfileId === null ||
        snapshotProfileId === null ||
        snapshotProfileId === expectedProfileId) &&
      (expectedAccountId === null || snapshotAccountId === expectedAccountId) &&
      Number.isInteger(row.version) &&
      (previous === null || assignment(previous)) &&
      assignment(current);
    if (!shared) throw this.corruptReceipt();
    const currentAssignment = current as AssignmentViewDto;
    if (row.outcome === 'ASSIGNED') {
      if (
        previous !== null ||
        !matchesTarget(currentAssignment) ||
        row.version !== request.expectedVersion + 1
      )
        throw this.corruptReceipt();
    } else if (row.outcome === 'REASSIGNED') {
      const previousAssignment = previous as AssignmentViewDto;
      if (
        !assignment(previous) ||
        !matchesTarget(currentAssignment) ||
        previousAssignment.lawyerProfileId ===
          currentAssignment.lawyerProfileId ||
        row.version !== request.expectedVersion + 1
      )
        throw this.corruptReceipt();
    } else if (row.outcome === 'NO_CHANGE' || row.outcome === 'SKIPPED') {
      if (
        !assignment(previous) ||
        JSON.stringify(previous) !== JSON.stringify(current) ||
        row.version !== request.expectedVersion ||
        (row.outcome === 'NO_CHANGE') !== matchesTarget(currentAssignment)
      )
        throw this.corruptReceipt();
    } else throw this.corruptReceipt();
    return value as AssignCaseLawyerResponseDto;
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '律师分配参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权分配案件律师',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '案件不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '案件当前不能分配律师',
    });
  }
  private relationshipConflict() {
    return new ConflictException({
      code: 'LAWYER_ASSIGNMENT_CONFLICT',
      message: '当前承办关系异常，无法分配',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '案件状态或版本已变化',
    });
  }
  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '幂等键已用于不同律师分配请求',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '律师分配回执不可用',
    });
  }
  private isUnique(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  private isTerminalGuard(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      value.code === '23514' ||
      value.meta?.driverAdapterError?.cause?.originalCode === '23514' ||
      value.meta?.driverAdapterError?.cause?.sqlState === '23514' ||
      this.isTerminalGuard(value.cause)
    );
  }
  private isSerialization(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      value.code === 'P2034' ||
      value.code === '40001' ||
      value.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      value.meta?.driverAdapterError?.cause?.sqlState === '40001' ||
      this.isSerialization(value.cause)
    );
  }
}
