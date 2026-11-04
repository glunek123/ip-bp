import { AccessControlService } from '../../access-control/access-control.service';
import { createHash, randomUUID } from 'node:crypto';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { OrganizationService } from '../../access-control/organization.service';
import { Prisma } from '../../generated/prisma/client';
import type { DatabaseService } from '../../database/database.service';
import type { ActorContext } from '../../access-control/actor-context';
import {
  CaseRefundInventoryDraftService,
  type RefundInventoryDraftCommand,
  type RefundInventoryDraftTransaction,
  type RefundInventorySnapshot,
  reviewRefundInventoryDraft,
  reviewRefundInventoryLegacy,
  normalizeRefundAmount,
} from './case-refund-inventory-draft.service';

type Result = Awaited<ReturnType<CaseRefundInventoryDraftService['execute']>>;
const compositionTokens = new WeakMap<
  object,
  {
    db: Prisma.TransactionClient;
    fingerprint: string;
    parentKey: string;
    key: string;
    caseId: string;
    actorUserId: string;
    departmentId: string;
  }
>();
/** Internal capability for the parent coordinator only. Never decode this from a DTO.
 * Parent migration 1600 must bind the returned child version, actor and total hash
 * to its exact total receipt/audit before the shared transaction can commit. */
export function createRefundCompositionContext(
  db: Prisma.TransactionClient,
  parent: {
    fingerprint: string;
    idempotencyKey: string;
    caseId: string;
    actorUserId: string;
    departmentId: string;
  },
): { context: object; idempotencyKey: string } {
  if (
    !/^[0-9a-f]{64}$/u.test(parent.fingerprint) ||
    !/^\S(?:[\s\S]{0,126}\S)?$/u.test(parent.idempotencyKey)
  )
    fail('INVALID_REFUND_COMPOSITION_CONTEXT');
  const key = `refund:${createHash('sha256').update(parent.idempotencyKey, 'utf8').digest('hex')}`;
  const context = Object.freeze({});
  compositionTokens.set(context, {
    db,
    fingerprint: parent.fingerprint,
    parentKey: parent.idempotencyKey,
    key,
    caseId: parent.caseId.toLowerCase(),
    actorUserId: parent.actorUserId.toLowerCase(),
    departmentId: parent.departmentId.toLowerCase(),
  });
  return { context, idempotencyKey: key };
}
/** Cast PostgreSQL void to text so Prisma never deserializes an unsupported void column. */
export async function validateRefundSnapshotInTransaction(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  versionId: string,
): Promise<void> {
  await db.$queryRaw<
    { validated: string }[]
  >`SELECT "validate_case_refund_inventory_snapshot"(${versionId}::uuid)::text AS validated`;
}
export function normalizeRefundDraftCommand(
  command: RefundInventoryDraftCommand,
): RefundInventoryDraftCommand {
  const base = {
    caseId: command.caseId.toLowerCase(),
    expectedVersionId: command.expectedVersionId?.toLowerCase() ?? null,
  };
  if (command.kind === 'CONFIRM_COMPLETE')
    return { ...base, kind: command.kind };
  const items = command.items.map((item) => ({
    ...item,
    itemId: item.itemId.toLowerCase(),
    ...(item.amount === undefined
      ? {}
      : { amount: normalizeRefundAmount(item.amount) }),
  }));
  if (new Set(items.map((item) => item.itemId)).size !== items.length)
    fail('INVALID_REFUND_ITEM_ID');
  return { ...base, kind: command.kind, items };
}
function fail(code: string): never {
  throw new Error(code);
}
function decodeSnapshot(value: unknown): RefundInventorySnapshot {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('caseId' in value) ||
    typeof value.caseId !== 'string' ||
    !('departmentId' in value) ||
    typeof value.departmentId !== 'string' ||
    !('revision' in value) ||
    !Number.isSafeInteger(value.revision) ||
    !('declaration' in value) ||
    !['UNKNOWN', 'COMPLETE', 'NOT_APPLICABLE'].includes(
      String(value.declaration),
    ) ||
    !('items' in value) ||
    !Array.isArray(value.items)
  )
    fail('INVALID_REFUND_SOURCE');
  const items: RefundInventorySnapshot['items'][number][] = [];
  for (const item of value.items) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('itemId' in item) ||
      typeof item.itemId !== 'string' ||
      !('description' in item) ||
      typeof item.description !== 'string' ||
      !('party' in item) ||
      (item.party !== 'COURT' && item.party !== 'DEFENDANT') ||
      !('status' in item)
    )
      fail('INVALID_REFUND_SOURCE');
    const status: unknown = item.status;
    if (
      status !== 'UNKNOWN' &&
      status !== 'PENDING' &&
      status !== 'SUBMITTED' &&
      status !== 'RETURNED_UNSETTLED' &&
      status !== 'SETTLED' &&
      status !== 'RECEIVED' &&
      status !== 'CONVERTED_TO_COST'
    )
      fail('INVALID_REFUND_SOURCE');
    if (
      'amount' in item &&
      item.amount !== null &&
      typeof item.amount !== 'string'
    )
      fail('INVALID_REFUND_AMOUNT');
    items.push({
      itemId: item.itemId,
      description: item.description,
      party: item.party,
      status,
      ...('amount' in item
        ? { amount: normalizeRefundAmount(item.amount) }
        : {}),
    });
  }
  const declaration = value.declaration;
  if (
    declaration !== 'UNKNOWN' &&
    declaration !== 'COMPLETE' &&
    declaration !== 'NOT_APPLICABLE'
  )
    fail('INVALID_REFUND_SOURCE');
  if (typeof value.revision !== 'number' || value.revision < 1)
    fail('INVALID_REFUND_SOURCE');
  const snapshot: RefundInventorySnapshot = {
    id: value.id,
    caseId: value.caseId,
    departmentId: value.departmentId,
    revision: value.revision,
    declaration,
    items,
  };
  reviewRefundInventoryDraft(snapshot);
  return snapshot;
}

/** Transaction adapter. Default operator authority is active INTERNAL + current membership,
 * same department, own case and current authorization revision; no application grant.
 */
export class CaseRefundInventoryPrismaDraft {
  constructor(
    private readonly database: Pick<DatabaseService, '$transaction'>,
    private readonly organization: OrganizationService,
    private readonly access: AccessControlService,
  ) {}

  async execute(
    actor: ActorContext,
    command: RefundInventoryDraftCommand,
    idempotencyKey: string,
  ): Promise<Result> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
          (db) => this.executeInTransaction(db, actor, command, idempotencyKey),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt < 2 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' ||
            error.code === 'P2002' ||
            (error.code === 'P2010' &&
              (error.meta?.code === '40001' ||
                error.meta?.code === '23505' ||
                error.meta?.code === '40P01' ||
                error.meta?.code === '55P03')))
        )
          continue;
        throw error;
      }
    }
  }
  /** Caller owns the existing Serializable transaction, rollback and whole-command retry.
   * This entry never starts or commits a nested transaction. */
  async executeInTransaction(
    db: Prisma.TransactionClient,
    actor: ActorContext,
    command: RefundInventoryDraftCommand,
    idempotencyKey: string,
    compositionContext?: object,
  ): Promise<Result> {
    command = normalizeRefundDraftCommand(command);
    actor = {
      ...actor,
      userId: actor.userId.toLowerCase(),
      departmentId: actor.departmentId.toLowerCase(),
    };
    if (!/^\S(?:[\s\S]{0,126}\S)?$/u.test(idempotencyKey))
      fail('INVALID_IDEMPOTENCY_KEY');
    const composition = compositionContext
      ? compositionTokens.get(compositionContext)
      : undefined;
    if (
      compositionContext &&
      (!composition ||
        composition.db !== db ||
        composition.key !== idempotencyKey ||
        composition.caseId !== command.caseId ||
        composition.actorUserId !== actor.userId ||
        composition.departmentId !== actor.departmentId)
    )
      fail('INVALID_REFUND_COMPOSITION_CONTEXT');
    const legacyFingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          command.caseId,
          command.expectedVersionId,
          command.kind,
          command.kind === 'CONFIRM_COMPLETE'
            ? null
            : [...command.items]
                .sort((a, b) => a.itemId.localeCompare(b.itemId))
                .map((i) => [i.itemId, i.party, i.status, i.description]),
        ]),
      )
      .digest('hex');
    let fingerprint =
      composition?.fingerprint ??
      createHash('sha256')
        .update(
          JSON.stringify([
            command.caseId,
            command.expectedVersionId,
            command.kind,
            command.kind === 'CONFIRM_COMPLETE'
              ? null
              : [...command.items]
                  .sort((a, b) => a.itemId.localeCompare(b.itemId))
                  .map((i) => [
                    i.itemId,
                    i.party,
                    i.status,
                    i.description,
                    normalizeRefundAmount(i.amount),
                  ]),
            'refund-item-amounts-v1',
          ]),
        )
        .digest('hex');
    const authorize = async () => {
      if (
        actor.clientCustomerId ||
        actor.notaryOfficeId ||
        actor.lawyerAccountId
      )
        fail('ACTION_FORBIDDEN');
      await lockCustomerActorFacts(db, this.organization, actor);
      const users = await db.$queryRaw<
        {
          active: boolean;
          account_type: string;
          authorization_revision: number;
        }[]
      >`SELECT active,account_type,authorization_revision FROM user_accounts WHERE id=${actor.userId}::uuid FOR UPDATE`;
      const user = users[0];
      if (
        !user?.active ||
        user.account_type !== 'INTERNAL' ||
        user.authorization_revision !== actor.authorizationRevision
      )
        fail('ACTION_FORBIDDEN');
      const members = await db.$queryRaw<
        { active: boolean; team_id: string | null }[]
      >`SELECT m.active,CASE WHEN t.status='ACTIVE' THEN m.team_id ELSE NULL END AS team_id FROM department_memberships m LEFT JOIN teams t ON t.id=m.team_id AND t.department_id=m.department_id WHERE m.user_id=${actor.userId}::uuid AND m.department_id=${actor.departmentId}::uuid FOR UPDATE OF m`;
      if (!members[0]?.active) fail('ACTION_FORBIDDEN');
      const cases = await db.$queryRaw<
        { id: string; responsible_user_id: string }[]
      >`SELECT id,responsible_user_id FROM cases WHERE id=${command.caseId}::uuid AND department_id=${actor.departmentId}::uuid FOR UPDATE`;
      if (cases.length !== 1) fail('ACTION_FORBIDDEN');
      if (cases[0].responsible_user_id !== actor.userId) {
        if (!composition) fail('ACTION_FORBIDDEN');
        await this.access.authorizeDepartmentAction(
          actor,
          'case.closure.settlement.update',
          db,
        );
      }
      await this.access.authorizeCase(
        actor,
        'case.read',
        {
          departmentId: actor.departmentId,
          responsibleUserId: cases[0].responsible_user_id,
          ...(members[0].team_id ? { teamId: members[0].team_id } : {}),
        },
        db,
      );
    };
    await authorize();
    const receipts = await db.$queryRaw<
      { request_fingerprint: string; result_snapshot: unknown }[]
    >`SELECT request_fingerprint,result_snapshot FROM case_refund_inventory_receipts WHERE department_id=${actor.departmentId}::uuid AND actor_user_id=${actor.userId}::uuid AND idempotency_key=${idempotencyKey}`;
    const bindParent = async (versionId: string, replay = false) => {
      if (composition && replay) {
        const existing = await db.$queryRaw<
          { valid: boolean }[]
        >`SELECT true AS valid FROM case_settlement_update_child_links WHERE kind='REFUND' AND child_version_id=${versionId}::uuid AND case_id=${command.caseId}::uuid AND department_id=${actor.departmentId}::uuid AND actor_user_id=${actor.userId}::uuid AND parent_key=${composition.parentKey} AND request_fingerprint=${fingerprint}`;
        if (existing.length !== 1) fail('INVALID_REFUND_COMPOSITION_BINDING');
        return;
      }
      if (composition)
        await db.$executeRaw`INSERT INTO case_settlement_update_child_links(kind,child_version_id,case_id,department_id,actor_user_id,parent_key,request_fingerprint) VALUES ('REFUND',${versionId}::uuid,${command.caseId}::uuid,${actor.departmentId}::uuid,${actor.userId}::uuid,${composition.parentKey},${fingerprint})`;
    };
    if (receipts[0]) {
      if (
        receipts[0].request_fingerprint !== fingerprint &&
        !composition &&
        receipts[0].request_fingerprint === legacyFingerprint &&
        (command.kind === 'CONFIRM_COMPLETE' ||
          command.items.every((i) => i.amount === undefined))
      ) {
        const legacy = await db.$queryRaw<
          { valid: boolean }[]
        >`SELECT true AS valid FROM case_refund_inventory_receipts r WHERE r.department_id=${actor.departmentId}::uuid AND r.actor_user_id=${actor.userId}::uuid AND r.idempotency_key=${idempotencyKey} AND NOT EXISTS(SELECT 1 FROM case_refund_inventory_item_amounts a WHERE a.inventory_version_id=r.inventory_version_id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.result_snapshot#>'{snapshot,items}') i WHERE i ? 'amount')`;
        if (legacy.length === 1) fingerprint = legacyFingerprint;
      }
      if (receipts[0].request_fingerprint !== fingerprint)
        fail('IDEMPOTENCY_CONFLICT');
      const result = receipts[0].result_snapshot;
      if (
        typeof result !== 'object' ||
        result === null ||
        !('draft' in result) ||
        result.draft !== true ||
        !('snapshot' in result) ||
        !('readiness' in result)
      )
        fail('INVALID_REFUND_RECEIPT');
      const snapshot = decodeSnapshot(result.snapshot);
      const bindings = await db.$queryRaw<
        { valid: boolean }[]
      >`SELECT true AS valid FROM case_refund_inventory_receipts r JOIN case_refund_inventory_versions v ON v.id=r.inventory_version_id JOIN audit_events a ON a.id=r.audit_event_id WHERE r.department_id=${actor.departmentId}::uuid AND r.actor_user_id=${actor.userId}::uuid AND r.idempotency_key=${idempotencyKey} AND v.id=${snapshot.id}::uuid AND v.case_id=${command.caseId}::uuid AND v.department_id=${actor.departmentId}::uuid AND v.recorded_by_user_id=${actor.userId}::uuid AND v.audit_event_id=a.id AND a.department_id=v.department_id AND a.actor_kind='HUMAN' AND a.actor_user_id=r.actor_user_id AND a.internal_actor_user_id=r.actor_user_id AND a.resource_type='CASE_REFUND_INVENTORY_VERSION' AND a.resource_id=v.id AND a.action IN ('CASE_REFUND_INVENTORY_RECORD','CASE_REFUND_INVENTORY_CONFIRM') AND a.details->>'requestFingerprint'=${fingerprint} AND ((r.result_snapshot->'snapshot') - 'items')=jsonb_build_object('id',v.id,'caseId',v.case_id,'departmentId',v.department_id,'revision',v.revision,'declaration',v.declaration) AND (SELECT coalesce(jsonb_agg(value ORDER BY value->>'itemId'),'[]'::jsonb) FROM jsonb_array_elements(r.result_snapshot#>'{snapshot,items}'))=refund_inventory_items_projection_268(v.id,EXISTS(SELECT 1 FROM case_refund_inventory_item_amounts am WHERE am.inventory_version_id=v.id))`;
      if (bindings.length !== 1) fail('INVALID_REFUND_RECEIPT');
      const receiptReadiness = snapshot.items.some(
        (i) => i.amount !== undefined,
      )
        ? reviewRefundInventoryDraft(snapshot)
        : reviewRefundInventoryLegacy(snapshot);
      if (
        snapshot.caseId !== command.caseId ||
        snapshot.departmentId !== actor.departmentId ||
        result.readiness !== receiptReadiness
      )
        fail('INVALID_REFUND_RECEIPT');
      await bindParent(snapshot.id, true);
      return {
        draft: true,
        snapshot,
        readiness: receiptReadiness,
      };
    }
    const cases = await db.case.findUnique({
      where: { id: command.caseId },
      select: { stage: true },
    });
    if (cases?.stage !== 'WAITING_ARCHIVE') fail('INVALID_STAGE');
    const times = await db.$queryRaw<
      { recorded_at: Date }[]
    >`SELECT clock_timestamp() AS recorded_at`;
    const recordedAt = times[0]?.recorded_at;
    if (!(recordedAt instanceof Date) || !Number.isFinite(recordedAt.getTime()))
      fail('INVALID_DATABASE_TIME');
    const tx: RefundInventoryDraftTransaction = {
      authorizeInternalOperatorAndLockCase: authorize,
      latest: async () => {
        const rows = await db.$queryRaw<
          { snapshot: unknown }[]
        >`SELECT jsonb_build_object('id',v.id,'caseId',v.case_id,'departmentId',v.department_id,'revision',v.revision,'declaration',v.declaration,'items',refund_inventory_items_projection_268(v.id,true)) AS snapshot FROM case_refund_inventory_versions v WHERE v.case_id=${command.caseId}::uuid AND v.department_id=${actor.departmentId}::uuid ORDER BY v.revision DESC LIMIT 1`;
        return rows[0] ? decodeSnapshot(rows[0].snapshot) : null;
      },
      audit: async (input) => {
        await db.auditEvent.create({
          data: {
            id: input.id,
            departmentId: actor.departmentId,
            actorKind: 'HUMAN',
            actorUserId: actor.userId,
            internalActorUserId: actor.userId,
            resourceType: 'CASE_REFUND_INVENTORY_VERSION',
            resourceId: input.versionId,
            action: input.action,
            details: {
              requestFingerprint: fingerprint,
              authorizationRevision: actor.authorizationRevision,
              caseId: command.caseId,
            },
          },
        });
      },
      append: async (s) => {
        await db.$executeRaw`INSERT INTO case_refund_inventory_versions(id,case_id,department_id,revision,prior_version_id,declaration,recorded_by_user_id,recorded_at,audit_event_id) VALUES (${s.id}::uuid,${s.caseId}::uuid,${s.departmentId}::uuid,${s.revision},${s.priorVersionId}::uuid,${s.declaration},${s.recordedByUserId}::uuid,${recordedAt},${s.auditEventId}::uuid)`;
        for (const i of s.items) {
          await db.$executeRaw`INSERT INTO case_refund_inventory_items(inventory_version_id,item_id,case_id,department_id,party,status,description) VALUES (${s.id}::uuid,${i.itemId}::uuid,${s.caseId}::uuid,${s.departmentId}::uuid,${i.party},${i.status},${i.description})`;
          await db.$executeRaw`INSERT INTO case_refund_inventory_item_amounts(inventory_version_id,item_id,amount) VALUES (${s.id}::uuid,${i.itemId}::uuid,${normalizeRefundAmount(i.amount)}::numeric)`;
        }
        await validateRefundSnapshotInTransaction(db, s.id);
      },
    };
    const result = await new CaseRefundInventoryDraftService({
      serializable: async (work) => work(tx),
    }).execute(
      actor,
      command.kind === 'CONFIRM_COMPLETE'
        ? command
        : {
            ...command,
            items: command.items.map((i) => ({
              ...i,
              amount: normalizeRefundAmount(i.amount),
            })),
          },
    );
    await db.$executeRaw`INSERT INTO case_refund_inventory_receipts(id,department_id,actor_user_id,case_id,inventory_version_id,audit_event_id,idempotency_key,request_fingerprint,result_snapshot,created_at) SELECT ${randomUUID()}::uuid,${actor.departmentId}::uuid,${actor.userId}::uuid,${command.caseId}::uuid,v.id,v.audit_event_id,${idempotencyKey},${fingerprint},${JSON.stringify(result)}::jsonb,${recordedAt} FROM case_refund_inventory_versions v WHERE v.id=${result.snapshot.id}::uuid`;
    await bindParent(result.snapshot.id);
    return result;
  }
}
