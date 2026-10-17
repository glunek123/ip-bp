import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { DatabaseService } from '../../database/database.service';
import {
  Prisma,
  type EvidenceGroupVersion,
} from '../../generated/prisma/client';
import type {
  BulkEvidenceStatusDto,
  CreateEvidenceSourceGroupDto,
  EvidenceGroupQueryDto,
  EvidenceListQueryDto,
  ExportEvidenceDto,
  SaveEvidenceGroupDto,
} from './evidence.dto';
import {
  planEvidenceBulkStatus,
  planEvidenceGroupChange,
  planEvidenceSourceCreation,
  type EvidenceChangePlan,
} from './evidence-change-plan';
import {
  assertEvidenceCommandReplay,
  evidenceCommandFingerprint,
  type EvidenceCommand,
} from './evidence-command';
import {
  assertEvidenceFilter,
  evidenceCounts,
  matchesEvidenceFilter,
} from './evidence-rules';
import {
  evidenceGroupInclude,
  projectEvidenceGroup,
  type EvidenceGroupRecord,
  type EvidenceGroupView,
} from './evidence-read-model';
import {
  listEvidenceSources,
  readEvidenceSource,
  type EvidenceSourceProjection,
} from './evidence-source-read';
import { evidenceSourceKey } from './evidence-source-rules';
import type { EvidenceSourceKind } from './evidence-source-contract';
import { initializeNotaryEvidence } from './initialize-notary-evidence';
import { selectedEvidenceCsv } from './evidence-export';

type Tx = Prisma.TransactionClient;
type Action =
  | 'evidence.read'
  | 'evidence.edit'
  | 'evidence.bulk-status'
  | 'evidence.export';
type GroupResult = { changed: boolean; group: EvidenceGroupView };
type BulkResult = { changedEvidence: number; changedPaperCertificates: number };
const missing = () =>
  new NotFoundException({
    code: 'EVIDENCE_NOT_FOUND',
    message: '未找到可操作的证物记录或来源',
  });
const conflict = (code = 'EVIDENCE_VERSION_CONFLICT') =>
  new ConflictException({
    code,
    message: '证物或原请求已经变化，请核对后重试',
  });
const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message });
function snapshot(value: object): Prisma.InputJsonObject {
  // Only our explicit database facts and public DTOs enter this serializer; dates become ISO strings.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
function retryable(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 3) return false;
  const row = error as {
    code?: unknown;
    cause?: unknown;
    meta?: {
      code?: unknown;
      databaseErrorCode?: unknown;
      driverAdapterError?: {
        cause?: { originalCode?: unknown; sqlState?: unknown };
      };
    };
  };
  return (
    ['P2034', 'P2002', '55P03', '40001', '40P01'].some((code) =>
      [
        row.code,
        row.meta?.code,
        row.meta?.databaseErrorCode,
        row.meta?.driverAdapterError?.cause?.originalCode,
        row.meta?.driverAdapterError?.cause?.sqlState,
      ].includes(code),
    ) || retryable(row.cause, depth + 1)
  );
}
function ruleError(error: unknown): never {
  if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED')
    throw conflict('IDEMPOTENCY_KEY_REUSED');
  if (error instanceof Error && error.message === 'EVIDENCE_VERSION_CONFLICT')
    throw conflict();
  if (
    error instanceof Error &&
    [
      'INVALID_EVIDENCE_ROW',
      'INVALID_PAPER_CERTIFICATE',
      'INVALID_EVIDENCE_SELECTION',
      'PAPER_CERTIFICATE_SELECTION_REQUIRED',
      'INVALID_EVIDENCE_DATE',
      'INVALID_EVIDENCE_DATE_RANGE',
    ].includes(error.message)
  )
    throw invalid('证物选择、日期或编辑字段无效');
  throw error;
}

@Injectable()
export class EvidenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  private async authorize(tx: Tx, actor: ActorContext, action: Action) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '仅内部账号可操作证物台账',
      });
    const user = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (!user?.active || user.accountType !== 'INTERNAL')
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '内部账号已失效',
      });
    await this.access.authorizeDepartmentAction(actor, action, tx);
  }

  private async read<T>(
    actor: ActorContext,
    action: Action,
    run: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(
      async (tx) => {
        await this.authorize(tx, actor, action);
        try {
          return await run(tx);
        } catch (error) {
          return ruleError(error);
        }
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }

  private async command<T>(
    actor: ActorContext,
    action: Action,
    key: string,
    run: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!key || key.trim() !== key || key.length > 128)
      throw invalid('Idempotency-Key 无效');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await lockCustomerActorFacts(tx, this.organization, actor);
            await this.authorize(tx, actor, action);
            return run(tx);
          },
          { isolationLevel: 'Serializable', timeout: 20000 },
        );
      } catch (error) {
        if (retryable(error)) {
          if (attempt < 2) continue;
          throw conflict();
        }
        return ruleError(error);
      }
    }
    throw conflict();
  }

  private async lockSource(
    tx: Tx,
    actor: ActorContext,
    source: EvidenceSourceProjection,
  ) {
    const rows =
      source.sourceKind === 'CASE'
        ? await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM cases WHERE id = ${source.sourceId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`
        : await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM notary_matters WHERE id = ${source.sourceId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (rows.length !== 1) throw missing();
  }

  private async groupRecord(
    tx: Tx,
    actor: ActorContext,
    id: string,
  ): Promise<EvidenceGroupRecord> {
    const group = await tx.evidenceGroupVersion.findFirst({
      where: { id, departmentId: actor.departmentId },
      include: evidenceGroupInclude,
    });
    if (!group) throw missing();
    return group;
  }

  private async lockedGroup(tx: Tx, actor: ActorContext, id: string) {
    const before = await this.groupRecord(tx, actor, id);
    const initialSource = await readEvidenceSource(
      tx,
      actor.departmentId,
      before.sourceKind,
      before.sourceId,
    );
    await this.lockSource(tx, actor, initialSource);
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM evidence_group_versions WHERE id = ${id}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (locked.length !== 1) throw missing();
    const group = await this.groupRecord(tx, actor, id);
    const source = await readEvidenceSource(
      tx,
      actor.departmentId,
      group.sourceKind,
      group.sourceId,
    );
    return { group, source };
  }

  private async view(
    tx: Tx,
    group: EvidenceGroupRecord | null,
    source: EvidenceSourceProjection,
  ) {
    const keeperIds = [
      ...new Set(
        group?.items.flatMap((item) =>
          item.keeperUserId ? [item.keeperUserId] : [],
        ) ?? [],
      ),
    ];
    const keepers = keeperIds.length
      ? await tx.userAccount.findMany({
          where: {
            id: { in: keeperIds },
            memberships: { some: { departmentId: source.departmentId } },
          },
          select: { id: true, displayName: true },
        })
      : [];
    return projectEvidenceGroup(
      group,
      source,
      new Map(keepers.map((user) => [user.id, user.displayName])),
    );
  }

  private async prior(
    tx: Tx,
    actor: ActorContext,
    key: string,
    command: EvidenceCommand,
    fingerprint: string,
  ) {
    const prior = await tx.evidenceCommandReceipt.findUnique({
      where: {
        departmentId_actorUserId_idempotencyKey: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          idempotencyKey: key,
        },
      },
    });
    if (!prior) return null;
    assertEvidenceCommandReplay(prior, command, fingerprint);
    return prior.resultSnapshot;
  }
  private async receipt(
    tx: Tx,
    actor: ActorContext,
    key: string,
    command: EvidenceCommand,
    fingerprint: string,
    result: object,
  ) {
    await tx.evidenceCommandReceipt.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        command,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        resultSnapshot: snapshot(result),
      },
    });
  }
  private replayGroup(value: Prisma.JsonValue): GroupResult {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.changed !== 'boolean' ||
      !value.group ||
      typeof value.group !== 'object' ||
      Array.isArray(value.group) ||
      !Array.isArray(value.group.items) ||
      !Array.isArray(value.group.paperCertificates)
    )
      throw new InternalServerErrorException({
        code: 'INVALID_EVIDENCE_RECEIPT',
        message: '证物原请求回执不完整',
      });
    // Immutable server-written receipt; its operation, fingerprint and current source authorization were checked first.
    return value as unknown as GroupResult;
  }

  async list(actor: ActorContext, query: EvidenceListQueryDto) {
    return this.read(actor, 'evidence.read', async (tx) => {
      assertEvidenceFilter(query);
      const [groups, sources] = await Promise.all([
        tx.evidenceGroupVersion.findMany({
          where: { departmentId: actor.departmentId },
          include: evidenceGroupInclude,
        }),
        listEvidenceSources(tx, actor.departmentId),
      ]);
      const sourceMap = new Map(
        sources.map((source) => [evidenceSourceKey(source), source]),
      );
      const rows = [];
      for (const group of groups) {
        const source = sourceMap.get(evidenceSourceKey(group));
        if (!source) throw missing();
        const view = await this.view(tx, group, source);
        const timestamps = new Map(
          group.items.map((item) => [item.id, item.createdAt.getTime()]),
        );
        for (const item of view.items)
          rows.push({
            item,
            timestamp: timestamps.get(item.id) ?? 0,
            secondHearingOn: source.secondHearingOn,
          });
      }
      rows.sort(
        (left, right) =>
          right.timestamp - left.timestamp ||
          left.item.id.localeCompare(right.item.id),
      );
      const filtered = rows.filter((row) =>
        matchesEvidenceFilter(
          { ...row.item, secondHearingOn: row.secondHearingOn },
          query,
        ),
      );
      return {
        items: filtered
          .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
          .map((row) => row.item),
        total: filtered.length,
        page: query.page,
        pageSize: query.pageSize,
        counts: evidenceCounts(
          rows.map((row) => ({
            ...row.item,
            secondHearingOn: row.secondHearingOn,
          })),
          query,
        ),
      };
    });
  }

  async matchingIds(actor: ActorContext, query: EvidenceListQueryDto) {
    // One read transaction supplies the entire matching collection, independent of table pagination.
    return this.read(actor, 'evidence.read', async (tx) => {
      assertEvidenceFilter(query);
      const [items, sources] = await Promise.all([
        tx.evidenceItem.findMany({
          where: { departmentId: actor.departmentId, removedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
        listEvidenceSources(tx, actor.departmentId),
      ]);
      const bySource = new Map(
        sources.map((source) => [evidenceSourceKey(source), source]),
      );
      return {
        ids: items
          .filter((item) => {
            const source = bySource.get(evidenceSourceKey(item));
            if (!source) throw missing();
            return matchesEvidenceFilter(
              {
                id: item.id,
                caseId: source.case.id,
                status: item.status,
                stage: source.case.stage,
                hearingOn: source.hearingOn,
                secondHearingOn: source.secondHearingOn,
                closedOn: source.closedOn,
                lawyerName: source.case.lawyerName,
              },
              query,
            );
          })
          .map((item) => item.id),
      };
    });
  }

  async groups(actor: ActorContext, query: EvidenceGroupQueryDto) {
    return this.read(actor, 'evidence.read', async (tx) => {
      const [sources, groups] = await Promise.all([
        listEvidenceSources(tx, actor.departmentId),
        tx.evidenceGroupVersion.findMany({
          where: { departmentId: actor.departmentId },
          select: {
            id: true,
            sourceKind: true,
            sourceId: true,
            version: true,
            _count: { select: { items: { where: { removedAt: null } } } },
          },
        }),
      ]);
      const bySource = new Map(
        groups.map((group) => [evidenceSourceKey(group), group]),
      );
      const text = query.query?.trim().toLocaleLowerCase() ?? '';
      const filtered = sources.filter(
        (source) =>
          !text ||
          [
            source.businessNo,
            source.sourceBusinessNo,
            source.case.shopName,
            source.case.caseNo,
          ].some((value) => value?.toLocaleLowerCase().includes(text)),
      );
      return {
        items: filtered
          .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
          .map((source) => {
            const group = bySource.get(evidenceSourceKey(source));
            return {
              groupId: group?.id ?? null,
              groupVersion: group?.version ?? 0,
              sourceKind: source.sourceKind,
              sourceId: source.sourceId,
              sourceVersion: source.sourceVersion,
              caseId: source.case.id,
              businessNo: source.businessNo,
              shopName: source.case.shopName,
              activeItemCount: group?._count.items ?? 0,
            };
          }),
        total: filtered.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async group(actor: ActorContext, groupId: string) {
    return this.read(actor, 'evidence.read', async (tx) => {
      const group = await this.groupRecord(tx, actor, groupId);
      return this.view(
        tx,
        group,
        await readEvidenceSource(
          tx,
          actor.departmentId,
          group.sourceKind,
          group.sourceId,
        ),
      );
    });
  }
  async itemGroup(actor: ActorContext, itemId: string) {
    return this.read(actor, 'evidence.read', async (tx) => {
      const item = await tx.evidenceItem.findFirst({
        where: {
          id: itemId,
          departmentId: actor.departmentId,
          removedAt: null,
        },
        select: { groupId: true },
      });
      if (!item) throw missing();
      const group = await this.groupRecord(tx, actor, item.groupId);
      return this.view(
        tx,
        group,
        await readEvidenceSource(
          tx,
          actor.departmentId,
          group.sourceKind,
          group.sourceId,
        ),
      );
    });
  }
  async sourceGroup(
    actor: ActorContext,
    kind: EvidenceSourceKind,
    sourceId: string,
  ) {
    return this.read(actor, 'evidence.read', async (tx) => {
      const source = await readEvidenceSource(
        tx,
        actor.departmentId,
        kind,
        sourceId,
      );
      const group = await tx.evidenceGroupVersion.findUnique({
        where: {
          departmentId_sourceKind_sourceId: {
            departmentId: actor.departmentId,
            sourceKind: source.sourceKind,
            sourceId: source.sourceId,
          },
        },
        include: evidenceGroupInclude,
      });
      return this.view(tx, group, source);
    });
  }

  private async audit(
    tx: Tx,
    actor: ActorContext,
    groupId: string,
    operation: string,
    before: object | null,
    after: object,
    itemId?: string,
    paperCertificateId?: string,
  ) {
    await tx.evidenceAuditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        groupId,
        operation,
        itemId,
        paperCertificateId,
        ...(before ? { beforeSnapshot: snapshot(before) } : {}),
        afterSnapshot: snapshot(after),
      },
    });
  }
  private async alignCase(
    tx: Tx,
    actor: ActorContext,
    group: EvidenceGroupRecord,
    source: EvidenceSourceProjection,
  ): Promise<boolean> {
    if (group.caseId === source.case.id) return false;
    if (group.caseId !== null || source.case.id === null)
      throw conflict('EVIDENCE_SOURCE_MISMATCH');
    const [items, papers] = await Promise.all([
      tx.evidenceItem.findMany({
        where: { groupId: group.id, departmentId: actor.departmentId },
      }),
      tx.evidencePaperCertificate.findMany({
        where: { groupId: group.id, departmentId: actor.departmentId },
      }),
    ]);
    await tx.evidenceGroupVersion.update({
      where: { id: group.id },
      data: { caseId: source.case.id, version: { increment: 1 } },
    });
    await tx.evidenceItem.updateMany({
      where: { groupId: group.id, departmentId: actor.departmentId },
      data: {
        caseId: source.case.id,
        version: { increment: 1 },
        updatedByUserId: actor.userId,
      },
    });
    await tx.evidencePaperCertificate.updateMany({
      where: { groupId: group.id, departmentId: actor.departmentId },
      data: {
        caseId: source.case.id,
        version: { increment: 1 },
        updatedByUserId: actor.userId,
      },
    });
    await this.audit(
      tx,
      actor,
      group.id,
      'LINK_SOURCE_CASE',
      { group, items, papers },
      {
        caseId: source.case.id,
        itemIds: items.map((item) => item.id),
        paperCertificateIds: papers.map((paper) => paper.id),
      },
    );
    return true;
  }

  private async applyPlan(
    tx: Tx,
    actor: ActorContext,
    group: EvidenceGroupRecord,
    source: EvidenceSourceProjection,
    plan: EvidenceChangePlan,
    incrementGroup = true,
  ) {
    if (!plan.changed) return;
    if (incrementGroup)
      await tx.evidenceGroupVersion.update({
        where: { id: group.id },
        data: { version: { increment: 1 } },
      });
    for (const id of plan.removedIds) {
      const before = group.items.find((item) => item.id === id);
      const after = await tx.evidenceItem.update({
        where: { id },
        data: {
          removedAt: new Date(),
          version: { increment: 1 },
          updatedByUserId: actor.userId,
        },
      });
      await this.audit(
        tx,
        actor,
        group.id,
        'REMOVE_ITEM',
        before ?? null,
        after,
        id,
      );
    }
    for (const next of plan.updated) {
      const before = group.items.find((item) => item.id === next.id);
      const after = await tx.evidenceItem.update({
        where: { id: next.id },
        data: {
          displayCode: next.displayCode,
          shelfLocation: next.shelfLocation,
          status: next.status,
          remark: next.remark,
          version: { increment: 1 },
          updatedByUserId: actor.userId,
        },
      });
      await this.audit(
        tx,
        actor,
        group.id,
        'EDIT_ITEM',
        before ?? null,
        after,
        after.id,
      );
    }
    const base = group.items[0];
    for (const next of plan.created) {
      const after = await tx.evidenceItem.create({
        data: {
          departmentId: actor.departmentId,
          groupId: group.id,
          sourceKind: group.sourceKind,
          sourceId: group.sourceId,
          sourceNotaryMatterId: group.sourceNotaryMatterId,
          caseId: source.case.id,
          displayCode: next.displayCode,
          shelfLocation: next.shelfLocation,
          status: next.status,
          remark: next.remark,
          name: base?.name ?? source.case.shopName,
          kind: base?.kind ?? null,
          collectedOn:
            base?.collectedOn ?? source.certificate?.evidenceAt ?? null,
          provenance:
            base?.provenance ??
            (source.sourceKind === 'NOTARY_MATTER'
              ? 'notary.certificate_issued'
              : null),
          keeperUserId: base?.keeperUserId ?? null,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.audit(tx, actor, group.id, 'ADD_ITEM', null, after, after.id);
    }
    for (const next of plan.paperUpdates) {
      const before = group.paperCertificates.find(
        (paper) => paper.id === next.id,
      );
      const after = await tx.evidencePaperCertificate.update({
        where: { id: next.id },
        data: {
          status: next.status,
          version: { increment: 1 },
          updatedByUserId: actor.userId,
        },
      });
      await this.audit(
        tx,
        actor,
        group.id,
        'EDIT_PAPER_STATUS',
        before ?? null,
        after,
        undefined,
        after.id,
      );
    }
  }

  async saveGroup(
    actor: ActorContext,
    groupId: string,
    key: string,
    input: SaveEvidenceGroupDto,
  ): Promise<GroupResult> {
    return this.command(actor, 'evidence.edit', key, async (tx) => {
      const { group: original, source } = await this.lockedGroup(
        tx,
        actor,
        groupId,
      );
      const fingerprint = evidenceCommandFingerprint(
        'EDIT_GROUP',
        groupId,
        input,
      );
      const prior = await this.prior(tx, actor, key, 'EDIT_GROUP', fingerprint);
      if (prior !== null) return this.replayGroup(prior);
      if (original.version !== input.expectedGroupVersion) throw conflict();
      const aligned = await this.alignCase(tx, actor, original, source);
      const group = aligned
        ? await this.groupRecord(tx, actor, groupId)
        : original;
      const plan = planEvidenceGroupChange(
        {
          version: input.expectedGroupVersion,
          items: group.items,
          paperCertificates: group.paperCertificates,
        },
        input,
      );
      await this.applyPlan(tx, actor, group, source, plan);
      const result = {
        changed: aligned || plan.changed,
        group: await this.view(
          tx,
          await this.groupRecord(tx, actor, groupId),
          source,
        ),
      };
      if (result.changed)
        await this.receipt(tx, actor, key, 'EDIT_GROUP', fingerprint, result);
      return result;
    });
  }

  private async initializeFromSource(tx: Tx, source: EvidenceSourceProjection) {
    const certificate = source.certificate;
    if (!certificate || source.sourceKind !== 'NOTARY_MATTER') throw missing();
    const audits = await tx.auditEvent.findMany({
      where: {
        departmentId: source.departmentId,
        actorUserId: certificate.actorUserId,
        resourceType: 'notary_matter',
        resourceId: source.sourceId,
        action: 'notary.certificate_issued',
        details: { path: ['certificateId'], equals: certificate.id },
      },
      select: { id: true },
    });
    if (audits.length !== 1) throw missing();
    const audit = audits[0]!;
    const references = await tx.materialReference.findMany({
      where: {
        departmentId: source.departmentId,
        resourceType: 'notary_matter',
        resourceId: source.sourceId,
        actionEventId: audit.id,
        purpose: 'NOTARY_CERTIFICATE',
        material: {
          category: 'NOTARY_CERTIFICATE',
          departmentId: source.departmentId,
        },
      },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
      orderBy: { contentVersionId: 'asc' },
    });
    return initializeNotaryEvidence(tx, {
      departmentId: source.departmentId,
      sourceNotaryMatterId: source.sourceId,
      caseId: source.case.id,
      certificateId: certificate.id,
      actorUserId: certificate.actorUserId,
      notaryOfficeAccountBindingId: certificate.notaryOfficeAccountBindingId,
      sourceActionEventId: audit.id,
      certificateNo: certificate.number,
      certificateDate: certificate.issuedOn,
      evidenceAt: certificate.evidenceAt,
      officeName: certificate.officeName,
      shopName: source.case.shopName,
      platform: source.case.platform,
      files: references.map((ref) => ({
        materialId: ref.materialId,
        contentVersionId: ref.contentVersionId,
        originalFilename: ref.contentVersion.originalFilename,
        mimeType: ref.contentVersion.mimeType,
      })),
    });
  }

  async createSourceGroup(
    actor: ActorContext,
    kind: EvidenceSourceKind,
    sourceId: string,
    key: string,
    input: CreateEvidenceSourceGroupDto,
  ): Promise<GroupResult> {
    return this.command(actor, 'evidence.edit', key, async (tx) => {
      let source = await readEvidenceSource(
        tx,
        actor.departmentId,
        kind,
        sourceId,
      );
      await this.lockSource(tx, actor, source);
      source = await readEvidenceSource(
        tx,
        actor.departmentId,
        source.sourceKind,
        source.sourceId,
      );
      const fingerprint = evidenceCommandFingerprint(
        'EDIT_GROUP',
        `${kind}:${sourceId}`,
        input,
      );
      const prior = await this.prior(tx, actor, key, 'EDIT_GROUP', fingerprint);
      if (prior !== null) return this.replayGroup(prior);
      const existing = await tx.evidenceGroupVersion.findUnique({
        where: {
          departmentId_sourceKind_sourceId: {
            departmentId: actor.departmentId,
            sourceKind: source.sourceKind,
            sourceId: source.sourceId,
          },
        },
      });
      if (
        existing ||
        input.expectedGroupVersion !== 0 ||
        source.sourceVersion !== input.expectedSourceVersion
      )
        throw conflict();
      const firstPlan = planEvidenceSourceCreation(input);
      if (!firstPlan.changed)
        return { changed: false, group: await this.view(tx, null, source) };
      let record: EvidenceGroupVersion;
      if (source.sourceKind === 'NOTARY_MATTER') {
        const initialized = await this.initializeFromSource(tx, source);
        record = await this.groupRecord(tx, actor, initialized.groupId);
      } else
        record = await tx.evidenceGroupVersion.create({
          data: {
            departmentId: actor.departmentId,
            sourceKind: 'CASE',
            sourceId: source.sourceId,
            caseId: source.case.id,
          },
        });
      const group = await this.groupRecord(tx, actor, record.id);
      const plan = planEvidenceGroupChange(
        {
          version: group.version,
          items: group.items,
          paperCertificates: group.paperCertificates,
        },
        {
          expectedGroupVersion: group.version,
          rows: input.rows,
          remark: input.remark,
        },
      );
      await this.applyPlan(
        tx,
        actor,
        group,
        source,
        plan,
        source.sourceKind === 'NOTARY_MATTER',
      );
      const result = {
        changed: true,
        group: await this.view(
          tx,
          await this.groupRecord(tx, actor, group.id),
          source,
        ),
      };
      await this.receipt(tx, actor, key, 'EDIT_GROUP', fingerprint, result);
      return result;
    });
  }

  async bulkStatus(
    actor: ActorContext,
    key: string,
    input: BulkEvidenceStatusDto,
  ): Promise<BulkResult> {
    return this.command(actor, 'evidence.bulk-status', key, async (tx) => {
      let [items, papers] = await Promise.all([
        tx.evidenceItem.findMany({
          where: {
            id: { in: input.evidenceIds },
            departmentId: actor.departmentId,
          },
        }),
        tx.evidencePaperCertificate.findMany({
          where: {
            id: { in: input.paperCertificateIds },
            departmentId: actor.departmentId,
          },
        }),
      ]);
      if (
        !input.evidenceIds.length ||
        items.length !== input.evidenceIds.length ||
        papers.length !== input.paperCertificateIds.length
      )
        throw missing();
      const selectedGroups = new Set(items.map((item) => item.groupId));
      if (papers.some((paper) => !selectedGroups.has(paper.groupId)))
        throw invalid('纸质公证书必须属于所选证物关联组');
      const groups = [];
      // Same source/group lock order as group saves and issuance initialization.
      for (const id of [...selectedGroups].sort())
        groups.push(await this.lockedGroup(tx, actor, id));
      const fingerprint = evidenceCommandFingerprint(
        'BULK_STATUS',
        null,
        input,
      );
      const prior = await this.prior(
        tx,
        actor,
        key,
        'BULK_STATUS',
        fingerprint,
      );
      if (prior !== null) {
        if (
          !prior ||
          typeof prior !== 'object' ||
          Array.isArray(prior) ||
          typeof prior.changedEvidence !== 'number' ||
          typeof prior.changedPaperCertificates !== 'number'
        )
          throw new InternalServerErrorException({
            code: 'INVALID_EVIDENCE_RECEIPT',
            message: '证物原请求回执不完整',
          });
        return {
          changedEvidence: prior.changedEvidence,
          changedPaperCertificates: prior.changedPaperCertificates,
        };
      }
      if (
        items.some((item) => item.removedAt !== null) ||
        papers.some((paper) => paper.removedAt !== null)
      )
        throw missing();
      let alignmentChanged = false;
      for (const entry of groups) {
        if (await this.alignCase(tx, actor, entry.group, entry.source))
          alignmentChanged = true;
      }
      if (alignmentChanged)
        [items, papers] = await Promise.all([
          tx.evidenceItem.findMany({
            where: {
              id: { in: input.evidenceIds },
              departmentId: actor.departmentId,
            },
          }),
          tx.evidencePaperCertificate.findMany({
            where: {
              id: { in: input.paperCertificateIds },
              departmentId: actor.departmentId,
            },
          }),
        ]);
      const plan = planEvidenceBulkStatus(items, papers, input);
      const affected = new Set([
        ...plan.items.map(
          (next) => items.find((item) => item.id === next.id)!.groupId,
        ),
        ...plan.papers.map(
          (next) => papers.find((paper) => paper.id === next.id)!.groupId,
        ),
      ]);
      for (const id of affected)
        await tx.evidenceGroupVersion.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
      for (const next of plan.items) {
        const before = items.find((item) => item.id === next.id)!;
        const after = await tx.evidenceItem.update({
          where: { id: next.id },
          data: {
            status: next.status,
            version: { increment: 1 },
            updatedByUserId: actor.userId,
          },
        });
        await this.audit(
          tx,
          actor,
          before.groupId,
          'BULK_ITEM_STATUS',
          before,
          after,
          after.id,
        );
      }
      for (const next of plan.papers) {
        const before = papers.find((paper) => paper.id === next.id)!;
        const after = await tx.evidencePaperCertificate.update({
          where: { id: next.id },
          data: {
            status: next.status,
            version: { increment: 1 },
            updatedByUserId: actor.userId,
          },
        });
        await this.audit(
          tx,
          actor,
          before.groupId,
          'BULK_PAPER_STATUS',
          before,
          after,
          undefined,
          after.id,
        );
      }
      const result = {
        changedEvidence: plan.items.length,
        changedPaperCertificates: plan.papers.length,
      };
      if (affected.size || alignmentChanged)
        await this.receipt(tx, actor, key, 'BULK_STATUS', fingerprint, result);
      return result;
    });
  }

  async export(actor: ActorContext, input: ExportEvidenceDto) {
    return this.read(actor, 'evidence.export', async (tx) => {
      if (
        !input.evidenceIds.length ||
        new Set(input.evidenceIds).size !== input.evidenceIds.length
      )
        throw invalid('请明确选择要导出的证物');
      const items = await tx.evidenceItem.findMany({
        where: {
          departmentId: actor.departmentId,
          id: { in: input.evidenceIds },
          removedAt: null,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      if (items.length !== input.evidenceIds.length) throw missing();
      const rows = [];
      for (const groupId of [...new Set(items.map((item) => item.groupId))]) {
        const group = await this.groupRecord(tx, actor, groupId);
        const source = await readEvidenceSource(
          tx,
          actor.departmentId,
          group.sourceKind,
          group.sourceId,
        );
        const view = await this.view(tx, group, source);
        rows.push(
          ...view.items.filter((item) => input.evidenceIds.includes(item.id)),
        );
      }
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const byId = new Map(rows.map((row) => [row.id, row]));
      return {
        filename: `证物清单_所选_${today}.csv`,
        csv: selectedEvidenceCsv(
          items.map((item) => {
            const row = byId.get(item.id);
            if (!row) throw missing();
            return row;
          }),
        ),
      };
    });
  }
}
