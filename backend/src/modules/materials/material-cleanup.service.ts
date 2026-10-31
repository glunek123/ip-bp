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
import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';

type PurgeCandidate = {
  id: string;
  materialId?: string;
  storageKey: string;
  retainPendingKey?: boolean;
};
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
    private readonly storageKeyCoordinator: MaterialStorageKeyCoordinator,
    @Optional()
    @Inject(MATERIAL_CLEANUP_CLOCK)
    clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  onModuleInit(): void {
    this.scheduleRun();
    this.timer = setInterval(() => this.scheduleRun(), INTERVAL_MS);
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
      await this.cleanupPendingStorageKeys(now);
      const leadDraftCandidates = await this.lockLeadDraftCandidates(now);
      await this.purgeCandidates(leadDraftCandidates);
      const deletedCandidates = await this.lockDeletedCandidates(now);
      await this.purgeCandidates(deletedCandidates);
      await this.purgeCandidates(await this.lockDeletedProofCandidates(now));
    } finally {
      this.running = false;
    }
  }

  private scheduleRun(): void {
    void this.runOnce().catch(() => {
      this.logger.warn(
        'Private material cleanup run failed and will be retried',
      );
    });
  }

  private async cleanupPendingStorageKeys(now: Date): Promise<void> {
    const candidates = await this.database.$transaction(async (transaction) =>
      transaction.$queryRawUnsafe<PurgeCandidate[]>(
        `SELECT d."id", d."pending_storage_key" AS "storageKey",
           (d."category"::text = 'CASE_CLOSURE_PAYMENT_PROOF'
             OR d."purpose" = 'CASE_CLOSURE_PAYMENT_PROOF') AS "retainPendingKey"
         FROM "upload_drafts" d
         WHERE d."pending_storage_key" IS NOT NULL
           AND d."updated_at" <= $1::timestamptz - INTERVAL '15 minutes'
           AND ((d."category"::text <> 'CASE_CLOSURE_PAYMENT_PROOF'
                  AND d."purpose" <> 'CASE_CLOSURE_PAYMENT_PROOF')
             OR (d."status" = 'EXPIRED' AND d."expires_at" <= $1::timestamptz))
           AND NOT EXISTS (
             SELECT 1 FROM "content_versions" cv
             WHERE cv."storage_key" = d."pending_storage_key"
         )
         ORDER BY d."updated_at", d."id"
         FOR UPDATE OF d SKIP LOCKED LIMIT $2`,
        now,
        BATCH_SIZE,
      ),
    );
    for (const candidate of candidates) {
      await this.storageKeyCoordinator.withKey(candidate.storageKey, () =>
        this.cleanupPendingStorageKey(now, candidate),
      );
    }
  }

  private async cleanupPendingStorageKey(
    now: Date,
    candidate: PurgeCandidate,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRawUnsafe<PurgeCandidate[]>(
        `SELECT d."id", d."pending_storage_key" AS "storageKey",
           (d."category"::text = 'CASE_CLOSURE_PAYMENT_PROOF'
             OR d."purpose" = 'CASE_CLOSURE_PAYMENT_PROOF') AS "retainPendingKey"
         FROM "upload_drafts" d
         WHERE d."id" = $1
           AND d."pending_storage_key" = $2
           AND d."updated_at" <= $3::timestamptz - INTERVAL '15 minutes'
           AND ((d."category"::text <> 'CASE_CLOSURE_PAYMENT_PROOF'
                  AND d."purpose" <> 'CASE_CLOSURE_PAYMENT_PROOF')
             OR (d."status" = 'EXPIRED' AND d."expires_at" <= $3::timestamptz))
           AND NOT EXISTS (
             SELECT 1 FROM "content_versions" cv
             WHERE cv."storage_key" = d."pending_storage_key"
           )
         FOR UPDATE OF d`,
        candidate.id,
        candidate.storageKey,
        now,
      );
      if (rows.length === 0) return;
      const current = rows[0];
      if (current === undefined) return;
      try {
        await this.storage.delete(current.storageKey);
        if (!current.retainPendingKey) {
          await transaction.uploadDraft.updateMany({
            where: { id: current.id, pendingStorageKey: current.storageKey },
            data: { pendingStorageKey: null },
          });
        }
      } catch {
        this.logger.warn(
          'Private material orphan cleanup will retry a failed blob deletion',
        );
      }
      if (current.retainPendingKey) {
        // A different process may still publish a slow put after this deletion.
        // EXPIRED forbids finalization; keep the key as a durable retry record.
        // Rotate successes and failures alike so the fixed batch cannot starve
        // newer records. Future gate replacement must permit this touch only.
        await transaction.uploadDraft.updateMany({
          where: {
            id: current.id,
            pendingStorageKey: current.storageKey,
            status: 'EXPIRED',
          },
          data: { updatedAt: now },
        });
      }
    });
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
      `SELECT cv."id", m."id" AS "materialId", cv."storage_key" AS "storageKey"
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
       FOR NO KEY UPDATE OF m, cv SKIP LOCKED LIMIT $2`,
      now,
    );
  }

  private lockDeletedCandidates(now: Date): Promise<PurgeCandidate[]> {
    return this.lockCandidates(
      `SELECT cv."id", m."id" AS "materialId", cv."storage_key" AS "storageKey"
       FROM "content_versions" cv
       JOIN "materials" m ON m."id" = cv."material_id"
       WHERE m."status" = 'DELETED'
         -- Proofs use the separately locked, per-candidate cleanup below.
         AND m."category"::text <> 'CASE_CLOSURE_PAYMENT_PROOF'
         AND m."purpose" <> 'CASE_CLOSURE_PAYMENT_PROOF'
         AND m."deleted_at" + INTERVAL '90 days' <= $1::timestamptz
         AND cv."status" IN ('AVAILABLE', 'DELETED')
         AND NOT EXISTS (
           SELECT 1 FROM "material_references" mr
           WHERE mr."content_version_id" = cv."id"
         )
       ORDER BY cv."id"
       FOR NO KEY UPDATE OF m, cv SKIP LOCKED LIMIT $2`,
      now,
    );
  }

  private async lockDeletedProofCandidates(
    now: Date,
  ): Promise<PurgeCandidate[]> {
    const candidates = await this.database.$transaction((transaction) =>
      transaction.$queryRawUnsafe<
        Required<Pick<PurgeCandidate, 'id' | 'materialId' | 'storageKey'>>[]
      >(
        `SELECT cv."id", m."id" AS "materialId", cv."storage_key" AS "storageKey"
       FROM "materials" m JOIN "content_versions" cv ON cv."material_id" = m."id"
       WHERE m."status" = 'DELETED'
         AND (m."category"::text = 'CASE_CLOSURE_PAYMENT_PROOF'
           OR m."purpose" = 'CASE_CLOSURE_PAYMENT_PROOF')
         AND m."deleted_at" + INTERVAL '90 days' <= $1::timestamptz
         AND NOT m."payment_proof_frozen" AND NOT cv."payment_proof_frozen"
         AND cv."status" IN ('AVAILABLE', 'DELETED')
         AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."content_version_id" = cv."id")
         AND NOT EXISTS (SELECT 1 FROM "case_closure_payment_documents" d WHERE d."content_version_id" = cv."id")
         AND NOT EXISTS (SELECT 1 FROM "case_payment_proof_supplement_documents" d WHERE d."content_version_id" = cv."id")
       ORDER BY cv."id" LIMIT $2`,
        now,
        BATCH_SIZE,
      ),
    );
    const locked: PurgeCandidate[] = [];
    for (const candidate of candidates) {
      try {
        const current = await this.database.$transaction(
          async (transaction) => {
            // Distinct statements establish material -> content. Candidate discovery
            // takes no locks; all destructive eligibility is checked again below.
            const materials = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              `SELECT m."id" FROM "materials" m
           WHERE m."id" = $1::uuid AND m."status" = 'DELETED'
             AND (m."category"::text = 'CASE_CLOSURE_PAYMENT_PROOF'
               OR m."purpose" = 'CASE_CLOSURE_PAYMENT_PROOF')
             AND m."deleted_at" + INTERVAL '90 days' <= $2::timestamptz
             AND NOT m."payment_proof_frozen"
           FOR NO KEY UPDATE OF m SKIP LOCKED`,
              candidate.materialId,
              now,
            );
            if (materials.length !== 1) return undefined;
            const versions = await transaction.$queryRawUnsafe<
              Array<PurgeCandidate & { status: 'AVAILABLE' | 'DELETED' }>
            >(
              `SELECT cv."id", cv."storage_key" AS "storageKey", cv."status"
           FROM "content_versions" cv
           WHERE cv."id" = $1::uuid AND cv."material_id" = $2::uuid
             AND cv."status" IN ('AVAILABLE', 'DELETED')
             AND NOT cv."payment_proof_frozen"
             AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."content_version_id" = cv."id")
             AND NOT EXISTS (SELECT 1 FROM "case_closure_payment_documents" d WHERE d."content_version_id" = cv."id")
             AND NOT EXISTS (SELECT 1 FROM "case_payment_proof_supplement_documents" d WHERE d."content_version_id" = cv."id")
           FOR NO KEY UPDATE OF cv SKIP LOCKED`,
              candidate.id,
              candidate.materialId,
            );
            const version = versions[0];
            if (version === undefined) return undefined;
            if (version.status === 'AVAILABLE') {
              const changed = await transaction.contentVersion.updateMany({
                where: { id: version.id, status: 'AVAILABLE' },
                data: { status: 'DELETED' },
              });
              if (changed.count !== 1) return undefined;
            }
            // The transaction must commit the durable intent before the caller can
            // delete the fixed storage key. Replays keep DELETED and retry deletion.
            return {
              id: version.id,
              materialId: candidate.materialId,
              storageKey: version.storageKey,
            };
          },
        );
        if (current !== undefined) locked.push(current);
      } catch {
        // Isolate a rejected proof from unrelated ordinary/proof candidates.
        this.logger.warn(
          'Private payment proof cleanup will retry a rejected candidate',
        );
      }
    }
    return locked;
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
