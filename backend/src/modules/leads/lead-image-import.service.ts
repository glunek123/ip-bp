import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { LeadService } from './lead.service';
import { downloadLeadImage, RemoteImageError } from './lead-remote-image';
export const LEAD_IMAGE_DOWNLOADER = Symbol('LEAD_IMAGE_DOWNLOADER');
export type LeadImageDownloader = typeof downloadLeadImage;
class LostImageLease extends Error {}

@Injectable()
export class LeadImageImportService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = 0;
  private ticking = false;
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
    private readonly leads: LeadService,
    @Inject(LEAD_IMAGE_DOWNLOADER)
    private readonly download: LeadImageDownloader,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 5_000);
    this.timer.unref();
    void this.tick().catch(() => undefined);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async list(actor: ActorContext, leadId: string) {
    const scope = await this.access.buildLeadScope(actor, 'lead.read');
    const lead = await this.database.lead.findFirst({
      where: { id: leadId, ...scope },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException({ code: 'NOT_AVAILABLE' });
    return this.database.leadImageImportTask.findMany({
      where: { leadId, departmentId: actor.departmentId },
      orderBy: [
        { rowNumber: 'asc' },
        { productNumber: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        rowNumber: true,
        productNumber: true,
        productId: true,
        url: true,
        status: true,
        failureCode: true,
        contentVersionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async retry(
    actor: ActorContext,
    leadId: string,
    taskId: string,
    url: string,
  ) {
    if (
      typeof url !== 'string' ||
      url.length > 2048 ||
      !/^https?:\/\//iu.test(url)
    )
      throw new ConflictException({ code: 'INVALID_IMAGE_URL' });
    const scope = await this.access.buildLeadScope(actor, 'lead.edit');
    const lead = await this.database.lead.findFirst({
      where: { id: leadId, ...scope },
      select: { id: true, status: true },
    });
    if (!lead) throw new NotFoundException({ code: 'NOT_AVAILABLE' });
    if (lead.status === 'ARCHIVED')
      throw new ForbiddenException({ code: 'ARCHIVED_READ_ONLY' });
    const task = await this.database.leadImageImportTask.findFirst({
      where: { id: taskId, leadId, departmentId: actor.departmentId },
    });
    if (!task) throw new NotFoundException({ code: 'NOT_AVAILABLE' });
    if (task.status !== 'FAILED')
      throw new ConflictException({ code: 'IMAGE_TASK_NOT_FAILED' });
    const hash = createHash('sha256').update(url).digest('hex');
    const duplicate = await this.database.leadImageImportTask.findFirst({
      where: {
        leadId,
        productId: task.productId,
        urlSha256: hash,
        id: { not: taskId },
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException({ code: 'IMAGE_URL_ALREADY_QUEUED' });
    const result = await this.database.leadImageImportTask.updateMany({
      where: {
        id: taskId,
        leadId,
        departmentId: actor.departmentId,
        status: 'FAILED',
      },
      data: {
        url,
        urlSha256: hash,
        generation: { increment: 1 },
        status: 'PENDING',
        failureCode: null,
        leaseUntil: null,
        ...(hash === task.urlSha256
          ? {}
          : { contentVersionId: null, uploadDraftId: null }),
        attemptCount: 0,
      },
    });
    if (result.count !== 1)
      throw new ConflictException({ code: 'IMAGE_TASK_CHANGED' });
    return { id: taskId, status: 'PENDING' };
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      while (this.active < 2) {
        const task = await this.lease();
        if (!task) return;
        this.active += 1;
        void this.process(task)
          .catch(() => undefined)
          .finally(() => {
            this.active -= 1;
          });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async lease() {
    const now = new Date();
    await this.database.leadImageImportTask.updateMany({
      where: {
        attemptCount: { gte: 5 },
        OR: [
          { status: 'PENDING' },
          { status: 'LEASED', leaseUntil: { lt: now } },
        ],
      },
      data: {
        status: 'FAILED',
        failureCode: 'PROCESSING_TIMEOUT',
        leaseUntil: null,
      },
    });
    const candidate = await this.database.leadImageImportTask.findFirst({
      where: {
        attemptCount: { lt: 5 },
        OR: [
          { status: 'PENDING' },
          { status: 'LEASED', leaseUntil: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return null;
    const changed = await this.database.leadImageImportTask.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        attemptCount: candidate.attemptCount,
        ...(candidate.status === 'LEASED' ? { leaseUntil: { lt: now } } : {}),
      },
      data: {
        status: 'LEASED',
        attemptCount: { increment: 1 },
        leaseUntil: new Date(now.getTime() + 300_000),
      },
    });
    return changed.count === 1
      ? { ...candidate, attemptCount: candidate.attemptCount + 1 }
      : null;
  }

  private async process(
    task: NonNullable<Awaited<ReturnType<LeadImageImportService['lease']>>>,
  ): Promise<void> {
    try {
      const fence = () => ({
        id: task.id,
        status: 'LEASED',
        generation: task.generation,
        attemptCount: task.attemptCount,
        urlSha256: task.urlSha256,
        leaseUntil: { gt: new Date() },
      });
      const assertLease = async () => {
        const owned = await this.database.leadImageImportTask.findFirst({
          where: fence(),
          select: { id: true },
        });
        if (!owned) throw new LostImageLease();
      };
      await assertLease();
      const user = await this.database.userAccount.findFirst({
        where: {
          id: task.actorUserId,
          active: true,
          accountType: 'INTERNAL',
          memberships: {
            some: { departmentId: task.departmentId, active: true },
          },
        },
        select: { authorizationRevision: true },
      });
      if (!user) throw new ForbiddenException({ code: 'ACTOR_UNAVAILABLE' });
      const actor: ActorContext = {
        userId: task.actorUserId,
        departmentId: task.departmentId,
        authorizationRevision: user.authorizationRevision,
      };
      const filename = `import-${task.id}-${task.urlSha256}`;
      let draftId = task.uploadDraftId;
      let versionId = task.contentVersionId;
      if (!versionId && draftId)
        versionId =
          (
            await this.database.contentVersion.findUnique({
              where: { sourceUploadDraftId: draftId },
              select: { id: true },
            })
          )?.id ?? null;
      if (!versionId) {
        const image = await this.download(task.url);
        await assertLease();
        if (!draftId) {
          const draft = await this.materials.createUploadDraft(actor, {
            ownerType: 'LEAD',
            ownerId: task.leadId,
            category: 'LEAD_SCREENSHOT',
            purpose: 'LEAD_SCREENSHOT',
            originalFilename: filename,
            declaredMimeType: image.mimeType,
          });
          const claimed = await this.database.leadImageImportTask.updateMany({
            where: { ...fence(), uploadDraftId: null },
            data: { uploadDraftId: draft.id },
          });
          if (claimed.count !== 1) throw new LostImageLease();
          draftId = draft.id;
        }
        await assertLease();
        const existing = await this.database.contentVersion.findUnique({
          where: { sourceUploadDraftId: draftId },
          select: { id: true },
        });
        if (existing) versionId = existing.id;
        else {
          try {
            const uploaded = await this.materials.finalizeUpload(
              actor,
              draftId,
              Readable.from([image.bytes]),
              {
                taskId: task.id,
                generation: task.generation,
                attemptCount: task.attemptCount,
                urlSha256: task.urlSha256,
              },
            );
            versionId = uploaded.contentVersionId;
          } catch (cause) {
            // A prior worker can finish the same one-time draft after takeover.
            for (let attempt = 0; attempt < 25; attempt++) {
              const completed = await this.database.contentVersion.findUnique({
                where: { sourceUploadDraftId: draftId },
                select: { id: true },
              });
              if (completed) {
                versionId = completed.id;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            if (!versionId) throw cause;
          }
        }
      }
      if (!draftId || !versionId) throw new LostImageLease();
      const stored = await this.database.leadImageImportTask.updateMany({
        where: { ...fence(), uploadDraftId: draftId },
        data: {
          contentVersionId: versionId,
        },
      });
      if (stored.count !== 1) throw new LostImageLease();
      for (let attempt = 0; attempt < 3; attempt++) {
        await assertLease();
        const lead = await this.database.lead.findFirst({
          where: { id: task.leadId, departmentId: task.departmentId },
          select: {
            version: true,
            status: true,
            products: {
              where: { id: task.productId },
              select: { screenshots: { select: { contentVersionId: true } } },
            },
          },
        });
        if (!lead || lead.status === 'ARCHIVED' || lead.products.length !== 1)
          throw new ForbiddenException({ code: 'LEAD_NOT_EDITABLE' });
        const ids = lead.products[0]!.screenshots.map(
          (item) => item.contentVersionId,
        );
        if (ids.includes(versionId)) break;
        try {
          await this.leads.updateProductScreenshots(
            actor,
            task.leadId,
            task.productId,
            {
              expectedVersion: lead.version,
              screenshotContentVersionIds: [...ids, versionId],
            },
            {
              taskId: task.id,
              generation: task.generation,
              attemptCount: task.attemptCount,
              urlSha256: task.urlSha256,
              uploadDraftId: draftId,
              contentVersionId: versionId,
            },
          );
          break;
        } catch (cause) {
          if (attempt === 2 || !(cause instanceof ConflictException))
            throw cause;
        }
      }
      await this.database.leadImageImportTask.updateMany({
        where: { ...fence(), uploadDraftId: draftId },
        data: { status: 'ATTACHED', leaseUntil: null, failureCode: null },
      });
    } catch (cause) {
      if (cause instanceof LostImageLease) return;
      const code =
        cause instanceof RemoteImageError
          ? cause.code
          : cause instanceof ForbiddenException
            ? 'NOT_AUTHORIZED'
            : 'PROCESSING_ERROR';
      await this.database.leadImageImportTask.updateMany({
        where: {
          id: task.id,
          status: 'LEASED',
          generation: task.generation,
          attemptCount: task.attemptCount,
          urlSha256: task.urlSha256,
        },
        data: { status: 'FAILED', failureCode: code, leaseUntil: null },
      });
    }
  }
}
