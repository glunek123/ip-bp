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
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import {
  RegisterCaseAcceptanceDto,
  RegisterCaseAcceptanceResponseDto,
} from './case-acceptance.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const categories = [
  ['ACCEPTANCE_NOTICE', 'acceptanceNoticeContentVersionIds'],
  ['PAYMENT_LIST', 'paymentListContentVersionIds'],
  ['SERVICE_DOCUMENT', 'serviceDocumentContentVersionIds'],
] as const;

@Injectable()
export class CaseAcceptanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async register(
    actor: ActorContext,
    caseId: string,
    input: RegisterCaseAcceptanceDto,
  ): Promise<RegisterCaseAcceptanceResponseDto> {
    const value = this.normalize(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ caseId, ...value }))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
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
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
                filingSubmission: { select: { submittedAt: true } },
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (!account?.active) throw this.forbidden();
            let lawyerBindingId: string | undefined;
            if (account.accountType === 'LAWYER')
              lawyerBindingId = await currentLawyerBindingId(
                tx,
                actor,
                caseId,
                true,
              );
            else if (
              account.accountType === 'INTERNAL' &&
              actor.lawyerAccountId === undefined
            )
              try {
                await this.access.authorizeCase(
                  actor,
                  'case.acceptance.register',
                  {
                    departmentId: record.departmentId,
                    responsibleUserId: record.responsibleUserId,
                    ...(record.responsibleMembership.teamId
                      ? { teamId: record.responsibleMembership.teamId }
                      : {}),
                  },
                  tx,
                );
              } catch (error) {
                if (error instanceof ForbiddenException) throw this.forbidden();
                throw error;
              }
            else throw this.forbidden();
            const prior = await tx.caseAcceptanceReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: value.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.idempotencyConflict();
              const snapshot = prior.resultSnapshot;
              if (
                snapshot === null ||
                typeof snapshot !== 'object' ||
                Array.isArray(snapshot) ||
                snapshot.id !== caseId ||
                snapshot.stage !== 'WAITING_HEARING' ||
                typeof snapshot.version !== 'number' ||
                !Number.isInteger(snapshot.version) ||
                typeof snapshot.acceptedAt !== 'string' ||
                typeof snapshot.courtCaseNo !== 'string' ||
                typeof snapshot.recordedAt !== 'string'
              )
                throw new InternalServerErrorException({
                  code: 'RECEIPT_CORRUPT',
                  message: '正式立案回执不可用',
                });
              return {
                id: snapshot.id,
                stage: snapshot.stage,
                version: snapshot.version,
                acceptedAt: snapshot.acceptedAt,
                courtCaseNo: snapshot.courtCaseNo,
                recordedAt: snapshot.recordedAt,
              };
            }
            if (
              record.stage !== 'WAITING_FORMAL_ACCEPTANCE' ||
              record.filingSubmission === null
            )
              throw this.invalidState();
            if (record.version !== value.expectedVersion)
              throw this.versionConflict();
            if (
              value.acceptedAt <
              record.filingSubmission.submittedAt.toISOString().slice(0, 10)
            )
              throw this.validation();
            const versions = [];
            for (const [category, property] of categories) {
              versions.push(
                ...(await this.materials.assertAvailableVersions(tx, actor, {
                  ownerType: 'CASE',
                  ownerId: caseId,
                  category,
                  contentVersionIds: value[property],
                  minCount: 0,
                  maxCount: 10,
                })),
              );
            }
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_FORMAL_ACCEPTANCE',
                version: value.expectedVersion,
              },
              data: {
                stage: 'WAITING_HEARING',
                courtCaseNo: value.courtCaseNo,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            const recordedAt = new Date();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                ...(lawyerBindingId === undefined
                  ? { internalActorUserId: actor.userId }
                  : { lawyerAccountBindingId: lawyerBindingId }),
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.acceptance.registered',
                details: {
                  fromVersion: value.expectedVersion,
                  toVersion: value.expectedVersion + 1,
                  acceptedAt: value.acceptedAt,
                  courtCaseNo: value.courtCaseNo,
                  acceptanceNoticeContentVersionIds:
                    value.acceptanceNoticeContentVersionIds,
                  paymentListContentVersionIds:
                    value.paymentListContentVersionIds,
                  serviceDocumentContentVersionIds:
                    value.serviceDocumentContentVersionIds,
                },
              },
              select: { id: true },
            });
            const acceptance = await tx.caseAcceptance.create({
              data: {
                departmentId: actor.departmentId,
                caseId,
                acceptedAt: new Date(`${value.acceptedAt}T00:00:00.000Z`),
                courtCaseNo: value.courtCaseNo,
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId: audit.id,
              },
              select: { id: true },
            });
            await this.materials.freezeCaseAcceptanceReferences(
              tx,
              actor,
              caseId,
              acceptance.id,
              versions,
              audit.id,
            );
            const result: RegisterCaseAcceptanceResponseDto = {
              id: caseId,
              stage: 'WAITING_HEARING',
              version: value.expectedVersion + 1,
              acceptedAt: value.acceptedAt,
              courtCaseNo: value.courtCaseNo,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseAcceptanceReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                idempotencyKey: value.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: { ...result },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.hasCode(error, 'P2034') || this.hasCode(error, '40001')) {
          if (attempt < 2) continue;
          throw this.versionConflict();
        }
        if (this.hasCode(error, 'P2002')) throw this.idempotencyConflict();
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: RegisterCaseAcceptanceDto) {
    const date =
      typeof input.acceptedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(input.acceptedAt)
        ? new Date(`${input.acceptedAt}T00:00:00.000Z`)
        : null;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const arrays = categories.map(([, property]) => input[property] ?? []);
    const allIds = arrays.flat();
    const courtCaseNo =
      typeof input.courtCaseNo === 'string' ? input.courtCaseNo.trim() : null;
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      date === null ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.acceptedAt ||
      input.acceptedAt > today ||
      courtCaseNo === null ||
      courtCaseNo.length < 1 ||
      courtCaseNo.length > 100 ||
      arrays.some((ids) => !Array.isArray(ids) || ids.length > 10) ||
      allIds.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
      new Set(allIds).size !== allIds.length
    )
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      acceptedAt: input.acceptedAt,
      courtCaseNo,
      acceptanceNoticeContentVersionIds: arrays[0],
      paymentListContentVersionIds: arrays[1],
      serviceDocumentContentVersionIds: arrays[2],
    };
  }

  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '正式立案参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权登记正式立案',
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
      message: '案件当前不能登记正式立案',
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
      message: '幂等键已用于其他登记请求',
    });
  }
  private hasCode(error: unknown, code: string): boolean {
    if (error === null || typeof error !== 'object') return false;
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
      value.code === code ||
      value.meta?.driverAdapterError?.cause?.originalCode === code ||
      value.meta?.driverAdapterError?.cause?.sqlState === code ||
      this.hasCode(value.cause, code)
    );
  }
}
