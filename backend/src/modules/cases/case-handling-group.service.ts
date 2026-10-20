import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  CreateCaseHandlingGroupDto,
  DissolveCaseHandlingGroupDto,
  CaseHandlingGroupResultDto,
  isHandlingGroupKey,
} from './case-handling-group.dto';
import {
  authorizeHandlingCases,
  handlingGroupNotFound,
  requireHandlingInternal,
} from './case-handling-group.read';

type Command = 'CREATE' | 'DISSOLVE';
type CreateRequest = {
  groupId: string;
  caseIds: string[];
  idempotencyKey: string;
};
type DissolveRequest = {
  groupId: string;
  expectedRevision: number;
  idempotencyKey: string;
};
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR' });
const conflict = (code: string) => new ConflictException({ code });
const corrupt = () =>
  new InternalServerErrorException({ code: 'INVALID_RECEIPT' });
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const groupInclude = {
  members: { orderBy: { caseId: 'asc' }, select: { caseId: true } },
} satisfies Prisma.CaseHandlingGroupInclude;
const receiptInclude = {
  event: true,
} satisfies Prisma.CaseHandlingGroupReceiptInclude;
const sourceSelect = {
  id: true,
  departmentId: true,
  customerId: true,
  responsibleMembership: { select: { teamId: true } },
} satisfies Prisma.CaseSelect;
type Group = Prisma.CaseHandlingGroupGetPayload<{
  include: typeof groupInclude;
}>;
type Receipt = Prisma.CaseHandlingGroupReceiptGetPayload<{
  include: typeof receiptInclude;
}>;

function createRequest(input: unknown): CreateRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw invalid();
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    typeof value.groupId !== 'string' ||
    !isUUID(value.groupId) ||
    !isHandlingGroupKey(value.idempotencyKey) ||
    !Array.isArray(value.caseIds) ||
    value.caseIds.length < 2 ||
    value.caseIds.length > 20 ||
    value.caseIds.some((id: unknown) => typeof id !== 'string' || !isUUID(id))
  )
    throw invalid();
  const caseIds = (value.caseIds as string[])
    .map((id) => id.toLowerCase())
    .sort();
  if (new Set(caseIds).size !== caseIds.length) throw invalid();
  return {
    groupId: value.groupId.toLowerCase(),
    caseIds,
    idempotencyKey: value.idempotencyKey,
  };
}
function dissolveRequest(groupId: string, input: unknown): DissolveRequest {
  if (
    !isUUID(groupId) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    throw invalid();
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    !isHandlingGroupKey(value.idempotencyKey) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    value.expectedRevision > 2147483646
  )
    throw invalid();
  return {
    groupId: groupId.toLowerCase(),
    expectedRevision: value.expectedRevision,
    idempotencyKey: value.idempotencyKey,
  };
}
function savedRequest(
  command: Command,
  receipt: Receipt,
): CreateRequest | DissolveRequest {
  try {
    if (command === 'CREATE') return createRequest(receipt.originalRequest);
    const value = receipt.originalRequest;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3 ||
      typeof value.groupId !== 'string'
    )
      throw corrupt();
    return dissolveRequest(value.groupId, {
      expectedRevision: value.expectedRevision,
      idempotencyKey: value.idempotencyKey,
    });
  } catch {
    throw corrupt();
  }
}
function retryable(error: unknown, depth = 0): boolean {
  if (depth > 8 || !error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;
  if (
    value.code === 'P2034' ||
    value.code === 'P2002' ||
    value.originalCode === '40001' ||
    value.sqlState === '40001'
  )
    return true;
  return ['cause', 'meta', 'driverAdapterError'].some((key) =>
    retryable(value[key], depth + 1),
  );
}

@Injectable()
export class CaseHandlingGroupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}
  create(
    actor: ActorContext,
    input: CreateCaseHandlingGroupDto,
  ): Promise<CaseHandlingGroupResultDto> {
    return this.execute(actor, 'CREATE', createRequest(input));
  }
  dissolve(
    actor: ActorContext,
    groupId: string,
    input: DissolveCaseHandlingGroupDto,
  ): Promise<CaseHandlingGroupResultDto> {
    return this.execute(actor, 'DISSOLVE', dissolveRequest(groupId, input));
  }

  private async execute(
    actor: ActorContext,
    command: Command,
    requested: CreateRequest | DissolveRequest,
  ): Promise<CaseHandlingGroupResultDto> {
    const requestedFingerprint = fingerprint({ command, ...requested });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const displayName = await requireHandlingInternal(tx, actor);
            const prior = await tx.caseHandlingGroupReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  command,
                  idempotencyKey: requested.idempotencyKey,
                },
              },
              include: receiptInclude,
            });
            if (
              prior &&
              (prior.departmentId !== actor.departmentId ||
                prior.actorUserId !== actor.userId ||
                prior.command !== command ||
                prior.idempotencyKey !== requested.idempotencyKey)
            )
              throw corrupt();
            const original = prior ? savedRequest(command, prior) : requested;
            if (
              prior &&
              (prior.groupId !== original.groupId ||
                prior.idempotencyKey !== original.idempotencyKey)
            )
              throw corrupt();
            await tx.$queryRawUnsafe(
              'SELECT "id" FROM "case_handling_groups" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
              original.groupId,
              actor.departmentId,
            );
            const group = await tx.caseHandlingGroup.findFirst({
              where: { id: original.groupId, departmentId: actor.departmentId },
              include: groupInclude,
            });
            if ((command === 'DISSOLVE' || prior) && !group)
              throw handlingGroupNotFound();
            const ids =
              'caseIds' in original
                ? original.caseIds
                : group!.members.map(({ caseId }) => caseId).sort();
            if (
              ids.length < 2 ||
              ids.length > 20 ||
              new Set(ids).size !== ids.length
            )
              throw corrupt();
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "department_id"=$1::uuid AND "id"=ANY($2::uuid[]) ORDER BY "id"::text FOR UPDATE',
              actor.departmentId,
              ids,
            );
            if (locked.length !== ids.length) throw handlingGroupNotFound();
            const cases = await tx.case.findMany({
              where: { departmentId: actor.departmentId, id: { in: ids } },
              select: sourceSelect,
              orderBy: { id: 'asc' },
            });
            if (
              cases.length !== ids.length ||
              cases.some(
                (record) => record.departmentId !== actor.departmentId,
              ) ||
              new Set(cases.map(({ id }) => id.toLowerCase())).size !==
                ids.length ||
              cases.some(({ id }) => !ids.includes(id.toLowerCase()))
            )
              throw handlingGroupNotFound();
            await authorizeHandlingCases(
              tx,
              this.access,
              actor,
              command === 'CREATE'
                ? 'case.group.create'
                : 'case.group.dissolve',
              cases,
            );
            if (prior)
              return this.replay(prior, group!, original, requestedFingerprint);
            if (new Set(cases.map(({ customerId }) => customerId)).size !== 1)
              throw conflict('CASE_GROUP_CUSTOMER_MISMATCH');
            const customerId = cases[0]!.customerId;
            if (group && group.customerId !== customerId) throw corrupt();
            if (command === 'CREATE' && group)
              throw conflict('CASE_HANDLING_GROUP_CONFLICT');
            if (command === 'DISSOLVE') {
              if (
                !('expectedRevision' in original) ||
                group!.revision !== original.expectedRevision
              )
                throw conflict('VERSION_CONFLICT');
              if (group!.status !== 'ACTIVE' || group!.revision !== 1)
                throw conflict('CASE_HANDLING_GROUP_CONFLICT');
            }
            const recordedAt = new Date();
            const revision = command === 'CREATE' ? 1 : 2;
            const status = command === 'CREATE' ? 'ACTIVE' : 'DISSOLVED';
            if (command === 'CREATE') {
              await tx.caseHandlingGroup.create({
                data: {
                  id: original.groupId,
                  departmentId: actor.departmentId,
                  customerId,
                  revision,
                  status,
                  createdAt: recordedAt,
                },
              });
              const added = await tx.caseHandlingGroupMember.createMany({
                data: ids.map((caseId) => ({
                  groupId: original.groupId,
                  caseId,
                  departmentId: actor.departmentId,
                  customerId,
                })),
              });
              if (added.count !== ids.length)
                throw conflict('CASE_HANDLING_GROUP_CONFLICT');
            } else {
              const changed = await tx.caseHandlingGroup.updateMany({
                where: {
                  id: original.groupId,
                  departmentId: actor.departmentId,
                  revision: 1,
                  status: 'ACTIVE',
                },
                data: { revision, status, dissolvedAt: recordedAt },
              });
              if (changed.count !== 1) throw conflict('VERSION_CONFLICT');
            }
            const beforeCaseIds = command === 'CREATE' ? [] : ids;
            const afterCaseIds = command === 'CREATE' ? ids : [];
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'case-handling-group',
                resourceId: original.groupId,
                action:
                  command === 'CREATE'
                    ? 'case.group.created'
                    : 'case.group.dissolved',
                details: {
                  groupId: original.groupId,
                  fromRevision: revision - 1,
                  toRevision: revision,
                  beforeCaseIds,
                  afterCaseIds,
                },
              },
            });
            const eventId = randomUUID();
            await tx.caseHandlingGroupEvent.create({
              data: {
                id: eventId,
                groupId: original.groupId,
                departmentId: actor.departmentId,
                revision,
                status,
                beforeCaseIds,
                afterCaseIds,
                actorUserId: actor.userId,
                actorDisplayNameSnapshot: displayName,
                recordedAt,
                auditEventId: audit.id,
              },
            });
            const result: CaseHandlingGroupResultDto = {
              id: original.groupId,
              revision,
              status,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseHandlingGroupReceipt.create({
              data: {
                groupId: original.groupId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                command,
                idempotencyKey: original.idempotencyKey,
                requestFingerprint: requestedFingerprint,
                originalRequest: { ...original },
                resultSnapshot: { ...result },
                eventId,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable', timeout: 15_000 },
        );
      } catch (error) {
        if (retryable(error)) {
          if (attempt < 2) continue;
          throw conflict('VERSION_CONFLICT');
        }
        throw error;
      }
    }
    throw conflict('VERSION_CONFLICT');
  }

  private replay(
    receipt: Receipt,
    group: Group,
    original: CreateRequest | DissolveRequest,
    requestedFingerprint: string,
  ): CaseHandlingGroupResultDto {
    const event = receipt.event;
    const expectedRevision = receipt.command === 'CREATE' ? 1 : 2;
    const expectedStatus =
      receipt.command === 'CREATE' ? 'ACTIVE' : 'DISSOLVED';
    const memberIds = group.members.map(({ caseId }) => caseId).sort();
    if (
      receipt.requestFingerprint !==
        fingerprint({ command: receipt.command, ...original }) ||
      event.id !== receipt.eventId ||
      event.groupId !== receipt.groupId ||
      event.departmentId !== receipt.departmentId ||
      event.actorUserId !== receipt.actorUserId ||
      event.revision !== expectedRevision ||
      event.status !== expectedStatus ||
      event.recordedAt.toISOString() !==
        (expectedRevision === 1
          ? group.createdAt
          : group.dissolvedAt
        )?.toISOString() ||
      ('caseIds' in original &&
        JSON.stringify(original.caseIds) !== JSON.stringify(memberIds)) ||
      JSON.stringify(
        expectedRevision === 1 ? event.afterCaseIds : event.beforeCaseIds,
      ) !== JSON.stringify(memberIds) ||
      (expectedRevision === 1 ? event.beforeCaseIds : event.afterCaseIds)
        .length !== 0
    )
      throw corrupt();
    if (receipt.requestFingerprint !== requestedFingerprint)
      throw conflict('IDEMPOTENCY_CONFLICT');
    const result = receipt.resultSnapshot;
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      Object.keys(result).length !== 4 ||
      result.id !== receipt.groupId ||
      result.revision !== expectedRevision ||
      result.status !== expectedStatus ||
      result.recordedAt !== event.recordedAt.toISOString()
    )
      throw corrupt();
    return {
      id: receipt.groupId,
      revision: expectedRevision,
      status: expectedStatus,
      recordedAt: event.recordedAt.toISOString(),
    };
  }
}
