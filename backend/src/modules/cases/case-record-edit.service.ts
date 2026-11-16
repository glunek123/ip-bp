import { keyDetailDate } from './case-key-details';
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
import { readCaseSourceAnchor } from './case-entry-source';
import {
  AcceptanceCorrectionResultDto,
  AddCaseDefendantDto,
  AddCaseDefendantResultDto,
  CaseTypesContextDto,
  ChangeCaseTypesDto,
  ChangeCaseTypesResultDto,
  ChangeResponsibleUserDto,
  ChangeResponsibleUserResultDto,
  ResponsibleUserCandidateDto,
  CorrectCaseAcceptanceDto,
  DefendantContactUpdateResultDto,
  SaveSecondInstanceAcceptanceDto,
  SaveSecondInstanceAcceptanceResultDto,
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
type AddDefendantValue = {
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  idNo: string | null;
  phone: string | null;
  address: string | null;
  legalRepresentative: string | null;
  idempotencyKey: string;
};
type CaseTypesValue = {
  caseType: string;
  infringementTypes: string[];
  reason: string;
  idempotencyKey: string;
};
type ResponsibleValue = {
  userId: string;
  reason: string | null;
  idempotencyKey: string;
};
type AcceptanceValue = {
  paymentDueAt?: string | null;
  acceptanceId: string;
  expectedAcceptanceRevision: number;
  idempotencyKey: string;
  acceptedAt: string;
  courtCaseNo: string;
  reason: string;
};
type SecondAcceptanceValue = {
  choiceId: string | null;
  trialRoundId: string;
  expectedAcceptanceRevision: number;
  idempotencyKey: string;
  acceptedAt: string | null;
  courtCaseNo: string | null;
  reason: string | null;
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
                disabledAt: null,
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

  async addDefendant(
    actor: ActorContext,
    caseId: string,
    input: AddCaseDefendantDto,
  ): Promise<AddCaseDefendantResultDto> {
    const value = this.defendantInput(input);
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
            const count = await tx.caseDefendant.count({
              where: { caseId, departmentId: actor.departmentId },
            });
            if (count >= 20) throw this.validation('被告数量已达上限（20）');
            const duplicated = await tx.caseDefendant.findFirst({
              where: {
                caseId,
                departmentId: actor.departmentId,
                name: value.name,
                disabledAt: null,
              },
              select: { id: true },
            });
            if (duplicated !== null) throw this.conflict('DUPLICATE_DEFENDANT');
            const defendantId = randomUUID();
            const recordedAt = new Date();
            await tx.caseDefendant.create({
              data: {
                id: defendantId,
                caseId,
                departmentId: actor.departmentId,
                kind: value.kind,
                name: value.name,
                idNo: value.idNo,
                phone: value.phone,
                address: value.address,
                legalRepresentative: value.legalRepresentative,
                contactRevision: 0,
              },
            });
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.defendant.added',
                details: {
                  defendantId,
                  kind: value.kind,
                  name: value.name,
                },
              },
              select: { id: true },
            });
            const result: AddCaseDefendantResultDto = {
              caseId,
              defendantId,
              contactRevision: 0,
              recordedAt: recordedAt.toISOString(),
            };
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

  async setDefendantDisabled(
    actor: ActorContext,
    caseId: string,
    defendantId: string,
    disabled: boolean,
  ): Promise<{
    caseId: string;
    defendantId: string;
    disabledAt: string | null;
  }> {
    return this.database.$transaction(async (tx) => {
      await this.lockAndAuthorize(
        tx,
        actor,
        caseId,
        'case.defendant-contact.update',
      );
      const target = await tx.caseDefendant.findFirst({
        where: { id: defendantId, caseId, departmentId: actor.departmentId },
        select: { id: true, name: true, disabledAt: true },
      });
      if (target === null) throw this.notFound();
      if (disabled && target.disabledAt !== null)
        throw this.validation('该被告已停用');
      if (!disabled && target.disabledAt === null)
        throw this.validation('该被告未停用');
      if (disabled) {
        const active = await tx.caseDefendant.count({
          where: {
            caseId,
            departmentId: actor.departmentId,
            disabledAt: null,
          },
        });
        if (active <= 1)
          throw this.validation('案件至少保留一名启用中的被告，不能停用');
      }
      const recordedAt = new Date();
      await tx.caseDefendant.updateMany({
        where: {
          id: defendantId,
          caseId,
          departmentId: actor.departmentId,
        },
        data: disabled
          ? { disabledAt: recordedAt, disabledByUserId: actor.userId }
          : { disabledAt: null, disabledByUserId: null },
      });
      await tx.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          internalActorUserId: actor.userId,
          resourceType: 'CASE',
          resourceId: caseId,
          action: disabled
            ? 'case.defendant.disabled'
            : 'case.defendant.enabled',
          details: { defendantId, name: target.name },
        },
        select: { id: true },
      });
      return {
        caseId,
        defendantId,
        disabledAt: disabled ? recordedAt.toISOString() : null,
      };
    });
  }

  async responsibleCandidates(
    actor: ActorContext,
    caseId: string,
  ): Promise<ResponsibleUserCandidateDto[]> {
    await this.database.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor, caseId, 'case.routine.edit');
    });
    const rows = await this.database.userAccount.findMany({
      where: {
        active: true,
        accountType: 'INTERNAL',
        memberships: {
          some: { departmentId: actor.departmentId, active: true },
        },
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
      take: 200,
    });
    return rows.map((row) => ({ id: row.id, displayName: row.displayName }));
  }

  async changeResponsibleUser(
    actor: ActorContext,
    caseId: string,
    input: ChangeResponsibleUserDto,
  ): Promise<ChangeResponsibleUserResultDto> {
    const value: ResponsibleValue = {
      userId: input.userId,
      reason: input.reason?.trim() || null,
      idempotencyKey: input.idempotencyKey,
    };
    const fingerprint = this.fingerprint(caseId, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const record = await this.lockAndAuthorize(
              tx,
              actor,
              caseId,
              'case.routine.edit',
            );
            if (record.responsibleUserId === value.userId)
              throw this.validation('案件负责人没有变化');
            const target = await tx.userAccount.findFirst({
              where: {
                id: value.userId,
                active: true,
                accountType: 'INTERNAL',
                memberships: {
                  some: { departmentId: actor.departmentId, active: true },
                },
              },
              select: { id: true },
            });
            if (target === null) throw this.validation('目标运营不可用');
            const previousUserId = record.responsibleUserId;
            const recordedAt = new Date();
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                responsibleUserId: previousUserId,
              },
              data: {
                responsibleUserId: value.userId,
                responsibilityEpoch: { increment: 1 },
              },
            });
            if (updated.count !== 1) throw this.conflict('VERSION_CONFLICT');
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.responsible-user.changed',
                details: {
                  fromUserId: previousUserId,
                  toUserId: value.userId,
                  reason: value.reason,
                },
              },
              select: { id: true },
            });
            const result: ChangeResponsibleUserResultDto = {
              caseId,
              responsibleUserId: value.userId,
              responsibilityEpoch: record.responsibilityEpoch + 1,
              recordedAt: recordedAt.toISOString(),
            };
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

  async assignResponsibleUser(
    actor: ActorContext,
    caseId: string,
    input: ChangeResponsibleUserDto,
  ): Promise<ChangeResponsibleUserResultDto> {
    const value: ResponsibleValue = {
      userId: input.userId,
      reason: input.reason?.trim() || null,
      idempotencyKey: input.idempotencyKey,
    };
    return this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
        caseId,
        actor.departmentId,
      );
      if (locked.length !== 1) throw this.notFound();
      const record = await tx.case.findFirst({
        where: { id: caseId, departmentId: actor.departmentId },
        select: {
          responsibleUserId: true,
          responsibilityEpoch: true,
          responsibleMembership: { select: { teamId: true } },
        },
      });
      if (record === null) throw this.notFound();
      // 管理改派：不要求操作人是当前负责人，但要求同部门且具备部门代理授权。
      await this.access.authorizeDepartmentProxyAction(
        actor,
        'case.routine.edit',
        {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        },
      );
      if (record.responsibleUserId === value.userId)
        throw this.validation('案件负责人没有变化');
      const target = await tx.userAccount.findFirst({
        where: {
          id: value.userId,
          active: true,
          accountType: 'INTERNAL',
          memberships: {
            some: { departmentId: actor.departmentId, active: true },
          },
        },
        select: { id: true },
      });
      if (target === null) throw this.validation('目标运营不可用');
      const recordedAt = new Date();
      const updated = await tx.case.updateMany({
        where: {
          id: caseId,
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
        },
        data: {
          responsibleUserId: value.userId,
          responsibilityEpoch: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw this.conflict('VERSION_CONFLICT');
      await tx.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          internalActorUserId: actor.userId,
          resourceType: 'CASE',
          resourceId: caseId,
          action: 'case.responsible-user.assigned',
          details: {
            fromUserId: record.responsibleUserId,
            toUserId: value.userId,
            reason: value.reason,
          },
        },
        select: { id: true },
      });
      return {
        caseId,
        responsibleUserId: value.userId,
        responsibilityEpoch: record.responsibilityEpoch + 1,
        recordedAt: recordedAt.toISOString(),
      };
    });
  }

  async caseTypesContext(
    actor: ActorContext,
    caseId: string,
  ): Promise<CaseTypesContextDto> {
    return this.database.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor, caseId, 'case.routine.edit');
      const leadId = await this.caseSourceLead(tx, caseId);
      if (leadId === null) return { leadId: null, affectedCaseCount: 0 };
      const affectedCaseCount = await tx.case.count({
        where: { sourceLeadId: leadId, departmentId: actor.departmentId },
      });
      return { leadId, affectedCaseCount };
    });
  }

  async changeCaseTypes(
    actor: ActorContext,
    caseId: string,
    input: ChangeCaseTypesDto,
  ): Promise<ChangeCaseTypesResultDto> {
    const value: CaseTypesValue = {
      caseType: input.caseType,
      infringementTypes: [...new Set(input.infringementTypes)].sort(),
      reason: input.reason.trim(),
      idempotencyKey: input.idempotencyKey,
    };
    if (!value.reason) throw this.validation('请填写更正原因');
    const fingerprint = this.fingerprint(caseId, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const record = await this.lockAndAuthorize(
              tx,
              actor,
              caseId,
              'case.routine.edit',
            );
            const leadId = await this.caseSourceLead(tx, caseId);
            if (leadId === null)
              throw this.validation('该案件没有来源线索，类型不可在此更正');
            const lead = await tx.lead.findFirst({
              where: { id: leadId, departmentId: actor.departmentId },
              select: {
                id: true,
                caseType: true,
                infringements: { select: { type: true } },
              },
            });
            if (lead === null) throw this.notFound();
            const beforeTypes = lead.infringements
              .map((entry) => entry.type as string)
              .sort();
            if (
              lead.caseType === value.caseType &&
              beforeTypes.join(',') === value.infringementTypes.join(',')
            )
              throw this.validation('案件类型没有变化');
            const affectedCaseCount = await tx.case.count({
              where: { sourceLeadId: leadId, departmentId: actor.departmentId },
            });
            const recordedAt = new Date();
            await tx.lead.updateMany({
              where: { id: leadId, departmentId: actor.departmentId },
              data: { caseType: value.caseType as never },
            });
            await tx.leadInfringement.deleteMany({ where: { leadId } });
            await tx.leadInfringement.createMany({
              data: value.infringementTypes.map((type) => ({
                id: randomUUID(),
                leadId,
                type: type as never,
              })),
            });
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.case-types.changed',
                details: {
                  leadId,
                  fromCaseType: lead.caseType,
                  toCaseType: value.caseType,
                  fromInfringementTypes: beforeTypes,
                  toInfringementTypes: value.infringementTypes,
                  affectedCaseCount,
                  reason: value.reason,
                },
              },
              select: { id: true },
            });
            const result: ChangeCaseTypesResultDto = {
              caseId,
              leadId,
              caseType: value.caseType,
              infringementTypes: value.infringementTypes,
              affectedCaseCount,
              recordedAt: recordedAt.toISOString(),
            };
            void record;
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
                externalEntryId: true,
                courtId: true,
                acceptedAt: true,
                courtCaseNo: true,
                paymentDueAt: true,
                corrections: {
                  orderBy: { toRevision: 'desc' },
                  take: 1,
                  select: {
                    id: true,
                    toRevision: true,
                    acceptedAt: true,
                    courtCaseNo: true,
                    paymentDueAt: true,
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
            const beforePayment =
              (latest === undefined
                ? acceptance.paymentDueAt
                : latest.paymentDueAt) ?? null;
            const paymentDueAt =
              value.paymentDueAt === undefined
                ? beforePayment
                : value.paymentDueAt === null
                  ? null
                  : new Date(`${value.paymentDueAt}T00:00:00.000Z`);
            if (
              beforeDate === value.acceptedAt &&
              beforeNo === value.courtCaseNo &&
              (beforePayment?.getTime() ?? null) ===
                (paymentDueAt?.getTime() ?? null)
            )
              throw this.validation('受理信息没有变化');
            await this.validateAcceptanceDate(
              tx,
              actor.departmentId,
              caseId,
              acceptance,
              value.acceptedAt,
            );
            const parentDate = await tx.$queryRaw<Array<{ valid: boolean }>>`
              SELECT case_second_child_acceptance_date_valid(${acceptance.trialRoundId}::uuid,
                ${value.acceptedAt}::date) AS valid`;
            if (parentDate[0]?.valid !== true)
              throw this.validation('发回重审受理日期不得早于对应二审受理日期');
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
                  beforePaymentDueAt:
                    beforePayment?.toISOString().slice(0, 10) ?? null,
                  paymentDueAt:
                    paymentDueAt?.toISOString().slice(0, 10) ?? null,
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
                paymentDueAt,
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

  async saveSecondInstanceAcceptance(
    actor: ActorContext,
    caseId: string,
    input: SaveSecondInstanceAcceptanceDto,
  ): Promise<SaveSecondInstanceAcceptanceResultDto> {
    const value = this.secondAcceptanceInput(input);
    const fingerprint = this.fingerprint(caseId, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const record = await this.lockAndAuthorize(
              tx,
              actor,
              caseId,
              'case.second-instance-acceptance.update',
            );
            const prior = await tx.caseRecordEditReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  command: 'SECOND_INSTANCE_ACCEPTANCE_SAVE',
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
              return this.secondAcceptanceReceipt(prior.resultSnapshot, caseId);
            }
            const source = await readCaseSourceAnchor(
              tx,
              caseId,
              actor.departmentId,
            );
            const directEntry =
              value.choiceId === null &&
              source.kind === 'EXTERNAL_ENTRY' &&
              source.initialStage === 'SECOND_INSTANCE';
            const directRound = directEntry
              ? await tx.caseTrialRound.findFirst({
                  where: {
                    id: value.trialRoundId,
                    caseId,
                    departmentId: actor.departmentId,
                    origin: 'EXTERNAL_CURRENT',
                    externalEntryId: source.entryId,
                    sourceResultId: null,
                  },
                  select: { id: true },
                })
              : null;
            if (
              value.choiceId === null &&
              (!directEntry || directRound === null)
            )
              throw this.conflict('INVALID_STATE');
            const choice =
              value.choiceId === null
                ? null
                : await tx.caseJudgmentNextStep.findFirst({
                    where: {
                      id: value.choiceId,
                      caseId,
                      departmentId: actor.departmentId,
                      trialRoundId: value.trialRoundId,
                      next: 'APPEAL',
                      revocation: null,
                    },
                    select: {
                      id: true,
                      judgment: {
                        select: {
                          judgmentReceivedAt: true,
                          recordCorrections: {
                            orderBy: { toRevision: 'desc' },
                            take: 1,
                            select: { judgmentReceivedAt: true },
                          },
                        },
                      },
                    },
                  });
            if (value.choiceId !== null && choice === null)
              throw this.conflict('INVALID_STATE');
            const latest =
              await tx.caseSecondInstanceAcceptanceChange.findFirst({
                where: {
                  choiceId: value.choiceId,
                  caseId,
                  departmentId: actor.departmentId,
                },
                orderBy: { toRevision: 'desc' },
              });
            const revision = latest?.toRevision ?? 0;
            if (revision !== value.expectedAcceptanceRevision)
              throw this.conflict('VERSION_CONFLICT');
            if (
              (value.choiceId === null
                ? record.currentTrialRoundId !== value.trialRoundId
                : record.currentJudgmentNextStepId !== value.choiceId) &&
              latest === null &&
              (await tx.caseSecondInstanceProgress.count({
                where: {
                  caseId,
                  departmentId: actor.departmentId,
                  choiceId: value.choiceId,
                },
              })) === 0 &&
              (await tx.caseSecondInstanceResult.count({
                where: {
                  caseId,
                  departmentId: actor.departmentId,
                  choiceId: value.choiceId,
                },
              })) === 0
            )
              throw this.conflict('INVALID_STATE');
            if (
              revision === 0 &&
              value.acceptedAt === null &&
              value.courtCaseNo === null
            )
              throw this.validation('首次登记至少填写一项真实受理信息');
            if (revision === 0 ? value.reason !== null : value.reason === null)
              throw this.validation('首次登记不填写原因，后续更正须填写原因');
            const beforeDate = latest?.acceptedAt
              ? isoDate(latest.acceptedAt)
              : null;
            const beforeNo = latest?.courtCaseNo ?? null;
            if (
              latest !== null &&
              beforeDate === value.acceptedAt &&
              beforeNo === value.courtCaseNo
            )
              throw this.validation('二审受理信息没有变化');
            if (value.acceptedAt !== null) {
              if (
                directEntry &&
                source.kind === 'EXTERNAL_ENTRY' &&
                (value.acceptedAt < source.stageReachedOn ||
                  (source.known.secondInstanceAcceptedOn !== null &&
                    value.acceptedAt < source.known.secondInstanceAcceptedOn))
              )
                throw this.validation('二审受理日期不得早于外部转入真实日期');
              if (
                choice?.judgment !== null &&
                choice?.judgment !== undefined &&
                value.acceptedAt <
                  isoDate(
                    choice.judgment.recordCorrections[0]?.judgmentReceivedAt ??
                      choice.judgment.judgmentReceivedAt,
                  )
              )
                throw this.validation('二审受理日期不得早于原判决收到日');
              const checked = await tx.$queryRaw<Array<{ valid: boolean }>>`
              SELECT check_case_second_acceptance_dates(${value.choiceId}::uuid, ${caseId}::uuid,
                ${actor.departmentId}::uuid, ${value.trialRoundId}::uuid, ${value.acceptedAt}::date) AS valid`;
              if (checked[0]?.valid !== true)
                throw this.validation('二审受理日期与已有后续业务日期冲突');
            }
            const changeId = randomUUID();
            const recordedAt = new Date();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.second-instance-acceptance.updated',
                details: {
                  choiceId: value.choiceId,
                  trialRoundId: value.trialRoundId,
                  changeId,
                  priorChangeId: latest?.id ?? null,
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
            await tx.caseSecondInstanceAcceptanceChange.create({
              data: {
                id: changeId,
                caseId,
                departmentId: actor.departmentId,
                trialRoundId: value.trialRoundId,
                choiceId: value.choiceId,
                externalEntryId:
                  source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                priorChangeId: latest?.id ?? null,
                fromRevision: revision,
                toRevision: revision + 1,
                acceptedAt:
                  value.acceptedAt === null
                    ? null
                    : new Date(`${value.acceptedAt}T00:00:00.000Z`),
                courtCaseNo: value.courtCaseNo,
                reason: value.reason,
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId: audit.id,
              },
            });
            const result: SaveSecondInstanceAcceptanceResultDto = {
              caseId,
              choiceId: value.choiceId,
              trialRoundId: value.trialRoundId,
              changeId,
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
                command: 'SECOND_INSTANCE_ACCEPTANCE_SAVE',
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
        if (
          this.hasCode(error, 'P2034') ||
          this.hasCode(error, '40001') ||
          this.hasCode(error, 'P2002')
        ) {
          if (attempt < 2) continue;
          throw this.conflict('VERSION_CONFLICT');
        }
        if (this.hasCode(error, '23514')) throw this.conflict('INVALID_STATE');
        throw error;
      }
    }
    throw this.conflict('VERSION_CONFLICT');
  }

  private async lockAndAuthorize(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    action:
      | 'case.defendant-contact.update'
      | 'case.routine.edit'
      | 'case.acceptance.correct'
      | 'case.second-instance-acceptance.update',
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
        responsibilityEpoch: true,
        responsibleMembership: { select: { teamId: true } },
        currentAcceptanceId: true,
        currentTrialRoundId: true,
        currentJudgmentNextStepId: true,
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
    acceptance: {
      trialRoundId: string;
      externalEntryId: string | null;
      courtId: string | null;
    },
    date: string,
  ) {
    const trialRoundId = acceptance.trialRoundId;
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
    if (record === null) throw this.conflict('INVALID_STATE');
    if (record.filingSubmission === null) {
      const source = await readCaseSourceAnchor(tx, caseId, departmentId);
      if (
        source.kind !== 'EXTERNAL_ENTRY' ||
        acceptance.externalEntryId !== source.entryId ||
        acceptance.courtId === null
      )
        throw this.conflict('INVALID_STATE');
      const round = await tx.caseTrialRound.findFirst({
        where: {
          id: trialRoundId,
          caseId,
          departmentId,
          externalEntryId: source.entryId,
        },
        select: {
          origin: true,
          sourceResult: {
            select: {
              result: true,
              resultReceivedAt: true,
              externalEntryId: true,
              revocation: { select: { id: true } },
            },
          },
        },
      });
      const directRoot =
        source.initialStage === 'WAITING_FORMAL_ACCEPTANCE' &&
        round?.origin === 'EXTERNAL_CURRENT' &&
        round.sourceResult === null;
      const remand =
        round?.origin === 'NORMAL' &&
        round.sourceResult?.result === 'REMAND' &&
        round.sourceResult.externalEntryId === source.entryId &&
        round.sourceResult.revocation === null;
      if (!directRoot && !remand) throw this.conflict('INVALID_STATE');
      const lower = remand
        ? isoDate(round.sourceResult!.resultReceivedAt)
        : source.stageReachedOn;
      if (
        date < lower ||
        (directRoot &&
          source.known.acceptedOn !== null &&
          date < source.known.acceptedOn)
      )
        throw this.validation('受理更正日期不得早于真实来源日期');
    } else if (date < isoDate(record.filingSubmission.submittedAt))
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
      'paymentDueAt',
    ];
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length < keys.length - 1 ||
      Object.keys(input).length > keys.length ||
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
      ...keyDetailDate(input),
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

  private secondAcceptanceInput(
    input: SaveSecondInstanceAcceptanceDto,
  ): SecondAcceptanceValue {
    const keys = [
      'choiceId',
      'trialRoundId',
      'expectedAcceptanceRevision',
      'idempotencyKey',
      'acceptedAt',
      'courtCaseNo',
      'reason',
    ];
    if (
      input === null ||
      typeof input !== 'object' ||
      Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key)) ||
      (input.choiceId !== null &&
        (typeof input.choiceId !== 'string' || !uuid.test(input.choiceId))) ||
      typeof input.trialRoundId !== 'string' ||
      !uuid.test(input.trialRoundId) ||
      !Number.isSafeInteger(input.expectedAcceptanceRevision) ||
      input.expectedAcceptanceRevision < 0 ||
      !this.validKey(input.idempotencyKey) ||
      (input.acceptedAt !== null && typeof input.acceptedAt !== 'string') ||
      (input.courtCaseNo !== null && typeof input.courtCaseNo !== 'string') ||
      (input.reason !== null && typeof input.reason !== 'string')
    )
      throw this.validation('二审受理信息请求不合法');
    if (input.acceptedAt !== null) {
      const parsed = new Date(`${input.acceptedAt}T00:00:00.000Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/u.test(input.acceptedAt) ||
        Number.isNaN(parsed.getTime()) ||
        isoDate(parsed) !== input.acceptedAt ||
        input.acceptedAt > todayShanghai()
      )
        throw this.validation('二审受理日期不合法');
    }
    const courtCaseNo = input.courtCaseNo?.trim() || null;
    const reason = input.reason?.trim() || null;
    if (
      (courtCaseNo !== null && courtCaseNo.length > 100) ||
      (reason !== null && reason.length > 500)
    )
      throw this.validation('二审受理案号或原因超长');
    return {
      choiceId: input.choiceId,
      trialRoundId: input.trialRoundId,
      expectedAcceptanceRevision: input.expectedAcceptanceRevision,
      idempotencyKey: input.idempotencyKey,
      acceptedAt: input.acceptedAt,
      courtCaseNo,
      reason,
    };
  }

  private fingerprint(
    caseId: string,
    value:
      | ContactValue
      | AddDefendantValue
      | CaseTypesValue
      | ResponsibleValue
      | AcceptanceValue
      | SecondAcceptanceValue,
  ) {
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

  private secondAcceptanceReceipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): SaveSecondInstanceAcceptanceResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.caseId !== caseId ||
      (snapshot.choiceId !== null &&
        (typeof snapshot.choiceId !== 'string' ||
          !uuid.test(snapshot.choiceId))) ||
      typeof snapshot.trialRoundId !== 'string' ||
      !uuid.test(snapshot.trialRoundId) ||
      typeof snapshot.changeId !== 'string' ||
      !uuid.test(snapshot.changeId) ||
      typeof snapshot.acceptanceRevision !== 'number' ||
      !Number.isSafeInteger(snapshot.acceptanceRevision) ||
      snapshot.acceptanceRevision < 1 ||
      (snapshot.acceptedAt !== null &&
        typeof snapshot.acceptedAt !== 'string') ||
      (snapshot.courtCaseNo !== null &&
        typeof snapshot.courtCaseNo !== 'string') ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw this.conflict('RECEIPT_CORRUPT');
    return {
      caseId,
      choiceId: snapshot.choiceId,
      trialRoundId: snapshot.trialRoundId,
      changeId: snapshot.changeId,
      acceptanceRevision: snapshot.acceptanceRevision,
      acceptedAt: snapshot.acceptedAt,
      courtCaseNo: snapshot.courtCaseNo,
      recordedAt: snapshot.recordedAt,
    };
  }

  private defendantInput(input: AddCaseDefendantDto): AddDefendantValue {
    const name = input.name.trim();
    if (!name || name.length > 200)
      throw this.validation('被告名称不能为空且不超过200字符');
    const kind = input.kind;
    if (kind !== 'PERSON' && kind !== 'ORGANIZATION')
      throw this.validation('被告类型无效');
    const optional = (value: string | null | undefined, max: number) => {
      const trimmed = value?.trim() ?? '';
      if (trimmed.length > max) throw this.validation('被告信息超出长度上限');
      return trimmed || null;
    };
    return {
      kind,
      name,
      idNo: optional(input.idNo, 100),
      phone: optional(input.phone, 100),
      address: optional(input.address, 500),
      legalRepresentative: optional(input.legalRepresentative, 200),
      idempotencyKey: input.idempotencyKey,
    };
  }

  private defendantReceipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): AddCaseDefendantResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.caseId !== caseId ||
      typeof snapshot.defendantId !== 'string' ||
      typeof snapshot.contactRevision !== 'number' ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw this.conflict('INVALID_STATE');
    return {
      caseId,
      defendantId: snapshot.defendantId,
      contactRevision: snapshot.contactRevision,
      recordedAt: snapshot.recordedAt,
    };
  }

  private responsibleReceipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): ChangeResponsibleUserResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.caseId !== caseId ||
      typeof snapshot.responsibleUserId !== 'string' ||
      typeof snapshot.responsibilityEpoch !== 'number' ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw this.conflict('INVALID_STATE');
    return {
      caseId,
      responsibleUserId: snapshot.responsibleUserId,
      responsibilityEpoch: snapshot.responsibilityEpoch,
      recordedAt: snapshot.recordedAt,
    };
  }

  private async caseSourceLead(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<string | null> {
    const target = await tx.case.findFirst({
      where: { id: caseId },
      select: { sourceLeadId: true },
    });
    return target?.sourceLeadId ?? null;
  }

  private caseTypesReceipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): ChangeCaseTypesResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.caseId !== caseId ||
      typeof snapshot.leadId !== 'string' ||
      typeof snapshot.caseType !== 'string' ||
      !Array.isArray(snapshot.infringementTypes) ||
      typeof snapshot.affectedCaseCount !== 'number' ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw this.conflict('INVALID_STATE');
    return {
      caseId,
      leadId: snapshot.leadId,
      caseType: snapshot.caseType,
      infringementTypes: snapshot.infringementTypes.filter(
        (entry): entry is string => typeof entry === 'string',
      ),
      affectedCaseCount: snapshot.affectedCaseCount,
      recordedAt: snapshot.recordedAt,
    };
  }

  private defendantImmutable() {
    return new ConflictException({
      code: 'DEFENDANT_IMMUTABLE',
      message: '被告是案件审计主体，只能新增或更正联系方式，不能删除',
    });
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
