import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { ArchiveNotaryReturnBatchDto } from './notary-return-archive-batch.dto';
import {
  NotaryReturnArchiveService,
  ReturnArchiveResult,
} from './notary-return-archive.service';

type NormalizedItem = {
  matterId: string;
  input: ReturnType<NotaryReturnArchiveService['normalize']>;
};
export type ReturnArchiveBatchResult = {
  batchId: string;
  items: ReturnArchiveResult[];
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class NotaryReturnArchiveBatchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly returnArchive: NotaryReturnArchiveService,
  ) {}

  async archive(
    actor: ActorContext,
    idempotencyKey: string,
    input: ArchiveNotaryReturnBatchDto,
  ): Promise<ReturnArchiveBatchResult> {
    const items = this.normalize(input);
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim() !== idempotencyKey ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128
    )
      throw this.returnArchive.validation();
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.returnArchive.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(items))
      .digest('hex');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let receiptUniqueCollision = false;
      try {
        return await this.database.$transaction(
          async (tx) => {
            for (const item of items) {
              const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
                'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
                item.matterId,
                actor.departmentId,
              );
              if (locked.length !== 1) throw this.returnArchive.notFound();
            }
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true, displayName: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.returnArchive.forbidden();
            for (const item of items)
              await this.returnArchive.authorizeLocked(
                tx,
                actor,
                item.matterId,
              );
            const prior = await tx.notaryReturnArchiveBatchReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.replay(tx, prior, items, fingerprint);
            const resultItems: ReturnArchiveResult[] = [];
            for (const item of items)
              resultItems.push(
                await this.returnArchive.archiveLocked(
                  tx,
                  actor,
                  item.matterId,
                  item.input,
                  account.displayName.trim(),
                ),
              );
            const batchId = randomUUID();
            const result = { batchId, items: resultItems };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'notary_archive_batch',
                resourceId: batchId,
                action: 'notary.return.archive.batch.succeeded',
                details: {
                  actualIds: items.map((item) => item.matterId),
                  count: items.length,
                },
              },
            });
            try {
              await tx.notaryReturnArchiveBatchReceipt.create({
                data: {
                  id: batchId,
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey,
                  requestFingerprint: fingerprint,
                  resultSnapshot: result,
                },
              });
            } catch (error) {
              receiptUniqueCollision = this.returnArchive.isUnique(error);
              throw error;
            }
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.returnArchive.isSerializationConflict(error)) {
          if (attempt < 3) continue;
          throw this.returnArchive.versionConflict();
        }
        if (this.returnArchive.isUnique(error)) {
          if (receiptUniqueCollision && attempt < 3) continue;
          throw this.returnArchive.versionConflict();
        }
        throw error;
      }
    }
    throw this.returnArchive.versionConflict();
  }

  private normalize(input: ArchiveNotaryReturnBatchDto): NormalizedItem[] {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join() !== 'items' ||
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > 50
    )
      throw this.returnArchive.validation();
    const seen = new Set<string>();
    const items = input.items.map((item) => {
      if (
        item === null ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        typeof item.matterId !== 'string' ||
        !UUID.test(item.matterId)
      )
        throw this.returnArchive.validation();
      const matterId = item.matterId.toLowerCase();
      if (seen.has(matterId)) throw this.returnArchive.validation();
      seen.add(matterId);
      const { matterId: ignored, ...single } = item;
      void ignored;
      return { matterId, input: this.returnArchive.normalize(single) };
    });
    return items.sort((a, b) =>
      a.matterId < b.matterId ? -1 : a.matterId > b.matterId ? 1 : 0,
    );
  }

  private async replay(
    tx: Prisma.TransactionClient,
    receipt: {
      id: string;
      departmentId: string;
      actorUserId: string;
      requestFingerprint: string;
      resultSnapshot: Prisma.JsonValue;
    },
    items: NormalizedItem[],
    fingerprint: string,
  ): Promise<ReturnArchiveBatchResult> {
    if (receipt.requestFingerprint !== fingerprint)
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该 Idempotency-Key 已用于不同请求',
      });
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join() !== 'batchId,items' ||
      snapshot.batchId !== receipt.id ||
      !Array.isArray(snapshot.items) ||
      snapshot.items.length !== items.length
    )
      throw this.returnArchive.corruptReceipt();
    const resultItems: ReturnArchiveResult[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const row = snapshot.items[index];
      if (
        row === null ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        row.id !== items[index].matterId ||
        row.version !== items[index].input.expectedVersion + 1
      )
        throw this.returnArchive.corruptReceipt();
      resultItems.push(
        await this.returnArchive.replay(
          tx,
          {
            departmentId: receipt.departmentId,
            actorUserId: receipt.actorUserId,
            requestFingerprint: fingerprint,
            resultMatterId: items[index].matterId,
            resultMatterVersion: row.version as number,
            resultSnapshot: row as Prisma.JsonObject,
          },
          items[index].matterId,
          fingerprint,
        ),
      );
    }
    const audit = await tx.auditEvent.findFirst({
      where: {
        departmentId: receipt.departmentId,
        actorUserId: receipt.actorUserId,
        resourceType: 'notary_archive_batch',
        resourceId: receipt.id,
        action: 'notary.return.archive.batch.succeeded',
      },
      select: { details: true },
    });
    const details = audit?.details;
    if (
      details === null ||
      typeof details !== 'object' ||
      Array.isArray(details) ||
      Object.keys(details).sort().join() !== 'actualIds,count' ||
      details.count !== items.length ||
      !Array.isArray(details.actualIds) ||
      details.actualIds.length !== items.length ||
      details.actualIds.some((id, index) => id !== items[index].matterId)
    )
      throw this.returnArchive.corruptReceipt();
    return { batchId: receipt.id, items: resultItems };
  }
}
