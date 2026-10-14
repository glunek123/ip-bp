import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  AcceptanceCorrectionResultDto,
  CorrectCaseAcceptanceDto,
  DefendantContactUpdateResultDto,
  UpdateDefendantContactDto,
} from './case-record-edit.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

type ContactValue = {
  defendantId: string;
  expectedContactRevision: number;
  idempotencyKey: string;
  phone: string | null;
  address: string | null;
};
type AcceptanceValue = {
  acceptanceId: string;
  expectedAcceptanceRevision: number;
  idempotencyKey: string;
  acceptedAt: string;
  courtCaseNo: string;
  reason: string;
};

@Injectable()
export class CaseRecordEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async updateContact(
    actor: ActorContext,
    caseId: string,
    input: UpdateDefendantContactDto,
  ): Promise<DefendantContactUpdateResultDto> {
    const value = this.contactInput(input);
    const fingerprint = this.fingerprint(caseId, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await this.lockAndAuthorize(
              tx,
              actor,
              caseId,
              'case.defendant-contact.update',
            );
            const prior = await tx.caseRecordEditReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  command: 'DEFENDANT_CONTACT_UPDATE',
                  idempotencyKey: value.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.conflict('IDEMPOTENCY_CONFLICT');
              return this.contactReceipt(prior.resultSnapshot, caseId);
            }
            const defendant = await tx.caseDefendant.findFirst({
              where: {
                id: value.defendantId,
                caseId,
                departmentId: actor.departmentId,
              },
              select: { phone: true, address: true, contactRevision: true },
            });
            if (defendant === null) throw this.conflict('INVALID_STATE');
            if (defendant.contactRevision !== value.expectedContactRevision)
              throw this.conflict('VERSION_CONFLICT');
            if (
              defendant.phone === value.phone &&
              defendant.address === value.address
            )
              throw this.validation('联系方式没有变化');
            const changeId = randomUUID();
            const recordedAt = new Date();
            const updated = await tx.caseDefendant.updateMany({
              where: {
                id: value.defendantId,
                caseId,
                departmentId: actor.departmentId,
                contactRevision: value.expectedContactRevision,
              },
              data: {
                phone: value.phone,
                address: value.address,
                contactRevision: { increment: 1 },
              },
            });
            if (updated.count !== 1) throw this.conflict('VERSION_CONFLICT');
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.defendant-contact.updated',
                details: {
                  defendantId: value.defendantId,
                  changeId,
                  fromRevision: value.expectedContactRevision,
                  toRevision: value.expectedContactRevision + 1,
                  beforePhone: defendant.phone,
                  beforeAddress: defendant.address,
                  phone: value.phone,
                  address: value.address,
                },
              },
              select: { id: true },
            });
            await tx.caseDefendantContactChange.create({
              data: {
                id: changeId,
                caseId,
                departmentId: actor.departmentId,
                defendantId: value.defendantId,
                fromRevision: value.expectedContactRevision,
                toRevision: value.expectedContactRevision + 1,
                beforePhone: defendant.phone,
                beforeAddress: defendant.address,
                phone: value.phone,
                address: value.address,
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId: audit.id,
              },
            });
            const result: DefendantContactUpdateResultDto = {
              caseId,
              defendantId: value.defendantId,
              changeId,
              contactRevision: value.expectedContactRevision + 1,
              phone: value.phone,
              address: value.address,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseRecordEditReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                command: 'DEFENDANT_CONTACT_UPDATE',
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
          throw this.conflict('VERSION_CONFLICT');
        }
        if (this.hasCode(error, 'P2002')) {
          if (attempt < 2) continue;
          throw this.conflict('VERSION_CONFLICT');
        }
        throw error;
      }
    }
    throw this.conflict('VERSION_CONFLICT');
  }

  async correctAcceptance(
    actor: ActorContext,
    caseId: string,
    input: CorrectCaseAcceptanceDto,
  ): Promise<AcceptanceCorrectionResultDto> {
    const value = this.acceptanceInput(input);
    const fingerprint = this.fingerprint(caseId, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const record = await this.lockAndAuthorize(
              tx,
              actor,
              caseId,
              'case.acceptance.correct',
            );
            const prior = await tx.caseRecordEditReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  command: 'ACCEPTANCE_CORRECTION',
                  idempotencyKey: value.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.conflict('IDEMPOTENCY_CONFLICT');
              return this.acceptanceReceipt(prior.resultSnapshot, caseId);
            }
            const acceptance = await tx.caseAcceptance.findFirst({
              where: {
                id: value.acceptanceId,
                caseId,
                departmentId: actor.departmentId,
              },
              select: {
                trialRoundId: true,
                acceptedAt: true,
                courtCaseNo: true,
                corrections: {
                  orderBy: { toRevision: 'desc' },
                  take: 1,
                  select: {
                    id: true,
                    toRevision: true,
                    acceptedAt: true,
                    courtCaseNo: true,
                  },
                },
              },
            });
            if (acceptance === null) throw this.conflict('INVALID_STATE');
            const latest = acceptance.corrections[0];
            const revision = latest?.toRevision ?? 0;
            if (revision !== value.expectedAcceptanceRevision)
              throw this.conflict('VERSION_CONFLICT');
            const beforeDate = isoDate(
              latest?.acceptedAt ?? acceptance.acceptedAt,
            );
            const beforeNo = latest?.courtCaseNo ?? acceptance.courtCaseNo;
            if (
              beforeDate === value.acceptedAt &&
              beforeNo === value.courtCaseNo
            )
              throw this.validation('受理信息没有变化');
            await this.validateAcceptanceDate(
              tx,
              actor.departmentId,
              caseId,
              acceptance.trialRoundId,
              value.acceptedAt,
            );
            const correctionId = randomUUID();
            const recordedAt = new Date();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.acceptance.corrected',
                details: {
                  acceptanceId: value.acceptanceId,
                  trialRoundId: acceptance.trialRoundId,
                  correctionId,
                  priorCorrectionId: latest?.id ?? null,
                  fromRevision: revision,
                  toRevision: revision + 1,
                  beforeAcceptedAt: beforeDate,
                  beforeCourtCaseNo: beforeNo,
                  acceptedAt: value.acceptedAt,
                  courtCaseNo: value.courtCaseNo,
                  reason: value.reason,
                },
              },
              select: { id: true },
            });
            await tx.caseAcceptanceCorrection.create({
              data: {
                id: correctionId,
                caseId,
                departmentId: actor.departmentId,
                acceptanceId: value.acceptanceId,
                trialRoundId: acceptance.trialRoundId,
                priorCorrectionId: latest?.id ?? null,
                fromRevision: revision,
                toRevision: revision + 1,
                acceptedAt: new Date(`${value.acceptedAt}T00:00:00.000Z`),
                courtCaseNo: value.courtCaseNo,
                reason: value.reason,
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId: audit.id,
              },
            });
            if (
              record.currentAcceptanceId === value.acceptanceId &&
              record.currentTrialRoundId === acceptance.trialRoundId
            ) {
              const updated = await tx.case.updateMany({
                where: {
                  id: caseId,
                  departmentId: actor.departmentId,
                  currentAcceptanceId: value.acceptanceId,
                  currentTrialRoundId: acceptance.trialRoundId,
                  courtCaseNo: beforeNo,
                },
                data: { courtCaseNo: value.courtCaseNo },
              });
              if (updated.count !== 1) throw this.conflict('VERSION_CONFLICT');
            }
            const result: AcceptanceCorrectionResultDto = {
              caseId,
              acceptanceId: value.acceptanceId,
              correctionId,
              acceptanceRevision: revision + 1,
              acceptedAt: value.acceptedAt,
              courtCaseNo: value.courtCaseNo,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseRecordEditReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                command: 'ACCEPTANCE_CORRECTION',
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
          throw this.conflict('VERSION_CONFLICT');
        }
        if (this.hasCode(error, 'P2002')) {
          if (attempt < 2) continue;
          throw this.conflict('VERSION_CONFLICT');
        }
        throw error;
      }
    }
    throw this.conflict('VERSION_CONFLICT');
  }

  private async lockAndAuthorize(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    action: 'case.defendant-contact.update' | 'case.acceptance.correct',
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
      caseId,
      actor.departmentId,
    );
    if (locked.length !== 1) throw this.notFound();
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        id: true,
        departmentId: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
        currentAcceptanceId: true,
        currentTrialRoundId: true,
      },
    });
    if (record === null) throw this.notFound();
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (!account?.active || account.accountType !== 'INTERNAL')
      throw this.forbidden();
    try {
      await this.access.authorizeCase(
        actor,
        action,
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
    return record;
  }

  private async validateAcceptanceDate(
    tx: Prisma.TransactionClient,
    departmentId: string,
    caseId: string,
    trialRoundId: string,
    date: string,
  ) {
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId },
      select: {
        filingSubmission: { select: { submittedAt: true } },
        hearingArrangements: {
          where: { trialRoundId },
          select: { hearingAt: true },
        },
        judgmentFacts: {
          where: { trialRoundId },
          select: { judgmentReceivedAt: true },
        },
        secondInstanceProgresses: {
          where: { trialRoundId },
          select: { hearingAt: true },
        },
        secondInstanceResults: {
          where: { trialRoundId },
          select: { resultReceivedAt: true },
        },
        executionSubmissions: {
          where: { trialRoundId },
          select: { id: true },
        },
        executionMailing: { select: { mailedAt: true } },
        executionFiling: { select: { submittedAt: true } },
        executionFinish: { select: { finishedAt: true } },
        closure: {
          select: { versions: { select: { closeAt: true } } },
        },
        archive: {
          select: { versions: { select: { archiveAt: true } } },
        },
      },
    });
    if (
      !record?.filingSubmission ||
      date < isoDate(record.filingSubmission.submittedAt)
    )
      throw this.validation('受理日期不得早于真实提交日');
    const upper: Array<Date | null> = [
      ...record.hearingArrangements.map((fact) => fact.hearingAt),
      ...record.judgmentFacts.map((fact) => fact.judgmentReceivedAt),
      ...record.secondInstanceProgresses.map((fact) => fact.hearingAt),
      ...record.secondInstanceResults.map((fact) => fact.resultReceivedAt),
    ];
    if (record.executionSubmissions.length > 0) {
      upper.push(
        record.executionMailing?.mailedAt ?? null,
        record.executionFiling?.submittedAt ?? null,
        record.executionFinish?.finishedAt ?? null,
        ...(record.closure?.versions.map((version) => version.closeAt) ?? []),
        ...(record.archive?.versions.map((version) => version.archiveAt) ?? []),
      );
    }
    if (upper.some((later) => later !== null && date > isoDate(later)))
      throw this.validation('受理日期不得晚于已登记的后续业务日期');
  }

  private contactInput(input: UpdateDefendantContactDto): ContactValue {
    const keys = [
      'defendantId',
      'expectedContactRevision',
      'idempotencyKey',
      'phone',
      'address',
    ];
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key)) ||
      typeof input.defendantId !== 'string' ||
      !uuid.test(input.defendantId) ||
      !Number.isSafeInteger(input.expectedContactRevision) ||
      input.expectedContactRevision < 0 ||
      !this.validKey(input.idempotencyKey) ||
      (input.phone !== null && typeof input.phone !== 'string') ||
      (input.address !== null && typeof input.address !== 'string')
    )
      throw this.validation('联系方式参数无效');
    const phone = input.phone?.trim() || null;
    const address = input.address?.trim() || null;
    if ((phone?.length ?? 0) > 100 || (address?.length ?? 0) > 500)
      throw this.validation('联系方式长度超限');
    return {
      defendantId: input.defendantId,
      expectedContactRevision: input.expectedContactRevision,
      idempotencyKey: input.idempotencyKey,
      phone,
      address,
    };
  }

  private acceptanceInput(input: CorrectCaseAcceptanceDto): AcceptanceValue {
    const keys = [
      'acceptanceId',
      'expectedAcceptanceRevision',
      'idempotencyKey',
      'acceptedAt',
      'courtCaseNo',
      'reason',
    ];
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key)) ||
      typeof input.acceptanceId !== 'string' ||
      !uuid.test(input.acceptanceId) ||
      !Number.isSafeInteger(input.expectedAcceptanceRevision) ||
      input.expectedAcceptanceRevision < 0 ||
      !this.validKey(input.idempotencyKey) ||
      typeof input.acceptedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.acceptedAt) ||
      typeof input.courtCaseNo !== 'string' ||
      typeof input.reason !== 'string'
    )
      throw this.validation('受理更正参数无效');
    const parsed = new Date(`${input.acceptedAt}T00:00:00.000Z`);
    const courtCaseNo = input.courtCaseNo.trim();
    const reason = input.reason.trim();
    if (
      Number.isNaN(parsed.getTime()) ||
      isoDate(parsed) !== input.acceptedAt ||
      input.acceptedAt > todayShanghai() ||
      courtCaseNo.length < 1 ||
      courtCaseNo.length > 100 ||
      reason.length < 1 ||
      reason.length > 500
    )
      throw this.validation('受理更正参数无效');
    return {
      acceptanceId: input.acceptanceId,
      expectedAcceptanceRevision: input.expectedAcceptanceRevision,
      idempotencyKey: input.idempotencyKey,
      acceptedAt: input.acceptedAt,
      courtCaseNo,
      reason,
    };
  }

  private validKey(key: unknown): key is string {
    return (
      typeof key === 'string' &&
      key.length >= 1 &&
      key.length <= 128 &&
      key === key.trim()
    );
  }

  private fingerprint(caseId: string, value: ContactValue | AcceptanceValue) {
    return createHash('sha256')
      .update(JSON.stringify({ caseId, ...value }))
      .digest('hex');
  }

  private contactReceipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): DefendantContactUpdateResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.caseId !== caseId ||
      typeof snapshot.defendantId !== 'string' ||
      typeof snapshot.changeId !== 'string' ||
      typeof snapshot.contactRevision !== 'number' ||
      (snapshot.phone !== null && typeof snapshot.phone !== 'string') ||
      (snapshot.address !== null && typeof snapshot.address !== 'string') ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw this.conflict('RECEIPT_CORRUPT');
    return {
      caseId,
      defendantId: snapshot.defendantId,
      changeId: snapshot.changeId,
      contactRevision: snapshot.contactRevision,
      phone: snapshot.phone,
      address: snapshot.address,
      recordedAt: snapshot.recordedAt,
    };
  }

  private acceptanceReceipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): AcceptanceCorrectionResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.caseId !== caseId ||
      typeof snapshot.acceptanceId !== 'string' ||
      typeof snapshot.correctionId !== 'string' ||
      typeof snapshot.acceptanceRevision !== 'number' ||
      typeof snapshot.acceptedAt !== 'string' ||
      typeof snapshot.courtCaseNo !== 'string' ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw this.conflict('RECEIPT_CORRUPT');
    return {
      caseId,
      acceptanceId: snapshot.acceptanceId,
      correctionId: snapshot.correctionId,
      acceptanceRevision: snapshot.acceptanceRevision,
      acceptedAt: snapshot.acceptedAt,
      courtCaseNo: snapshot.courtCaseNo,
      recordedAt: snapshot.recordedAt,
    };
  }

  private validation(message: string) {
    return new BadRequestException({ code: 'VALIDATION_ERROR', message });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权修改案件资料',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '案件不存在或不可访问',
    });
  }
  private conflict(code: string) {
    return new ConflictException({
      code,
      message: '案件资料已变化或当前不可修改',
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
