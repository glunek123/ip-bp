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
import { DatabaseService } from '../../database/database.service';
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
    if (
      record.stage !== 'PENDING_MATCH' ||
      record.matchedAt !== null ||
      record.matchedOn !== null ||
      record.consolidationMembership?.isMain === false
    )
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
            accountBinding: {
              select: {
                userId: true,
                departmentId: true,
                active: true,
                user: { select: { active: true, accountType: true } },
              },
            },
          },
        },
      },
    });
    if (
      assignments.length > 1 ||
      assignments.some(
        (item) =>
          item.role !== 'PRIMARY' ||
          item.endedAt !== null ||
          item.lawyer.accountBinding?.departmentId !== actor.departmentId ||
          item.lawyer.accountBinding.active !== true ||
          item.lawyer.accountBinding.user.active !== true ||
          item.lawyer.accountBinding.user.accountType !== 'LAWYER',
      )
    )
      return {
        canAssign: false,
        reason: 'LAWYER_ASSIGNMENT_CONFLICT',
        caseVersion: record.version,
        currentAssignment: null,
      };
    const current = assignments[0];
    return {
      canAssign: true,
      caseVersion: record.version,
      currentAssignment: current
        ? {
            id: current.id,
            lawyerProfileId: current.lawyerId,
            lawyerAccountId: current.lawyer.accountBinding!.userId,
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
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: request.expectedVersion,
          lawyerAccountId: request.lawyerAccountId,
          lawyerProfileId: request.lawyerProfileId ?? null,
        }),
      )
      .digest('hex');
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
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.idempotencyConflict();
              return this.readReceipt(prior.resultSnapshot, caseId, request);
            }
            if (
              record.stage !== 'PENDING_MATCH' ||
              record.matchedAt !== null ||
              record.matchedOn !== null ||
              record.consolidationMembership?.isMain === false
            )
              throw this.invalidState();
            if (record.version !== request.expectedVersion)
              throw this.versionConflict();
            const candidates = await tx.$queryRawUnsafe<
              Array<{ profile_id: string }>
            >(
              `SELECT b."profile_id" FROM "lawyer_account_bindings" b JOIN "user_accounts" u ON u."id" = b."user_id"
             JOIN "local_credentials" lc ON lc."user_id" = u."id"
             WHERE b."user_id" = $1::uuid AND b."department_id" = $2::uuid AND b."active"
               AND u."active" AND u."account_type" = 'LAWYER'
               AND ($3::uuid IS NULL OR b."profile_id" = $3::uuid)
             ORDER BY b."created_at", b."id" LIMIT 1 FOR SHARE OF b, u`,
              request.lawyerAccountId,
              actor.departmentId,
              request.lawyerProfileId ?? null,
            );
            if (candidates.length !== 1) throw this.forbidden();
            const profileId = candidates[0].profile_id;
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
                    accountBinding: {
                      select: {
                        userId: true,
                        departmentId: true,
                        active: true,
                        user: {
                          select: {
                            active: true,
                            accountType: true,
                            localCredential: { select: { id: true } },
                          },
                        },
                      },
                    },
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
            if (
              current &&
              (current.lawyer.accountBinding?.departmentId !==
                actor.departmentId ||
                !current.lawyer.accountBinding.userId ||
                !current.lawyer.accountBinding.active ||
                !current.lawyer.accountBinding.user.active ||
                current.lawyer.accountBinding.user.accountType !== 'LAWYER' ||
                !current.lawyer.accountBinding.user.localCredential)
            )
              throw this.relationshipConflict();
            const previousAssignment: AssignmentViewDto | null = current
              ? {
                  id: current.id,
                  lawyerProfileId: current.lawyerId,
                  lawyerAccountId: current.lawyer.accountBinding!.userId,
                  assignedAt: current.startedAt.toISOString(),
                }
              : null;
            let outcome: AssignCaseLawyerResponseDto['outcome'];
            let currentAssignment = previousAssignment;
            let version = record.version;
            if (current) {
              outcome =
                current.lawyer.accountBinding!.userId ===
                request.lawyerAccountId
                  ? 'NO_CHANGE'
                  : 'SKIPPED';
            } else {
              const now = new Date();
              const changed = await tx.case.updateMany({
                where: {
                  id: caseId,
                  departmentId: actor.departmentId,
                  stage: 'PENDING_MATCH',
                  version: request.expectedVersion,
                },
                data: { version: { increment: 1 } },
              });
              if (changed.count !== 1) throw this.versionConflict();
              const created = await tx.caseLawyerAssignment.create({
                data: {
                  caseId,
                  departmentId: actor.departmentId,
                  lawyerId: profileId,
                  role: 'PRIMARY',
                  startedAt: now,
                },
                select: { id: true },
              });
              currentAssignment = {
                id: created.id,
                lawyerProfileId: profileId,
                lawyerAccountId: request.lawyerAccountId,
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
              stage: 'PENDING_MATCH',
              version,
              outcome,
              requestedLawyerAccountId: request.lawyerAccountId,
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
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: AssignCaseLawyerDto): AssignCaseLawyerDto {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey ||
      input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      typeof input.lawyerAccountId !== 'string' ||
      !uuid.test(input.lawyerAccountId) ||
      (input.lawyerProfileId !== undefined &&
        (typeof input.lawyerProfileId !== 'string' ||
          !uuid.test(input.lawyerProfileId)))
    )
      throw this.validation();
    return input;
  }
  private readReceipt(
    value: unknown,
    caseId: string,
    request: AssignCaseLawyerDto,
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
        typeof row.lawyerAccountId === 'string' &&
        uuid.test(row.lawyerAccountId) &&
        typeof row.assignedAt === 'string' &&
        !Number.isNaN(Date.parse(row.assignedAt))
      );
    };
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw this.corruptReceipt();
    const row = value as Record<string, unknown>;
    const previous = row.previousAssignment;
    const current = row.currentAssignment;
    const shared =
      row.id === caseId &&
      row.stage === 'PENDING_MATCH' &&
      row.requestedLawyerAccountId === request.lawyerAccountId &&
      Number.isInteger(row.version) &&
      (previous === null || assignment(previous)) &&
      assignment(current);
    if (!shared) throw this.corruptReceipt();
    const currentAssignment = current as AssignmentViewDto;
    if (row.outcome === 'ASSIGNED') {
      if (
        previous !== null ||
        currentAssignment.lawyerAccountId !== request.lawyerAccountId ||
        (request.lawyerProfileId !== undefined &&
          currentAssignment.lawyerProfileId !== request.lawyerProfileId) ||
        row.version !== request.expectedVersion + 1
      )
        throw this.corruptReceipt();
    } else if (row.outcome === 'NO_CHANGE' || row.outcome === 'SKIPPED') {
      if (
        !assignment(previous) ||
        JSON.stringify(previous) !== JSON.stringify(current) ||
        row.version !== request.expectedVersion ||
        (row.outcome === 'NO_CHANGE') !==
          (currentAssignment.lawyerAccountId === request.lawyerAccountId)
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
