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
  SubmitCaseFilingDto,
  SubmitCaseFilingResponseDto,
} from './case-filing.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class CaseFilingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async submit(
    actor: ActorContext,
    caseId: string,
    input: SubmitCaseFilingDto,
  ): Promise<SubmitCaseFilingResponseDto> {
    const value = this.normalize(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: value.expectedVersion,
          courtId: value.courtId,
          submittedAt: value.submittedAt,
          mediationNo: value.mediationNo,
          filingEvidenceContentVersionIds:
            value.filingEvidenceContentVersionIds,
          filingScreenshotContentVersionIds:
            value.filingScreenshotContentVersionIds,
        }),
      )
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
                complaintMailing: { select: { id: true } },
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (!account?.active) throw this.forbidden();
            let lawyerBindingId: string | undefined;
            if (account.accountType === 'LAWYER') {
              lawyerBindingId = await currentLawyerBindingId(
                tx,
                actor,
                caseId,
                true,
              );
            } else if (
              account.accountType === 'INTERNAL' &&
              actor.lawyerAccountId === undefined
            )
              try {
                await this.access.authorizeCase(
                  actor,
                  'case.filing.submit',
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
            const prior = await tx.caseFilingReceipt.findUnique({
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
                snapshot.stage !== 'WAITING_FORMAL_ACCEPTANCE' ||
                typeof snapshot.version !== 'number' ||
                !Number.isInteger(snapshot.version) ||
                typeof snapshot.submittedAt !== 'string' ||
                typeof snapshot.recordedAt !== 'string'
              )
                throw new InternalServerErrorException({
                  code: 'RECEIPT_CORRUPT',
                  message: '提交回执不可用',
                });
              return {
                id: snapshot.id,
                stage: snapshot.stage,
                version: snapshot.version,
                submittedAt: snapshot.submittedAt,
                recordedAt: snapshot.recordedAt,
              };
            }
            if (
              record.stage !== 'WAITING_FILING' ||
              record.complaintMailing === null
            )
              throw this.invalidState();
            if (record.version !== value.expectedVersion)
              throw this.versionConflict();
            const court = await tx.filingCourt.findFirst({
              where: { id: value.courtId, departmentId: actor.departmentId },
              select: { id: true, name: true },
            });
            if (court === null) throw this.validation();
            const evidence = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'FILING_EVIDENCE',
                contentVersionIds: value.filingEvidenceContentVersionIds,
                minCount: 1,
                maxCount: 50,
              },
            );
            const screenshots = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'FILING_SCREENSHOT',
                contentVersionIds: value.filingScreenshotContentVersionIds,
                minCount: 0,
                maxCount: 10,
              },
            );
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_FILING',
                version: value.expectedVersion,
              },
              data: {
                stage: 'WAITING_FORMAL_ACCEPTANCE',
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
                action: 'case.filing.submitted',
                details: {
                  fromVersion: value.expectedVersion,
                  toVersion: value.expectedVersion + 1,
                  courtId: court.id,
                  submittedAt: value.submittedAt,
                  mediationNo: value.mediationNo,
                  filingEvidenceContentVersionIds:
                    value.filingEvidenceContentVersionIds,
                  filingScreenshotContentVersionIds:
                    value.filingScreenshotContentVersionIds,
                },
              },
              select: { id: true },
            });
            const submission = await tx.caseFilingSubmission.create({
              data: {
                departmentId: actor.departmentId,
                caseId,
                courtId: court.id,
                courtName: court.name,
                submittedAt: new Date(`${value.submittedAt}T00:00:00.000Z`),
                recordedAt,
                recordedByUserId: actor.userId,
                mediationNo: value.mediationNo,
                auditEventId: audit.id,
              },
              select: { id: true },
            });
            await this.materials.freezeCaseFilingReferences(
              tx,
              actor,
              caseId,
              submission.id,
              [...evidence, ...screenshots],
              audit.id,
            );
            const result: SubmitCaseFilingResponseDto = {
              id: caseId,
              stage: 'WAITING_FORMAL_ACCEPTANCE',
              version: value.expectedVersion + 1,
              submittedAt: value.submittedAt,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseFilingReceipt.create({
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

  private normalize(input: SubmitCaseFilingDto) {
    const evidence = input.filingEvidenceContentVersionIds;
    const screenshots = input.filingScreenshotContentVersionIds ?? [];
    const date =
      typeof input.submittedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(input.submittedAt)
        ? new Date(`${input.submittedAt}T00:00:00.000Z`)
        : null;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      typeof input.courtId !== 'string' ||
      !uuid.test(input.courtId) ||
      date === null ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.submittedAt ||
      input.submittedAt > today ||
      !Array.isArray(evidence) ||
      evidence.length < 1 ||
      evidence.length > 50 ||
      !Array.isArray(screenshots) ||
      screenshots.length > 10 ||
      [...evidence, ...screenshots].some(
        (id) => typeof id !== 'string' || !uuid.test(id),
      ) ||
      new Set([...evidence, ...screenshots]).size !==
        evidence.length + screenshots.length ||
      (input.mediationNo !== undefined &&
        (typeof input.mediationNo !== 'string' ||
          input.mediationNo.trim() !== input.mediationNo ||
          input.mediationNo.length < 1 ||
          input.mediationNo.length > 100))
    )
      throw this.validation();
    return {
      ...input,
      mediationNo: input.mediationNo ?? null,
      filingScreenshotContentVersionIds: screenshots,
    };
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '提交法院参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权提交法院',
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
      message: '案件当前不能提交法院',
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
      message: '幂等键已用于其他提交请求',
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
