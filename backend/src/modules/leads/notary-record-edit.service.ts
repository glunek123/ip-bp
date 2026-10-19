import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  CorrectNotaryEvidenceDto,
  CorrectNotaryOpeningSenderDto,
  NotaryRecordCorrectionResponseDto,
} from './notary-record-edit.dto';

type Kind = 'EVIDENCE' | 'OPENING_SENDER';
type Normalized = {
  expectedVersion: number;
  expectedRevision: number;
  correctionReason: string;
  evidenceAt?: string;
  evidenceDate?: Date;
  logistics?: Array<{
    companyState: 'PRESENT' | 'NONE';
    companyValue: string | null;
    trackingState: 'PRESENT' | 'NONE';
    trackingValue: string | null;
  }>;
  senderName?: string | null;
  senderPhone?: string | null;
  senderAddress?: string | null;
};

@Injectable()
export class NotaryRecordEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async correctEvidence(
    actor: ActorContext,
    matterId: string,
    key: string,
    input: CorrectNotaryEvidenceDto,
  ) {
    return this.write(
      actor,
      matterId,
      key,
      'EVIDENCE',
      this.normalizeEvidence(input),
    );
  }

  async correctOpeningSender(
    actor: ActorContext,
    matterId: string,
    key: string,
    input: CorrectNotaryOpeningSenderDto,
  ) {
    return this.write(
      actor,
      matterId,
      key,
      'OPENING_SENDER',
      this.normalizeSender(input),
    );
  }

  private async write(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    kind: Kind,
    input: Normalized,
  ): Promise<NotaryRecordCorrectionResponseDto> {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128
    )
      throw this.validation();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({ matterId, kind, ...input, evidenceDate: undefined }),
      )
      .digest('hex');
    const action =
      kind === 'EVIDENCE' ? 'evidence.correct' : 'opening.sender.correct';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              matterId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const matter = await tx.notaryMatter.findFirst({
              where: { id: matterId, departmentId: actor.departmentId },
              select: {
                stage: true,
                version: true,
                departmentId: true,
                evidence: { select: { matterId: true } },
                opening: { select: { matterId: true } },
                sourceLead: {
                  select: { responsibleUserId: true, teamId: true },
                },
              },
            });
            if (matter === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (
              account?.accountType !== 'INTERNAL' ||
              account.active !== true ||
              actor.clientCustomerId !== undefined ||
              actor.notaryOfficeId !== undefined ||
              actor.lawyerAccountId !== undefined
            )
              throw this.forbidden();
            try {
              await this.access.authorizeLead(
                actor,
                'notary.record.correct',
                {
                  departmentId: matter.departmentId,
                  responsibleUserId: matter.sourceLead.responsibleUserId,
                  ...(matter.sourceLead.teamId === null
                    ? {}
                    : { teamId: matter.sourceLead.teamId }),
                },
                tx,
              );
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
            const receipt = await tx.notaryMatterCommandReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action,
                  idempotencyKey,
                },
              },
            });
            if (receipt !== null)
              return this.replay(receipt, fingerprint, matterId, kind);
            const allowed =
              kind === 'EVIDENCE'
                ? [
                    'WAITING_UNBOX',
                    'UNBOX_REVIEW',
                    'ISSUANCE_DECISION',
                    'WAITING_CERTIFICATE',
                    'WAITING_RETURN',
                  ].includes(matter.stage) && matter.evidence !== null
                : [
                    'UNBOX_REVIEW',
                    'ISSUANCE_DECISION',
                    'WAITING_CERTIFICATE',
                    'WAITING_RETURN',
                  ].includes(matter.stage) && matter.opening !== null;
            if (!allowed)
              throw new ConflictException({
                code: 'INVALID_STATE',
                message: '当前阶段不能新增该资料更正',
              });
            if (matter.version !== input.expectedVersion)
              throw this.versionConflict();
            const latest =
              kind === 'EVIDENCE'
                ? await tx.notaryEvidenceCorrection.findFirst({
                    where: { matterId, departmentId: actor.departmentId },
                    orderBy: { revision: 'desc' },
                    select: { revision: true },
                  })
                : await tx.notaryOpeningSenderCorrection.findFirst({
                    where: { matterId, departmentId: actor.departmentId },
                    orderBy: { revision: 'desc' },
                    select: { revision: true },
                  });
            if ((latest?.revision ?? 0) !== input.expectedRevision)
              throw this.versionConflict();
            const correctionId = randomUUID();
            const recordedAt = new Date();
            const revision = input.expectedRevision + 1;
            if (kind === 'EVIDENCE') {
              const logistics = input.logistics;
              if (input.evidenceDate === undefined || logistics === undefined)
                throw this.validation();
              await tx.notaryEvidenceCorrection.create({
                data: {
                  id: correctionId,
                  matterId,
                  departmentId: actor.departmentId,
                  revision,
                  correctionReason: input.correctionReason,
                  evidenceAt: input.evidenceDate,
                  actorUserId: actor.userId,
                  recordedAt,
                  logistics: {
                    create: logistics.map((row, index) => ({
                      id: randomUUID(),
                      position: index + 1,
                      ...row,
                    })),
                  },
                },
              });
            } else {
              await tx.notaryOpeningSenderCorrection.create({
                data: {
                  id: correctionId,
                  matterId,
                  departmentId: actor.departmentId,
                  revision,
                  correctionReason: input.correctionReason,
                  senderName: input.senderName ?? null,
                  senderPhone: input.senderPhone ?? null,
                  senderAddress: input.senderAddress ?? null,
                  actorUserId: actor.userId,
                  recordedAt,
                },
              });
            }
            const result: NotaryRecordCorrectionResponseDto = {
              matterId,
              correctionId,
              kind,
              revision,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'notary_matter',
                resourceId: matterId,
                action:
                  kind === 'EVIDENCE'
                    ? 'notary.evidence_corrected'
                    : 'notary.opening_sender_corrected',
                details: {
                  correctionId,
                  revision,
                  correctionReason: input.correctionReason,
                },
              },
            });
            await tx.notaryMatterCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                action,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultMatterId: matterId,
                resultMatterVersion: matter.version,
                resultSnapshot: { ...result },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isRetryable(error)) {
          if (attempt < 3) continue;
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalizeBase(input: {
    expectedVersion: number;
    expectedRevision: number;
    correctionReason: string;
  }) {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      typeof input.correctionReason !== 'string'
    )
      throw this.validation();
    const correctionReason = input.correctionReason.trim();
    if (correctionReason.length < 1 || [...correctionReason].length > 500)
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      expectedRevision: input.expectedRevision,
      correctionReason,
    };
  }
  private normalizeEvidence(input: CorrectNotaryEvidenceDto): Normalized {
    const base = this.normalizeBase(input);
    if (
      typeof input.evidenceAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.evidenceAt) ||
      !Array.isArray(input.logistics) ||
      input.logistics.length < 1
    )
      throw this.validation();
    const evidenceDate = new Date(`${input.evidenceAt}T00:00:00.000Z`);
    if (
      Number.isNaN(evidenceDate.getTime()) ||
      evidenceDate.toISOString().slice(0, 10) !== input.evidenceAt
    )
      throw this.validation();
    const field = (state: unknown, value: unknown, max: number) => {
      if (state === 'NONE') {
        if (value !== null && value !== undefined) throw this.validation();
        return { state: 'NONE' as const, value: null };
      }
      if (state !== 'PRESENT' || typeof value !== 'string')
        throw this.validation();
      const trimmed = value.trim();
      if (trimmed.length === 0 || [...trimmed].length > max)
        throw this.validation();
      return { state: 'PRESENT' as const, value: trimmed };
    };
    const logistics = input.logistics.map((row) => {
      if (row === null || typeof row !== 'object') throw this.validation();
      const company = field(row.companyState, row.companyValue, 200);
      const tracking = field(row.trackingState, row.trackingValue, 100);
      return {
        companyState: company.state,
        companyValue: company.value,
        trackingState: tracking.state,
        trackingValue: tracking.value,
      };
    });
    return { ...base, evidenceAt: input.evidenceAt, evidenceDate, logistics };
  }
  private normalizeSender(input: CorrectNotaryOpeningSenderDto): Normalized {
    const base = this.normalizeBase(input);
    const sender = (value: unknown, max: number): string | null => {
      if (value === null) return null;
      if (typeof value !== 'string' || [...value].length > max)
        throw this.validation();
      return value.trim() || null;
    };
    return {
      ...base,
      senderName: sender(input.senderName, 200),
      senderPhone: sender(input.senderPhone, 100),
      senderAddress: sender(input.senderAddress, 500),
    };
  }
  private replay(
    receipt: {
      requestFingerprint: string;
      resultMatterId: string;
      resultSnapshot: unknown;
    },
    fingerprint: string,
    matterId: string,
    kind: Kind,
  ): NotaryRecordCorrectionResponseDto {
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.resultMatterId !== matterId
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该 Idempotency-Key 已用于不同请求',
      });
    const value = receipt.resultSnapshot;
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw this.corrupt();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).sort().join() !==
        ['matterId', 'correctionId', 'kind', 'revision', 'recordedAt']
          .sort()
          .join() ||
      row.matterId !== matterId ||
      row.kind !== kind ||
      typeof row.correctionId !== 'string' ||
      !Number.isInteger(row.revision) ||
      (row.revision as number) < 1 ||
      typeof row.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(row.recordedAt))
    )
      throw this.corrupt();
    return value as NotaryRecordCorrectionResponseDto;
  }
  private isRetryable(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const row = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      ['P2002', 'P2034', '40001'].includes(String(row.code)) ||
      row.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      row.meta?.driverAdapterError?.cause?.sqlState === '40001' ||
      this.isRetryable(row.cause)
    );
  }
  private validation(): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '更正资料不符合要求',
    });
  }
  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权更正该公证资料',
    });
  }
  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '资源不存在或不可访问',
    });
  }
  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '资料或事项版本已更新，请重新加载',
    });
  }
  private corrupt(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: '公证更正回执损坏',
    });
  }
}
