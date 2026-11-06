import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  normalizeRefundAmount,
  planRefundInventoryDraft,
  type RefundInventoryItem,
  type RefundInventorySnapshot,
} from './case-refund-inventory-draft.service';
import type {
  CorrectLitigationRefundInput,
  FollowLitigationRefundInput,
  LitigationRefundListQuery,
  LitigationRefundSourceType,
  LitigationRefundStatus,
  RegisterLitigationRefundInput,
} from './litigation-refunds.dto';

type Source = {
  type: LitigationRefundSourceType;
  id: string;
  trialRoundId: string;
  label: string;
  courtNo: string | null;
  valid: boolean;
};
export type LitigationRefundRow = {
  caseId: string;
  itemId: string;
  inventoryVersionId: string;
  caseNo: string;
  plaintiff: string;
  defendant: string;
  courtNo: string | null;
  lawyer: string | null;
  party: 'COURT' | 'DEFENDANT';
  amount: string | null;
  status: LitigationRefundStatus;
  description: string;
  remark: string | null;
  archived: boolean;
  archiveStatus: LitigationRefundStatus | null;
  canFollow: boolean;
  canRecord: boolean;
  source: Omit<Source, 'courtNo'> | null;
};
type Head = {
  versionId: string;
  priorVersionId: string | null;
  revision: number;
  declaration: 'UNKNOWN' | 'COMPLETE' | 'NOT_APPLICABLE';
};
type Item = RefundInventoryItem & {
  sourceType: LitigationRefundSourceType | null;
  sourceId: string | null;
  trialRoundId: string | null;
  remark: string | null;
};
type SourceMeta = Pick<
  Item,
  'sourceType' | 'sourceId' | 'trialRoundId' | 'remark'
>;

const caseInclude = {
  rightsHolder: { select: { name: true } },
  defendants: { select: { name: true }, orderBy: { id: 'asc' } },
  lawyers: {
    where: { role: 'PRIMARY', endedAt: null },
    select: { lawyer: { select: { fullName: true } } },
    orderBy: { startedAt: 'desc' },
  },
  trialRounds: { select: { id: true, sequence: true, revokedAt: true } },
  acceptances: {
    select: {
      trialRoundId: true,
      courtCaseNo: true,
      corrections: {
        select: { courtCaseNo: true, toRevision: true },
        orderBy: { toRevision: 'desc' },
      },
    },
  },
  secondInstanceAcceptanceChanges: {
    select: {
      choiceId: true,
      trialRoundId: true,
      courtCaseNo: true,
      toRevision: true,
    },
    orderBy: { toRevision: 'desc' },
  },
  judgmentFacts: {
    select: {
      id: true,
      kind: true,
      trialRoundId: true,
      judgmentReceivedAt: true,
    },
  },
  secondInstanceResults: {
    select: {
      id: true,
      trialRoundId: true,
      choiceId: true,
      resultReceivedAt: true,
      revocation: { select: { id: true } },
    },
  },
} as const satisfies Prisma.CaseInclude;
type CaseDetails = Prisma.CaseGetPayload<{ include: typeof caseInclude }>;
const error = (code: string) => new ConflictException({ code, message: code });
const denied = () => new ForbiddenException({ code: 'CASE_REFUND_FORBIDDEN' });
const missing = () => new NotFoundException({ code: 'CASE_REFUND_NOT_FOUND' });
const uuid = (value: string) => value.toLowerCase();
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function sourceFor(
  record: CaseDetails,
  sourceType: LitigationRefundSourceType,
  sourceId: string,
): Source | null {
  if (sourceType === 'JUDGMENT') {
    const fact = record.judgmentFacts.find((row) => row.id === sourceId);
    if (!fact) return null;
    const round = record.trialRounds.find(
      (row) => row.id === fact.trialRoundId,
    );
    const acceptance = record.acceptances.find(
      (row) => row.trialRoundId === fact.trialRoundId,
    );
    return {
      type: sourceType,
      id: fact.id,
      trialRoundId: fact.trialRoundId,
      label: `第${round?.sequence ?? '?'}轮一审判决 · ${fact.judgmentReceivedAt.toISOString().slice(0, 10)}`,
      courtNo:
        acceptance?.corrections[0]?.courtCaseNo ??
        acceptance?.courtCaseNo ??
        null,
      valid: fact.kind === 'REGISTER' && round?.revokedAt === null,
    };
  }
  const fact = record.secondInstanceResults.find((row) => row.id === sourceId);
  if (!fact) return null;
  const round = record.trialRounds.find((row) => row.id === fact.trialRoundId);
  const acceptance = record.secondInstanceAcceptanceChanges.find(
    (row) =>
      row.trialRoundId === fact.trialRoundId && row.choiceId === fact.choiceId,
  );
  return {
    type: sourceType,
    id: fact.id,
    trialRoundId: fact.trialRoundId,
    label: `第${round?.sequence ?? '?'}轮二审结果 · ${fact.resultReceivedAt.toISOString().slice(0, 10)}`,
    courtNo: acceptance?.courtCaseNo ?? null,
    valid: round?.revokedAt === null && fact.revocation === null,
  };
}

function project(
  record: CaseDetails,
  head: Head,
  item: Item,
  archiveStatuses: ReadonlyMap<string, LitigationRefundStatus>,
  canRecord: boolean,
  canFollow: boolean,
): LitigationRefundRow {
  const source =
    item.sourceType && item.sourceId
      ? sourceFor(record, item.sourceType, item.sourceId)
      : null;
  return {
    caseId: record.id,
    itemId: item.itemId,
    inventoryVersionId: head.versionId,
    caseNo: record.businessNo,
    plaintiff: record.rightsHolder.name,
    defendant: record.defendants.map((row) => row.name).join('、'),
    courtNo: source?.courtNo ?? null,
    lawyer: record.lawyers[0]?.lawyer.fullName ?? null,
    party: item.party,
    amount: normalizeRefundAmount(item.amount),
    status: item.status,
    description: item.description,
    remark: item.remark,
    archived: record.stage === 'ARCHIVED',
    archiveStatus: archiveStatuses.get(item.itemId) ?? null,
    canFollow,
    canRecord,
    source: source
      ? {
          type: source.type,
          id: source.id,
          trialRoundId: source.trialRoundId,
          label: source.label,
          valid: source.valid,
        }
      : null,
  };
}

@Injectable()
export class LitigationRefundsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  private async internal(actor: ActorContext, tx: Prisma.TransactionClient) {
    if (actor.clientCustomerId || actor.lawyerAccountId || actor.notaryOfficeId)
      throw denied();
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true, authorizationRevision: true },
    });
    if (
      !account?.active ||
      account.accountType !== 'INTERNAL' ||
      account.authorizationRevision !== actor.authorizationRevision
    )
      throw denied();
  }

  private async can(
    actor: ActorContext,
    action: 'case.read' | 'case.refund.record' | 'case.refund.follow',
    record: { responsibleUserId: string; departmentId: string },
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    try {
      await this.access.authorizeCase(actor, action, record, tx);
      return true;
    } catch (caught) {
      if (caught instanceof ForbiddenException) return false;
      throw caught;
    }
  }

  private async readAuthority(
    actor: ActorContext,
    tx: Prisma.TransactionClient,
  ) {
    await this.internal(actor, tx);
    await this.access.authorizeDepartmentAction(actor, 'case.refund.read', tx);
  }

  async context(actor: ActorContext) {
    return this.db.$transaction(async (tx) => {
      await this.internal(actor, tx);
      const capability = async (
        action: 'case.read' | 'case.refund.read' | 'case.refund.export',
      ) => {
        try {
          await this.access.authorizeDepartmentAction(actor, action, tx);
          return true;
        } catch (caught) {
          if (caught instanceof ForbiddenException) return false;
          throw caught;
        }
      };
      const facts = {
        responsibleUserId: actor.userId,
        departmentId: actor.departmentId,
      };
      const read =
        (await capability('case.refund.read')) &&
        (await this.can(actor, 'case.read', facts, tx));
      return {
        read,
        record:
          read && (await this.can(actor, 'case.refund.record', facts, tx)),
        follow:
          read && (await this.can(actor, 'case.refund.follow', facts, tx)),
        export: read && (await capability('case.refund.export')),
      };
    });
  }

  private async details(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      include: caseInclude,
    });
    if (!record) throw missing();
    return record;
  }

  private async latest(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    const heads = await tx.$queryRaw<Head[]>`
      SELECT id AS "versionId", prior_version_id AS "priorVersionId", revision, declaration
      FROM case_refund_inventory_versions
      WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid
      ORDER BY revision DESC LIMIT 1`;
    return heads[0] ?? null;
  }

  private async items(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    head: Head | null,
  ): Promise<Item[]> {
    if (!head) return [];
    const items = await tx.$queryRaw<Item[]>`
      SELECT i.item_id AS "itemId",i.party,i.status,i.description,
        a.amount::numeric(16,2)::text AS amount,
        m.source_type AS "sourceType",m.source_id AS "sourceId",
        m.trial_round_id AS "trialRoundId",m.remark
      FROM case_refund_inventory_items i
      LEFT JOIN case_refund_inventory_item_amounts a
        ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
      LEFT JOIN case_litigation_refund_item_meta m
        ON m.inventory_version_id=i.inventory_version_id AND m.item_id=i.item_id
      WHERE i.inventory_version_id=${head.versionId}::uuid AND i.case_id=${caseId}::uuid
        AND i.department_id=${actor.departmentId}::uuid
      ORDER BY i.item_id`;
    for (const item of items) {
      if (item.sourceId) continue;
      const ancestorMeta = await tx.$queryRaw<SourceMeta[]>`
        WITH RECURSIVE chain AS (
          SELECT v.id,v.prior_version_id,0 AS depth
          FROM case_refund_inventory_versions v
          JOIN case_refund_inventory_items i ON i.inventory_version_id=v.id
            AND i.item_id=${item.itemId}::uuid
          WHERE v.id=${head.versionId}::uuid AND v.case_id=${caseId}::uuid
            AND v.department_id=${actor.departmentId}::uuid
          UNION ALL
          SELECT parent.id,parent.prior_version_id,child.depth+1
          FROM chain child
          JOIN case_refund_inventory_versions parent ON parent.id=child.prior_version_id
          JOIN case_refund_inventory_items i ON i.inventory_version_id=parent.id
            AND i.item_id=${item.itemId}::uuid
          WHERE parent.case_id=${caseId}::uuid AND parent.department_id=${actor.departmentId}::uuid
        )
        SELECT m.source_type AS "sourceType",m.source_id AS "sourceId",
          m.trial_round_id AS "trialRoundId",m.remark
        FROM chain c JOIN case_litigation_refund_item_meta m
          ON m.inventory_version_id=c.id AND m.item_id=${item.itemId}::uuid
        ORDER BY c.depth LIMIT 1`;
      if (ancestorMeta.length > 0) {
        Object.assign(item, ancestorMeta[0]);
        continue;
      }
      const links = await tx.$queryRaw<
        { sourceType: string; sourceId: string }[]
      >`
        WITH RECURSIVE chain AS (
          SELECT v.id,v.prior_version_id
          FROM case_refund_inventory_versions v
          JOIN case_refund_inventory_items i ON i.inventory_version_id=v.id
            AND i.item_id=${item.itemId}::uuid
          WHERE v.id=${head.versionId}::uuid AND v.case_id=${caseId}::uuid
            AND v.department_id=${actor.departmentId}::uuid
          UNION ALL
          SELECT parent.id,parent.prior_version_id
          FROM chain child
          JOIN case_refund_inventory_versions parent ON parent.id=child.prior_version_id
          JOIN case_refund_inventory_items i ON i.inventory_version_id=parent.id
            AND i.item_id=${item.itemId}::uuid
          WHERE parent.case_id=${caseId}::uuid AND parent.department_id=${actor.departmentId}::uuid
        )
        SELECT s.source_type AS "sourceType",s.source_id AS "sourceId"
        FROM case_supplement_entries s
        JOIN chain c ON c.id=s.inventory_version_id
        WHERE s.case_id=${caseId}::uuid AND s.department_id=${actor.departmentId}::uuid
          AND s.kind='REFUND_SOURCE_LINK' AND s.inventory_item_id=${item.itemId}::uuid
          AND NOT EXISTS (SELECT 1 FROM case_supplement_entries correction
            WHERE correction.prior_entry_id=s.id)
        ORDER BY s.recorded_at DESC,s.id DESC`;
      if (
        links.length === 1 &&
        (links[0]!.sourceType === 'JUDGMENT' ||
          links[0]!.sourceType === 'SECOND_INSTANCE_RESULT')
      ) {
        item.sourceType = links[0]!.sourceType;
        item.sourceId = links[0]!.sourceId;
      }
    }
    return items;
  }

  private async archiveStatuses(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ): Promise<Map<string, LitigationRefundStatus>> {
    const versions = await tx.$queryRaw<{ versionId: string | null }[]>`
      SELECT refund_inventory_version_id AS "versionId"
      FROM case_archive_evidence_snapshots WHERE case_id=${caseId}::uuid
        AND department_id=${actor.departmentId}::uuid
      ORDER BY captured_at DESC,id DESC LIMIT 1`;
    if (!versions[0]?.versionId) return new Map();
    const rows = await tx.$queryRaw<
      { itemId: string; status: LitigationRefundStatus }[]
    >`
      SELECT item_id AS "itemId",status FROM case_refund_inventory_items
      WHERE inventory_version_id=${versions[0].versionId}::uuid`;
    return new Map(rows.map((row) => [row.itemId, row.status]));
  }

  private async workspaceInTransaction(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    await this.readAuthority(actor, tx);
    const record = await this.details(tx, actor, caseId);
    await this.access.authorizeCase(actor, 'case.read', record, tx);
    const [head, archived] = await Promise.all([
      this.latest(tx, actor, caseId),
      this.archiveStatuses(tx, actor, caseId),
    ]);
    const entries = await this.items(tx, actor, caseId, head);
    const canRecord =
      record.stage !== 'ARCHIVED' &&
      (await this.can(actor, 'case.refund.record', record, tx));
    const canFollow = await this.can(actor, 'case.refund.follow', record, tx);
    const sources: Source[] = [
      ...record.judgmentFacts.map((fact) =>
        sourceFor(record, 'JUDGMENT', fact.id),
      ),
      ...record.secondInstanceResults.map((fact) =>
        sourceFor(record, 'SECOND_INSTANCE_RESULT', fact.id),
      ),
    ].filter((source): source is Source => source?.valid === true);
    return {
      caseId,
      inventoryVersionId: head?.versionId ?? null,
      canRecord,
      canFollow,
      sources: sources.map((source) => ({
        type: source.type,
        id: source.id,
        trialRoundId: source.trialRoundId,
        label: source.label,
        courtNo: source.courtNo,
      })),
      items: head
        ? entries.map((item) =>
            project(record, head, item, archived, canRecord, canFollow),
          )
        : [],
    };
  }

  workspace(actor: ActorContext, caseId: string) {
    return this.db.$transaction(
      (tx) => this.workspaceInTransaction(tx, actor, uuid(caseId)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async item(actor: ActorContext, caseId: string, itemId: string) {
    const workspace = await this.workspace(actor, caseId);
    const row = workspace.items.find((entry) => entry.itemId === uuid(itemId));
    if (!row) throw missing();
    return row;
  }

  async list(
    actor: ActorContext,
    query: LitigationRefundListQuery,
    forExport = false,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.readAuthority(actor, tx);
        if (forExport)
          await this.access.authorizeDepartmentAction(
            actor,
            'case.refund.export',
            tx,
          );
        const heads = await tx.$queryRaw<
          { caseId: string; versionId: string }[]
        >`
        SELECT case_id AS "caseId",id AS "versionId"
        FROM case_refund_inventory_versions v
        WHERE department_id=${actor.departmentId}::uuid
          AND NOT EXISTS (SELECT 1 FROM case_refund_inventory_versions newer
            WHERE newer.case_id=v.case_id AND newer.department_id=v.department_id
              AND newer.revision>v.revision)
        ORDER BY case_id`;
        const rows: LitigationRefundRow[] = [];
        for (const headRef of heads) {
          const record = await this.details(tx, actor, headRef.caseId);
          if (!(await this.can(actor, 'case.read', record, tx))) continue;
          const workspace = await this.workspaceInTransaction(
            tx,
            actor,
            headRef.caseId,
          );
          rows.push(...workspace.items);
        }
        const includes = (value: string | null, term: string | undefined) =>
          !term?.trim() ||
          (value ?? '')
            .toLocaleLowerCase()
            .includes(term.trim().toLocaleLowerCase());
        const matching = rows
          .filter(
            (row) =>
              includes(row.plaintiff, query.plaintiff) &&
              includes(row.defendant, query.defendant) &&
              includes(row.courtNo, query.courtNo) &&
              includes(row.lawyer, query.lawyer) &&
              (!query.status || row.status === query.status),
          )
          .sort(
            (a, b) =>
              a.caseNo.localeCompare(b.caseNo) ||
              a.itemId.localeCompare(b.itemId),
          );
        const Decimal = Prisma.Decimal.clone({ precision: 36 });
        const sum = (selected: LitigationRefundRow[]) =>
          selected
            .reduce((total, row) => total.plus(row.amount ?? 0), new Decimal(0))
            .toFixed(2);
        const summary = {
          unrefundedAmount: sum(
            matching.filter((row) =>
              ['PENDING', 'SUBMITTED'].includes(row.status),
            ),
          ),
          unrefundedCount: matching.filter((row) =>
            ['PENDING', 'SUBMITTED'].includes(row.status),
          ).length,
          pendingSettlementAmount: sum(
            matching.filter((row) => row.status === 'RETURNED_UNSETTLED'),
          ),
          filteredAmount: sum(matching),
          unknownAmountCount: matching.filter((row) => row.amount === null)
            .length,
        };
        const time = await tx.$queryRaw<
          { asOf: Date }[]
        >`SELECT transaction_timestamp() AS "asOf"`;
        if (forExport && matching.length > 20000)
          throw new BadRequestException({ code: 'REFUND_EXPORT_TOO_LARGE' });
        return {
          items: forExport
            ? matching
            : matching.slice(
                (query.page - 1) * query.pageSize,
                query.page * query.pageSize,
              ),
          total: matching.length,
          page: query.page,
          pageSize: query.pageSize,
          summary,
          asOf: time[0]!.asOf.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  register(
    actor: ActorContext,
    caseId: string,
    input: RegisterLitigationRefundInput,
  ) {
    return this.write(
      actor,
      uuid(caseId),
      uuid(input.itemId),
      'REGISTER',
      input,
    );
  }

  correct(
    actor: ActorContext,
    caseId: string,
    itemId: string,
    input: CorrectLitigationRefundInput,
  ) {
    return this.write(actor, uuid(caseId), uuid(itemId), 'CORRECT', input);
  }

  follow(
    actor: ActorContext,
    caseId: string,
    itemId: string,
    input: FollowLitigationRefundInput,
  ) {
    return this.write(actor, uuid(caseId), uuid(itemId), 'FOLLOW', input);
  }

  async request(actor: ActorContext, caseId: string, key: string) {
    return this.db.$transaction(async (tx) => {
      await this.readAuthority(actor, tx);
      const record = await this.details(tx, actor, uuid(caseId));
      await this.access.authorizeCase(actor, 'case.read', record, tx);
      const rows = await tx.$queryRaw<
        { kind: 'REGISTER' | 'CORRECT' | 'FOLLOW'; resultSnapshot: unknown }[]
      >`
        SELECT kind,result_snapshot AS "resultSnapshot"
        FROM case_litigation_refund_commands
        WHERE case_id=${uuid(caseId)}::uuid AND department_id=${actor.departmentId}::uuid
          AND actor_user_id=${actor.userId}::uuid AND idempotency_key=${key}
        LIMIT 1`;
      const prior = rows[0];
      if (!prior) throw missing();
      const action =
        prior.kind === 'FOLLOW' ? 'case.refund.follow' : 'case.refund.record';
      await this.access.authorizeCase(actor, action, record, tx);
      return prior.resultSnapshot;
    });
  }

  private async write(
    actor: ActorContext,
    caseId: string,
    itemId: string,
    kind: 'REGISTER' | 'CORRECT' | 'FOLLOW',
    input:
      | RegisterLitigationRefundInput
      | CorrectLitigationRefundInput
      | FollowLitigationRefundInput,
  ) {
    const key = input.idempotencyKey;
    const expected = input.expectedInventoryVersionId;
    const normalized =
      kind === 'FOLLOW'
        ? {
            status: (input as FollowLitigationRefundInput).status,
            remark:
              (input as FollowLitigationRefundInput).remark?.trim() || null,
            reason:
              (input as FollowLitigationRefundInput).reason?.trim() || null,
          }
        : {
            sourceType: (input as RegisterLitigationRefundInput).sourceType,
            sourceId: uuid((input as RegisterLitigationRefundInput).sourceId),
            party: (input as RegisterLitigationRefundInput).party,
            amount: normalizeRefundAmount(
              (input as RegisterLitigationRefundInput).amount,
            ),
            description: (
              input as RegisterLitigationRefundInput
            ).description.trim(),
            reason: (input as RegisterLitigationRefundInput).reason.trim(),
          };
    const requestFingerprint = fingerprint([
      'LITIGATION_REFUND_V1',
      kind,
      caseId,
      itemId,
      expected,
      normalized,
    ]);
    try {
      return await this.db.$transaction(
        async (tx) => {
          await lockCustomerActorFacts(tx, this.organization, actor);
          await this.internal(actor, tx);
          const locks = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cases WHERE id=${caseId}::uuid
            AND department_id=${actor.departmentId}::uuid FOR UPDATE`;
          if (locks.length !== 1) throw missing();
          const record = await this.details(tx, actor, caseId);
          const action =
            kind === 'FOLLOW' ? 'case.refund.follow' : 'case.refund.record';
          await this.access.authorizeCase(actor, 'case.read', record, tx);
          await this.access.authorizeCase(actor, action, record, tx);
          if (record.stage === 'ARCHIVED' && kind !== 'FOLLOW')
            throw error('REFUND_ARCHIVED_REGISTRATION_CLOSED');

          const prior = await tx.$queryRaw<
            { requestFingerprint: string; resultSnapshot: unknown }[]
          >`
          SELECT request_fingerprint AS "requestFingerprint",
            result_snapshot AS "resultSnapshot"
          FROM case_litigation_refund_commands
          WHERE department_id=${actor.departmentId}::uuid
            AND actor_user_id=${actor.userId}::uuid AND idempotency_key=${key}
          LIMIT 1`;
          if (prior[0]) {
            if (prior[0].requestFingerprint !== requestFingerprint)
              throw error('IDEMPOTENCY_CONFLICT');
            return prior[0].resultSnapshot;
          }

          const head = await this.latest(tx, actor, caseId);
          if ((head?.versionId ?? null) !== expected)
            throw error('REFUND_INVENTORY_CHANGED');
          const oldItems = await this.items(tx, actor, caseId, head);
          const current = oldItems.find((item) => item.itemId === itemId);
          if (kind === 'REGISTER') {
            if (current) throw error('REFUND_ITEM_EXISTS');
            const reused = await tx.$queryRaw<{ id: string }[]>`
            SELECT item_id AS id FROM case_refund_inventory_items
            WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid
              AND item_id=${itemId}::uuid LIMIT 1`;
            if (reused.length) throw error('REFUND_ITEM_ID_REUSED');
          } else if (!current) throw missing();
          if (
            record.stage === 'ARCHIVED' &&
            kind === 'FOLLOW' &&
            !(input as FollowLitigationRefundInput).reason?.trim()
          )
            throw new BadRequestException({
              code: 'REFUND_ARCHIVED_REASON_REQUIRED',
            });

          let changed: Item;
          if (kind === 'FOLLOW') {
            const follow = input as FollowLitigationRefundInput;
            changed = {
              ...current!,
              status: follow.status,
              remark: follow.remark?.trim() || null,
            };
          } else {
            const registration = input as RegisterLitigationRefundInput;
            const source = sourceFor(
              record,
              registration.sourceType,
              uuid(registration.sourceId),
            );
            if (!source?.valid) throw error('REFUND_SOURCE_NOT_EFFECTIVE');
            changed = {
              itemId,
              party: registration.party,
              status: current?.status ?? 'PENDING',
              description: registration.description.trim(),
              amount: normalizeRefundAmount(registration.amount),
              sourceType: source.type,
              sourceId: source.id,
              trialRoundId: source.trialRoundId,
              remark: current?.remark ?? null,
            };
          }
          const nextItems =
            kind === 'REGISTER'
              ? [...oldItems, changed]
              : oldItems.map((item) =>
                  item.itemId === itemId ? changed : item,
                );
          const previous: RefundInventorySnapshot | null = head
            ? {
                id: head.versionId,
                caseId,
                departmentId: actor.departmentId,
                revision: head.revision,
                declaration: head.declaration,
                items: oldItems,
              }
            : null;
          const planned = planRefundInventoryDraft(previous, {
            caseId,
            expectedVersionId: head?.versionId ?? null,
            kind: 'RECORD',
            items: nextItems,
          });
          const commandId = randomUUID();
          const versionId = randomUUID();
          const auditEventId = randomUUID();
          const timestamp = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          const recordedAt = timestamp[0]!.now;
          const newHead: Head = {
            versionId,
            priorVersionId: head?.versionId ?? null,
            revision: (head?.revision ?? 0) + 1,
            declaration: planned.declaration,
          };
          const archive = await this.archiveStatuses(tx, actor, caseId);
          const canRecord =
            record.stage !== 'ARCHIVED' &&
            (await this.can(actor, 'case.refund.record', record, tx));
          const canFollow = await this.can(
            actor,
            'case.refund.follow',
            record,
            tx,
          );
          const row = project(
            record,
            newHead,
            changed,
            archive,
            canRecord,
            canFollow,
          );
          const result = {
            commandId,
            inventoryVersionId: versionId,
            item: row,
          };
          const reason = (normalized as { reason: string | null }).reason;

          await tx.auditEvent.create({
            data: {
              id: auditEventId,
              departmentId: actor.departmentId,
              actorKind: 'HUMAN',
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'CASE_REFUND_INVENTORY_VERSION',
              resourceId: versionId,
              action: 'CASE_REFUND_INVENTORY_RECORD',
              details: {
                requestFingerprint,
                authorizationRevision: actor.authorizationRevision,
                commandId,
                kind,
                reason,
              },
            },
          });
          await tx.$executeRaw`
          INSERT INTO case_litigation_refund_commands(
            id,case_id,department_id,actor_user_id,item_id,kind,prior_version_id,
            inventory_version_id,reason,idempotency_key,request_fingerprint,
            result_snapshot,recorded_at)
          VALUES (${commandId}::uuid,${caseId}::uuid,${actor.departmentId}::uuid,
            ${actor.userId}::uuid,${itemId}::uuid,${kind},${head?.versionId ?? null}::uuid,
            ${versionId}::uuid,${reason},${key},${requestFingerprint},
            ${JSON.stringify(result)}::jsonb,${recordedAt})`;
          await tx.$executeRaw`
          INSERT INTO case_refund_inventory_versions(
            id,case_id,department_id,revision,prior_version_id,declaration,
            recorded_by_user_id,recorded_at,audit_event_id)
          VALUES (${versionId}::uuid,${caseId}::uuid,${actor.departmentId}::uuid,
            ${newHead.revision},${head?.versionId ?? null}::uuid,${newHead.declaration},
            ${actor.userId}::uuid,${recordedAt},${auditEventId}::uuid)`;
          for (const item of nextItems) {
            const info: SourceMeta =
              item.itemId === itemId
                ? changed
                : {
                    sourceType: item.sourceType,
                    sourceId: item.sourceId,
                    trialRoundId: item.trialRoundId,
                    remark: item.remark,
                  };
            if (info.sourceType && info.sourceId && !info.trialRoundId) {
              const source = sourceFor(record, info.sourceType, info.sourceId);
              info.trialRoundId = source?.trialRoundId ?? null;
            }
            if (!info.trialRoundId) {
              info.sourceType = null;
              info.sourceId = null;
            }
            await tx.$executeRaw`
            INSERT INTO case_refund_inventory_items(
              inventory_version_id,item_id,case_id,department_id,party,status,description)
            VALUES (${versionId}::uuid,${item.itemId}::uuid,${caseId}::uuid,
              ${actor.departmentId}::uuid,${item.party},${item.status},${item.description})`;
            await tx.$executeRaw`
            INSERT INTO case_refund_inventory_item_amounts(inventory_version_id,item_id,amount)
            VALUES (${versionId}::uuid,${item.itemId}::uuid,${normalizeRefundAmount(item.amount)}::numeric)`;
            await tx.$executeRaw`
            INSERT INTO case_litigation_refund_item_meta(
              inventory_version_id,item_id,source_type,source_id,trial_round_id,remark)
            VALUES (${versionId}::uuid,${item.itemId}::uuid,${info.sourceType},
              ${info.sourceId}::uuid,${info.trialRoundId}::uuid,${info.remark})`;
          }
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(caught.code)
      )
        throw error('REFUND_INVENTORY_CHANGED');
      throw caught;
    }
  }
}
