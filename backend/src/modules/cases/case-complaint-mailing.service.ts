import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { MailCaseComplaintDto, MailCaseComplaintResponseDto } from './case-complaint-mailing.dto';

@Injectable()
export class CaseComplaintMailingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async mail(
    actor: ActorContext,
    caseId: string,
    input: MailCaseComplaintDto,
  ): Promise<MailCaseComplaintResponseDto> {
    const normalized = this.normalize(input);
    if (actor.notaryOfficeId !== undefined) throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ caseId, ...normalized, idempotencyKey: undefined }))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(async (tx) => {
          const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
            caseId, actor.departmentId,
          );
          if (locked.length !== 1) throw this.notFound();
          const record = await tx.case.findFirst({
            where: { id: caseId, departmentId: actor.departmentId },
            select: { id: true, departmentId: true, customerId: true, stage: true, version: true,
              responsibleUserId: true, responsibleMembership: { select: { teamId: true } },
              complaintConfirmation: { select: { id: true } } },
          });
          if (record === null) throw this.notFound();
          let bindingId: string | null = null;
          if (actor.clientCustomerId !== undefined) {
            if (record.customerId !== actor.clientCustomerId) throw this.notFound();
            const binding = await tx.customerAccountBinding.findFirst({
              where: { userId: actor.userId, customerId: actor.clientCustomerId,
                departmentId: actor.departmentId, active: true,
                user: { active: true, accountType: 'CLIENT' },
                customer: { profileStatus: 'ADMITTED' } },
              select: { id: true },
            });
            if (binding === null) throw this.forbidden();
            bindingId = binding.id;
          } else {
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId }, select: { accountType: true, active: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active) throw this.forbidden();
            try {
              await this.access.authorizeCase(actor, 'case.complaint.mail', {
                departmentId: record.departmentId,
                responsibleUserId: record.responsibleUserId,
                ...(record.responsibleMembership.teamId ? { teamId: record.responsibleMembership.teamId } : {}),
              }, tx);
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
          }
          const prior = await tx.caseComplaintMailingReceipt.findUnique({
            where: { departmentId_actorUserId_idempotencyKey: {
              departmentId: actor.departmentId, actorUserId: actor.userId,
              idempotencyKey: normalized.idempotencyKey } },
          });
          if (prior !== null) {
            if (prior.caseId !== caseId || prior.requestFingerprint !== fingerprint)
              throw this.idempotencyConflict();
            const snapshot = prior.resultSnapshot;
            if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
              snapshot.id !== caseId || snapshot.stage !== 'WAITING_FILING' ||
              typeof snapshot.version !== 'number' || !Number.isInteger(snapshot.version) ||
              typeof snapshot.mailedAt !== 'string' ||
              typeof snapshot.recordedAt !== 'string') throw this.corruptReceipt();
            return { id: snapshot.id, stage: snapshot.stage, version: snapshot.version,
              mailedAt: snapshot.mailedAt, recordedAt: snapshot.recordedAt };
          }
          if (record.stage !== 'WAITING_COMPLAINT_STAMP' || record.complaintConfirmation === null)
            throw this.invalidState();
          if (record.version !== normalized.expectedVersion) throw this.versionConflict();
          const facts = await this.materials.assertAvailableVersions(tx, actor, {
            ownerType: 'CASE', ownerId: caseId, category: 'MAIL_RECEIPT',
            contentVersionIds: normalized.mailReceiptContentVersionIds,
            minCount: 1, maxCount: 10,
          });
          const updated = await tx.case.updateMany({
            where: { id: caseId, departmentId: actor.departmentId,
              stage: 'WAITING_COMPLAINT_STAMP', version: normalized.expectedVersion },
            data: { stage: 'WAITING_FILING', version: { increment: 1 } },
          });
          if (updated.count !== 1) throw this.versionConflict();
          const recordedAt = new Date();
          const audit = await tx.auditEvent.create({
            data: { departmentId: actor.departmentId, actorUserId: actor.userId,
              ...(bindingId === null ? { internalActorUserId: actor.userId } : {}),
              ...(bindingId === null ? {} : { customerAccountBindingId: bindingId }),
              resourceType: 'CASE', resourceId: caseId, action: 'case.complaint.mailed',
              details: { fromVersion: normalized.expectedVersion,
                toVersion: normalized.expectedVersion + 1, mailedAt: normalized.mailedAt,
                mailReceiptContentVersionIds: normalized.mailReceiptContentVersionIds,
                actorType: bindingId === null ? 'INTERNAL' : 'CLIENT' } },
            select: { id: true },
          });
          const mailing = await tx.caseComplaintMailing.create({
            data: { departmentId: actor.departmentId, caseId,
              mailedAt: new Date(`${normalized.mailedAt}T00:00:00.000Z`), recordedAt,
              recordedByUserId: actor.userId, actorType: bindingId === null ? 'INTERNAL' : 'CLIENT',
              customerAccountBindingId: bindingId, auditEventId: audit.id },
            select: { id: true },
          });
          await this.materials.freezeCaseComplaintMailingReferences(
            tx, actor, caseId, mailing.id, facts, audit.id,
          );
          const result: MailCaseComplaintResponseDto = { id: caseId, stage: 'WAITING_FILING',
            version: normalized.expectedVersion + 1, mailedAt: normalized.mailedAt,
            recordedAt: recordedAt.toISOString() };
          await tx.caseComplaintMailingReceipt.create({
            data: { departmentId: actor.departmentId, actorUserId: actor.userId,
              caseId, idempotencyKey: normalized.idempotencyKey,
              requestFingerprint: fingerprint, resultSnapshot: { ...result } },
          });
          return result;
        }, { isolationLevel: 'Serializable' });
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

  private normalize(input: MailCaseComplaintDto): MailCaseComplaintDto {
    const versions = input.mailReceiptContentVersionIds;
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128 ||
      typeof input.mailedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(input.mailedAt) ||
      !Array.isArray(versions) || versions.length < 1 || versions.length > 10 ||
      new Set(versions).size !== versions.length ||
      versions.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)))
      throw this.validation();
    const date = new Date(`${input.mailedAt}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.mailedAt ||
      input.mailedAt > today) throw this.validation();
    return input;
  }
  private validation() { return new BadRequestException({ code: 'VALIDATION_ERROR', message: '邮寄参数无效' }); }
  private forbidden() { return new ForbiddenException({ code: 'ACTION_FORBIDDEN', message: '无权登记邮寄' }); }
  private notFound() { return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: '案件不存在或不可访问' }); }
  private invalidState() { return new ConflictException({ code: 'INVALID_STATE', message: '案件当前不能登记邮寄' }); }
  private versionConflict() { return new ConflictException({ code: 'VERSION_CONFLICT', message: '案件状态或版本已变化' }); }
  private idempotencyConflict() { return new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于其他邮寄请求' }); }
  private corruptReceipt() { return new InternalServerErrorException({ code: 'RECEIPT_CORRUPT', message: '邮寄回执不可用' }); }
  private hasCode(error: unknown, code: string): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as { code?: unknown; cause?: unknown; meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; sqlState?: unknown } } } };
    return value.code === code || value.meta?.driverAdapterError?.cause?.originalCode === code ||
      value.meta?.driverAdapterError?.cause?.sqlState === code || this.hasCode(value.cause, code);
  }
}
