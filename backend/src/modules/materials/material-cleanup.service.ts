import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  PRIVATE_BLOB_STORAGE,
  PrivateBlobStorage,
} from './private-blob-storage';

type PurgeCandidate = { id: string; storageKey: string };
const BATCH_SIZE = 100;
const INTERVAL_MS = 15 * 60 * 1000;
export const MATERIAL_CLEANUP_CLOCK = Symbol('MATERIAL_CLEANUP_CLOCK');

@Injectable()
export class MaterialCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaterialCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly clock: () => Date;

  constructor(
    private readonly database: DatabaseService,
    @Inject(PRIVATE_BLOB_STORAGE)
    private readonly storage: PrivateBlobStorage,
    @Optional()
    @Inject(MATERIAL_CLEANUP_CLOCK)
    clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.clock();
      await this.expireDrafts(now);
      const leadDraftCandidates = await this.lockLeadDraftCandidates(now);
      await this.purgeCandidates(leadDraftCandidates);
      const deletedCandidates = await this.lockDeletedCandidates(now);
      await this.purgeCandidates(deletedCandidates);
    } finally {
      this.running = false;
    }
  }

  private async expireDrafts(now: Date): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "upload_drafts"
         WHERE "status" = 'OPEN' AND "expires_at" <= $1
         ORDER BY "expires_at", "id"
         FOR UPDATE SKIP LOCKED LIMIT $2`,
        now,
        BATCH_SIZE,
      );
      if (rows.length > 0) {
        await transaction.uploadDraft.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, status: 'OPEN' },
          data: { status: 'EXPIRED' },
        });
      }
    });
  }

  private lockLeadDraftCandidates(now: Date): Promise<PurgeCandidate[]> {
    return this.lockCandidates(
      `SELECT cv."id", cv."storage_key" AS "storageKey"
       FROM "content_versions" cv
       JOIN "materials" m ON m."id" = cv."material_id"
       WHERE m."owner_type" = 'LEAD_DRAFT'
         AND cv."status" IN ('AVAILABLE', 'DELETED')
         AND EXISTS (
           SELECT 1 FROM "upload_drafts" d
           WHERE d."department_id" = m."department_id"
             AND d."owner_type" = 'LEAD_DRAFT'
             AND d."owner_id" = m."owner_id"
             AND d."expires_at" <= $1
         )
         AND NOT EXISTS (
           SELECT 1 FROM "material_references" mr
           WHERE mr."content_version_id" = cv."id"
         )
       ORDER BY cv."id"
       FOR UPDATE OF cv SKIP LOCKED LIMIT $2`,
      now,
    );
  }

  private lockDeletedCandidates(now: Date): Promise<PurgeCandidate[]> {
    return this.lockCandidates(
      `SELECT cv."id", cv."storage_key" AS "storageKey"
       FROM "content_versions" cv
       JOIN "materials" m ON m."id" = cv."material_id"
       WHERE m."status" = 'DELETED'
         AND m."deleted_at" + INTERVAL '90 days' <= $1
         AND cv."status" IN ('AVAILABLE', 'DELETED')
         AND NOT EXISTS (
           SELECT 1 FROM "material_references" mr
           WHERE mr."content_version_id" = cv."id"
         )
       ORDER BY cv."id"
       FOR UPDATE OF cv SKIP LOCKED LIMIT $2`,
      now,
    );
  }

  private lockCandidates(sql: string, now: Date): Promise<PurgeCandidate[]> {
    return this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRawUnsafe<PurgeCandidate[]>(
        sql,
        now,
        BATCH_SIZE,
      );
      for (const row of rows) {
        await transaction.contentVersion.updateMany({
          where: { id: row.id, status: { in: ['AVAILABLE', 'DELETED'] } },
          data: { status: 'DELETED' },
        });
      }
      return rows;
    });
  }

  private async purgeCandidates(candidates: PurgeCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      try {
        await this.storage.delete(candidate.storageKey);
        await this.database.contentVersion.updateMany({
          where: { id: candidate.id, status: 'DELETED' },
          data: { status: 'PURGED' },
        });
      } catch {
        this.logger.warn(
          'Private material cleanup will retry a failed blob deletion',
        );
      }
    }
  }
}
