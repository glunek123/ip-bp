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
import { MatchCaseDto, MatchCaseResponseDto } from './case-match.dto';

@Injectable()
export class CaseMatchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async match(
    actor: ActorContext,
    caseId: string,
    input: MatchCaseDto,
  ): Promise<MatchCaseResponseDto> {
    const normalized = this.normalize(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({ caseId, ...normalized, idempotencyKey: undefined }),
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
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            try {
              await this.access.authorizeCase(
                actor,
                'case.match',
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
            const prior = await tx.caseMatchReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: normalized.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.idempotencyConflict();
              const snapshot =
                prior.resultSnapshot as Partial<MatchCaseResponseDto>;
              if (
                snapshot.id !== caseId ||
                snapshot.stage !== 'WAITING_COMPLAINT' ||
                !Number.isInteger(snapshot.version) ||
                typeof snapshot.matchedAt !== 'string' ||
                (typeof snapshot.matchedOn !== 'string' &&
                  !(
                    snapshot.matchedOn === undefined &&
                    normalized.matchedOn === undefined
                  ))
              )
                throw this.corruptReceipt();
              return {
                ...snapshot,
                matchedOn: snapshot.matchedOn ?? null,
              } as MatchCaseResponseDto;
            }
            if (normalized.matchedOn === undefined) throw this.validation();
            if (record.stage !== 'PENDING_MATCH') throw this.invalidState();
            if (record.version !== normalized.expectedVersion)
              throw this.versionConflict();
            const matchedAt = new Date();
            const changed = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'PENDING_MATCH',
                version: normalized.expectedVersion,
              },
              data: {
                stage: 'WAITING_COMPLAINT',
                version: { increment: 1 },
                matchedAt,
                matchedOn: new Date(`${normalized.matchedOn}T00:00:00.000Z`),
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await tx.caseDefendant.createMany({
              data: normalized.defendants.map((party) => ({
                caseId,
                departmentId: actor.departmentId,
                ...party,
              })),
            });
            const lawyer = await tx.lawyerProfile.create({
              data: {
                ...normalized.lawyer,
                lawFirm: normalized.lawyer.lawFirm ?? null,
                departmentId: actor.departmentId,
              },
              select: { id: true },
            });
            await tx.caseLawyerAssignment.create({
              data: {
                caseId,
                departmentId: actor.departmentId,
                lawyerId: lawyer.id,
                role: 'PRIMARY',
                startedAt: matchedAt,
              },
            });
            const result: MatchCaseResponseDto = {
              id: caseId,
              stage: 'WAITING_COMPLAINT',
              version: normalized.expectedVersion + 1,
              matchedAt: matchedAt.toISOString(),
              matchedOn: normalized.matchedOn,
            };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.match.succeeded',
                details: {
                  fromVersion: normalized.expectedVersion,
                  toVersion: result.version,
                  defendantCount: normalized.defendants.length,
                  lawyerProfileId: lawyer.id,
                  matchedOn: normalized.matchedOn,
                },
              },
            });
            await tx.caseMatchReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                idempotencyKey: normalized.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: {
                  id: result.id,
                  stage: result.stage,
                  version: result.version,
                  matchedAt: result.matchedAt,
                  matchedOn: result.matchedOn,
                },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < 2) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) throw this.idempotencyConflict();
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: MatchCaseDto): MatchCaseDto {
    const clean = (
      value: unknown,
      max: number,
      required: boolean,
    ): string | undefined => {
      if (value === undefined && !required) return undefined;
      if (
        typeof value !== 'string' ||
        value.trim() !== value ||
        value.length > max ||
        (required && value.length === 0) ||
        (!required && value.length === 0)
      )
        throw this.validation();
      return value;
    };
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Array.isArray(input.defendants) ||
      input.defendants.length < 1 ||
      input.defendants.length > 20 ||
      input.lawyer === null ||
      typeof input.lawyer !== 'object'
    )
      throw this.validation();
    const idempotencyKey = clean(input.idempotencyKey, 128, true)!;
    const matchedOn = clean(input.matchedOn, 10, false);
    if (matchedOn !== undefined) {
      const parsedDate = new Date(`${matchedOn}T00:00:00.000Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/u.test(matchedOn) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== matchedOn ||
        matchedOn > this.todayShanghai()
      )
        throw this.validation();
    }
    const defendants = input.defendants.map((party) => {
      if (
        party === null ||
        typeof party !== 'object' ||
        !['PERSON', 'ORGANIZATION'].includes(party.kind)
      )
        throw this.validation();
      return {
        kind: party.kind,
        name: clean(party.name, 200, true)!,
        idNo: clean(party.idNo, 100, false),
        phone: clean(party.phone, 100, false),
        address: clean(party.address, 500, false),
      };
    });
    const lawyer = {
      fullName: clean(input.lawyer.fullName, 200, true)!,
      lawFirm: clean(input.lawyer.lawFirm, 200, false),
      phone: clean(input.lawyer.phone, 100, false),
    };
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey,
      matchedOn,
      defendants,
      lawyer,
    };
  }
  private todayShanghai(): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const value = (type: string) =>
      parts.find((part) => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '案件匹配参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权匹配案件',
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
      message: '案件当前不能匹配',
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
      message: '幂等键已用于不同案件匹配请求',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '案件匹配回执不可用',
    });
  }
  private isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  private isSerializationConflict(error: unknown): boolean {
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
      value.code === 'P2034' ||
      value.code === '40001' ||
      value.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      value.meta?.driverAdapterError?.cause?.sqlState === '40001' ||
      this.isSerializationConflict(value.cause)
    );
  }
}
