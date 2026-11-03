import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  PRIVATE_BLOB_STORAGE,
  type PrivateBlobStorage,
  MaterialService,
} from '../materials';
import { NotaryOpeningService } from './notary-opening.service';
import {
  NOTARY_OPENING_RECOGNITION,
  type OpeningRecognitionProvider,
} from './notary-opening-recognition';
import { parseOpeningImportZip } from './notary-opening-import-zip';

const reject = (code: string) => new ConflictException({ code });
const missing = () => new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR' });
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
type PatchInput = {
  trackingNo: string | null;
  selectedMatterId: string | null;
  expectedRevision: number;
};
type ConfirmInput = {
  matterId: string;
  expectedVersion: number;
  expectedRevision: number;
  senderName?: string;
  senderPhone?: string;
  senderAddress?: string;
};

@Injectable()
export class NotaryOpeningImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly opening: NotaryOpeningService,
    @Inject(NOTARY_OPENING_RECOGNITION)
    private readonly recognition: OpeningRecognitionProvider,
    private readonly materials: MaterialService,
    @Inject(PRIVATE_BLOB_STORAGE) private readonly blobs: PrivateBlobStorage,
  ) {}

  private async scope(
    actor: ActorContext,
    reader: DatabaseService | Prisma.TransactionClient = this.db,
  ) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    const account = await reader.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active !== true)
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    return this.access.buildLeadScope(actor, 'notary.unbox.record', reader);
  }

  private async matchingMatterIds(
    actor: ActorContext,
    scope: Prisma.LeadWhereInput,
    trackingNos: readonly string[],
  ): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>();
    if (!trackingNos.length) return found;
    const matches = await this.db.notaryMatter.findMany({
      where: {
        departmentId: actor.departmentId,
        stage: 'WAITING_UNBOX',
        sourceLead: scope,
        OR: [
          {
            evidence: {
              logistics: {
                some: {
                  trackingState: 'PRESENT',
                  trackingValue: { in: [...trackingNos] },
                },
              },
            },
          },
          {
            evidenceCorrections: {
              some: {
                logistics: {
                  some: {
                    trackingState: 'PRESENT',
                    trackingValue: { in: [...trackingNos] },
                  },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        evidence: {
          select: { logistics: { select: { trackingValue: true } } },
        },
        evidenceCorrections: {
          orderBy: { revision: 'desc' },
          take: 1,
          select: { logistics: { select: { trackingValue: true } } },
        },
      },
    });
    for (const trackingNo of trackingNos) {
      found.set(
        trackingNo,
        matches
          .filter((matter) =>
            (
              matter.evidenceCorrections[0]?.logistics ??
              matter.evidence?.logistics ??
              []
            ).some((entry) => entry.trackingValue === trackingNo),
          )
          .map((matter) => matter.id),
      );
    }
    return found;
  }

  private view(batch: Awaited<ReturnType<NotaryOpeningImportService['load']>>) {
    return {
      id: batch.id,
      status:
        batch.status === 'READY' && batch.expiresAt <= new Date()
          ? 'EXPIRED'
          : batch.status,
      expiresAt: batch.expiresAt.toISOString(),
      recognitionMode: batch.recognitionMode,
      items: batch.items.map((item) => ({
        id: item.id,
        folderName: item.folderName,
        revision: item.revision,
        status: item.status,
        trackingCandidate: item.trackingCandidate,
        trackingNo: item.trackingNo,
        recognitionStatus: item.recognitionStatus,
        senderCandidate: item.senderCandidate,
        matchStatus: item.matchStatus,
        suggestedMatterId: item.suggestedMatterId,
        selectedMatterId: item.selectedMatterId,
        photos: item.photos.map((photo) => ({
          id: photo.id,
          filename: photo.filename,
          mimeType: photo.mimeType,
          sizeBytes: photo.sizeBytes,
        })),
      })),
    };
  }

  private async load(actor: ActorContext, batchId: string) {
    await this.scope(actor);
    const batch = await this.db.notaryOpeningImportBatch.findFirst({
      where: {
        id: batchId,
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
      },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: { photos: { orderBy: { filename: 'asc' } } },
        },
      },
    });
    if (!batch) throw missing();
    return batch;
  }

  async get(actor: ActorContext, batchId: string) {
    const batch = await this.load(actor, batchId);
    const view = this.view(batch);
    const targetIds = [
      ...new Set(
        batch.items
          .filter((item) => item.status !== 'COMMITTED')
          .flatMap((item) => [item.suggestedMatterId, item.selectedMatterId])
          .filter((id): id is string => id !== null),
      ),
    ];
    if (targetIds.length === 0) return view;
    const scope = await this.scope(actor);
    const visible = new Set(
      (
        await this.db.notaryMatter.findMany({
          where: {
            id: { in: targetIds },
            departmentId: actor.departmentId,
            stage: 'WAITING_UNBOX',
            sourceLead: scope,
          },
          select: { id: true },
        })
      ).map((matter) => matter.id),
    );
    for (const item of view.items) {
      if (item.status === 'COMMITTED') continue;
      if (item.suggestedMatterId && !visible.has(item.suggestedMatterId)) {
        item.suggestedMatterId = null;
        if (item.matchStatus === 'SUGGESTED') item.matchStatus = 'UNMATCHED';
      }
      if (item.selectedMatterId && !visible.has(item.selectedMatterId))
        item.selectedMatterId = null;
    }
    return view;
  }

  async byKey(actor: ActorContext, key: string) {
    await this.scope(actor);
    if (!key || key.length > 128) throw invalid();
    const batch = await this.db.notaryOpeningImportBatch.findUnique({
      where: {
        departmentId_actorUserId_idempotencyKey: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          idempotencyKey: key,
        },
      },
      select: { id: true },
    });
    if (!batch) throw missing();
    return this.get(actor, batch.id);
  }

  async upload(actor: ActorContext, key: string, zip: Buffer) {
    await this.scope(actor);
    if (!key || key.length > 128 || !Buffer.isBuffer(zip)) throw invalid();
    const zipSha256 = createHash('sha256').update(zip).digest('hex');
    const prior = await this.db.notaryOpeningImportBatch.findUnique({
      where: {
        departmentId_actorUserId_idempotencyKey: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          idempotencyKey: key,
        },
      },
      select: { id: true, zipSha256: true },
    });
    if (prior) {
      if (prior.zipSha256 !== zipSha256) throw reject('IDEMPOTENCY_CONFLICT');
      return this.get(actor, prior.id);
    }
    const folders = parseOpeningImportZip(zip);
    const batchId = randomUUID();
    const staged: string[] = [];
    const planned = [];
    try {
      for (const [index, folder] of folders.entries()) {
        const itemId = randomUUID();
        const recognized = await this.recognition.recognize({
          photos: folder.photos.map((photo) => ({
            filename: photo.filename,
            mimeType: photo.mimeType as
              'image/jpeg' | 'image/png' | 'image/webp',
            bytes: new Uint8Array(photo.bytes),
          })),
        });
        const photos = [];
        for (const photo of folder.photos) {
          const materialId = randomUUID();
          const contentVersionId = randomUUID();
          const storageKey = `${actor.departmentId}/opening-import/${batchId}/${contentVersionId}`;
          const stored = await this.blobs.put(
            storageKey,
            Readable.from(photo.bytes),
            20 * 1024 * 1024,
          );
          staged.push(storageKey);
          if (
            stored.detectedMimeType !== photo.mimeType ||
            stored.sizeBytes !== photo.bytes.length
          )
            throw invalid();
          photos.push({
            id: randomUUID(),
            filename: photo.filename,
            storageKey,
            materialId,
            contentVersionId,
            mimeType: stored.detectedMimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
          });
        }
        planned.push({
          id: itemId,
          position: index + 1,
          folderName: folder.name,
          recognized,
          photos,
        });
      }
      // Recheck permissions after filesystem work; matching is scoped to current WAITING_UNBOX matters.
      const scope = await this.scope(actor);
      const trackingNos = planned
        .map((item) => item.recognized.trackingCandidate)
        .filter((v): v is string => !!v);
      const matches = await this.matchingMatterIds(actor, scope, trackingNos);
      const counts = new Map<string, number>();
      for (const t of trackingNos) counts.set(t, (counts.get(t) ?? 0) + 1);
      await this.db.notaryOpeningImportBatch.create({
        data: {
          id: batchId,
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          idempotencyKey: key,
          zipSha256,
          recognitionMode: this.recognition.mode,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          items: {
            create: planned.map((item) => {
              const trackingNo = item.recognized.trackingCandidate;
              const candidates = trackingNo
                ? (matches.get(trackingNo) ?? [])
                : [];
              const conflict =
                !!trackingNo && (counts.get(trackingNo) ?? 0) > 1;
              return {
                id: item.id,
                position: item.position,
                folderName: item.folderName,
                trackingCandidate: trackingNo,
                trackingNo,
                recognitionStatus: item.recognized.status,
                senderCandidate:
                  item.recognized.senderCandidate ?? Prisma.JsonNull,
                matchStatus: conflict
                  ? 'CONFLICT'
                  : candidates.length === 1
                    ? 'SUGGESTED'
                    : candidates.length > 1
                      ? 'AMBIGUOUS'
                      : 'UNMATCHED',
                suggestedMatterId:
                  conflict || candidates.length !== 1 ? null : candidates[0],
                status: conflict ? 'CONFLICT' : 'READY',
                photos: {
                  create: item.photos.map((photo) => ({ ...photo })),
                },
              };
            }),
          },
        },
      });
      return this.get(actor, batchId);
    } catch (error) {
      // Only delete blobs whose keys this attempt created; unknown committed commands retain theirs.
      const existing = await this.db.notaryOpeningImportBatch.findUnique({
        where: {
          departmentId_actorUserId_idempotencyKey: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            idempotencyKey: key,
          },
        },
        select: { id: true, zipSha256: true },
      });
      if (!existing || existing.id !== batchId)
        await Promise.allSettled(
          staged.map((storageKey) => this.blobs.delete(storageKey)),
        );
      if (existing) {
        if (existing.zipSha256 !== zipSha256)
          throw reject('IDEMPOTENCY_CONFLICT');
        return this.get(actor, existing.id);
      }
      throw error;
    }
  }

  async eligible(
    actor: ActorContext,
    batchId: string,
    q: string,
    page: number,
    pageSize: number,
  ) {
    await this.load(actor, batchId);
    const scope = await this.scope(actor);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50 ||
      q.length > 100
    )
      throw invalid();
    const where: Prisma.NotaryMatterWhereInput = {
      departmentId: actor.departmentId,
      stage: 'WAITING_UNBOX',
      sourceLead: scope,
      ...(q ? { businessNo: { contains: q.trim(), mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.notaryMatter.findMany({
        where,
        orderBy: { businessNo: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          version: true,
          evidence: {
            select: { logistics: { select: { trackingValue: true } } },
          },
          evidenceCorrections: {
            orderBy: { revision: 'desc' },
            take: 1,
            select: { logistics: { select: { trackingValue: true } } },
          },
        },
      }),
      this.db.notaryMatter.count({ where }),
    ]);
    return {
      items: items.map((m) => ({
        id: m.id,
        businessNo: m.businessNo,
        version: m.version,
        trackingNo:
          (
            m.evidenceCorrections[0]?.logistics ??
            m.evidence?.logistics ??
            []
          ).find((l) => l.trackingValue)?.trackingValue ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async patch(
    actor: ActorContext,
    batchId: string,
    itemId: string,
    input: PatchInput,
  ) {
    const batch = await this.load(actor, batchId);
    if (batch.status !== 'READY' || batch.expiresAt <= new Date())
      throw reject('IMPORT_EXPIRED');
    if (
      !input ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      (input.trackingNo !== null &&
        (typeof input.trackingNo !== 'string' ||
          input.trackingNo.trim().length > 100)) ||
      (input.selectedMatterId !== null && !uuid(input.selectedMatterId))
    )
      throw invalid();
    const item = batch.items.find((x) => x.id === itemId);
    if (!item) throw missing();
    if (item.status === 'COMMITTED') throw reject('INVALID_STATE');
    if (item.revision !== input.expectedRevision)
      throw reject('VERSION_CONFLICT');
    if (input.selectedMatterId) {
      const scope = await this.scope(actor);
      const selected = await this.db.notaryMatter.findFirst({
        where: {
          id: input.selectedMatterId,
          departmentId: actor.departmentId,
          stage: 'WAITING_UNBOX',
          sourceLead: scope,
        },
        select: { id: true },
      });
      if (!selected) throw reject('INVALID_TARGET');
      if (
        batch.items.some(
          (x) =>
            x.id !== itemId &&
            x.selectedMatterId === selected.id &&
            x.status !== 'COMMITTED',
        )
      )
        throw reject('DUPLICATE_TARGET');
    }
    const trackingNo = input.trackingNo?.trim() || null;
    if (
      trackingNo &&
      batch.items.some(
        (x) =>
          x.id !== itemId &&
          x.trackingNo === trackingNo &&
          x.status !== 'COMMITTED',
      )
    )
      throw reject('DUPLICATE_TRACKING');
    const candidates = trackingNo
      ? ((
          await this.matchingMatterIds(actor, await this.scope(actor), [
            trackingNo,
          ])
        ).get(trackingNo) ?? [])
      : [];
    let changed: { count: number };
    try {
      changed = await this.db.notaryOpeningImportItem.updateMany({
        where: {
          id: itemId,
          batchId,
          departmentId: actor.departmentId,
          revision: input.expectedRevision,
          status: { not: 'COMMITTED' },
        },
        data: {
          trackingNo,
          selectedMatterId: input.selectedMatterId,
          revision: { increment: 1 },
          status: 'READY',
          matchStatus:
            candidates.length === 1
              ? 'SUGGESTED'
              : candidates.length > 1
                ? 'AMBIGUOUS'
                : 'UNMATCHED',
          suggestedMatterId: candidates.length === 1 ? candidates[0] : null,
        },
      });
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        (error as { code?: unknown }).code === 'P2002'
      )
        throw reject('DUPLICATE_TARGET');
      throw error;
    }
    if (changed.count !== 1) throw reject('VERSION_CONFLICT');
    const refreshed = await this.load(actor, batchId);
    return this.view(refreshed).items.find((x) => x.id === itemId);
  }

  async confirm(
    actor: ActorContext,
    batchId: string,
    itemId: string,
    key: string,
    input: ConfirmInput,
  ) {
    const batch = await this.load(actor, batchId);
    if (
      !input ||
      !key ||
      key.length > 128 ||
      !uuid(input.matterId) ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    )
      throw invalid();
    const item = batch.items.find((x) => x.id === itemId);
    if (!item) throw missing();
    if (item.status === 'COMMITTED' && item.confirmedKey !== key)
      throw reject('INVALID_STATE');
    if (
      item.status !== 'COMMITTED' &&
      (batch.status !== 'READY' || batch.expiresAt <= new Date())
    )
      throw reject('IMPORT_EXPIRED');
    if (
      item.status !== 'COMMITTED' &&
      (item.revision !== input.expectedRevision || item.status === 'CONFLICT')
    )
      throw reject('VERSION_CONFLICT');
    if (item.selectedMatterId !== input.matterId)
      throw reject('INVALID_TARGET');
    if (
      item.status !== 'COMMITTED' &&
      batch.items.some(
        (x) =>
          x.id !== itemId &&
          x.selectedMatterId === input.matterId &&
          x.status !== 'COMMITTED',
      )
    )
      throw reject('DUPLICATE_TARGET');
    const contentVersionIds = item.photos.map((p) => p.contentVersionId);
    const opening = await this.opening.recordWithAdoption(
      actor,
      input.matterId,
      key,
      {
        contentVersionIds,
        expectedVersion: input.expectedVersion,
        senderName: input.senderName,
        senderPhone: input.senderPhone,
        senderAddress: input.senderAddress,
      },
      async (tx) => {
        const batchLock = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "notary_opening_import_batches" WHERE "id" = $1::uuid AND "department_id" = $2::uuid AND "actor_user_id" = $3::uuid FOR UPDATE',
          batchId,
          actor.departmentId,
          actor.userId,
        );
        if (batchLock.length !== 1) throw missing();
        const currentBatch = await tx.notaryOpeningImportBatch.findUnique({
          where: { id: batchId },
          select: { status: true, expiresAt: true },
        });
        if (
          currentBatch?.status !== 'READY' ||
          currentBatch.expiresAt <= new Date()
        )
          throw reject('IMPORT_EXPIRED');
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "notary_opening_import_items" WHERE "id" = $1::uuid AND "batch_id" = $2::uuid FOR UPDATE',
          itemId,
          batchId,
        );
        if (locked.length !== 1) throw missing();
        const latest = await tx.notaryOpeningImportItem.findUnique({
          where: { id: itemId },
          select: { revision: true, status: true, selectedMatterId: true },
        });
        if (
          !latest ||
          latest.revision !== input.expectedRevision ||
          latest.status !== 'READY' ||
          latest.selectedMatterId !== input.matterId
        )
          throw reject('VERSION_CONFLICT');
        await this.materials.adoptStagedOpeningPhotos(
          tx,
          actor,
          input.matterId,
          item.photos,
        );
        await tx.notaryOpeningImportItem.update({
          where: { id: itemId },
          data: { status: 'COMMITTED', confirmedKey: key },
        });
      },
      'opening.import.confirm',
      `${batchId}:${itemId}:${input.expectedRevision}`,
    );
    return { itemId, opening };
  }

  async photo(actor: ActorContext, batchId: string, photoId: string) {
    const batch = await this.load(actor, batchId);
    if (batch.status !== 'READY' || batch.expiresAt <= new Date())
      throw missing();
    const photo = batch.items
      .flatMap((item) => item.photos)
      .find((item) => item.id === photoId);
    if (!photo) throw missing();
    return {
      stream: await this.blobs.open(photo.storageKey),
      mimeType: photo.mimeType,
      filename: photo.filename,
    };
  }

  async cancel(actor: ActorContext, batchId: string) {
    await this.load(actor, batchId);
    await this.db.$transaction(async (tx) => {
      const lock = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "notary_opening_import_batches" WHERE "id" = $1::uuid AND "department_id" = $2::uuid AND "actor_user_id" = $3::uuid FOR UPDATE',
        batchId,
        actor.departmentId,
        actor.userId,
      );
      if (lock.length !== 1) throw missing();
      await this.scope(actor, tx);
      await tx.notaryOpeningImportBatch.updateMany({
        where: {
          id: batchId,
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          status: 'READY',
        },
        data: { status: 'CANCELLED' },
      });
    });
    return this.get(actor, batchId);
  }
}
