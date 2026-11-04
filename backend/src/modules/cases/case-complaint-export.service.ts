import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { zipSync, strToU8 } from 'fflate';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import {
  ComplaintExportDownloadDto,
  ComplaintExportPreviewDto,
  type ComplaintExportCandidate,
  type ComplaintExportPreviewItem,
  type ComplaintExportResultItem,
} from './case-complaint-export.dto';

const maxCases = 20;
const maxFiles = 100;
const maxBytes = 100 * 1024 * 1024;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function safeZipSegment(value: string): string {
  const clean = value
    .normalize('NFC')
    .replace(/[\\/\p{Cc}<>:"|?*]/gu, '_')
    .replace(/^\.+$/u, '_')
    .trim()
    .replace(/[. ]+$/u, '')
    .slice(0, 80);
  return clean || '未命名';
}
function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  while (used.has(candidate.toLowerCase()))
    candidate = `${stem} (${index++})${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
function validIds(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length >= 1 &&
    ids.length <= maxCases &&
    ids.every((id) => typeof id === 'string' && uuid.test(id)) &&
    new Set(ids).size === ids.length
  );
}

@Injectable()
export class CaseComplaintExportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  private async authorizeExport(actor: ActorContext): Promise<void> {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    await this.access.authorizeDepartmentAction(actor, 'case.export');
  }
  private async readableCase(
    actor: ActorContext,
    caseId: string,
  ): Promise<{ businessNo: string } | null> {
    const record = await this.database.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        businessNo: true,
        departmentId: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
      },
    });
    if (!record) return null;
    try {
      await this.access.authorizeCase(actor, 'case.read', {
        departmentId: record.departmentId,
        responsibleUserId: record.responsibleUserId,
        ...(record.responsibleMembership.teamId
          ? { teamId: record.responsibleMembership.teamId }
          : {}),
      });
      return { businessNo: record.businessNo };
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      throw error;
    }
  }
  private async candidates(
    actor: ActorContext,
    caseId: string,
  ): Promise<ComplaintExportCandidate[]> {
    const list = await this.materials.listOwnerMaterials(actor, 'CASE', caseId);
    const confirmed = await this.database.caseComplaintConfirmation.findUnique({
      where: { caseId },
      select: { confirmedComplaintContentVersionId: true },
    });
    const submitted = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        actionEvent: { is: { action: 'case.complaint.submitted' } },
      },
      select: { contentVersionId: true },
    });
    const submittedIds = new Set(submitted.map((row) => row.contentVersionId));
    return list.items
      .filter(
        (material) =>
          material.ownerType === 'CASE' &&
          material.ownerId === caseId &&
          material.category === 'COMPLAINT',
      )
      .flatMap((material) =>
        material.contentVersions.map((version) => ({
          materialId: material.id,
          contentVersionId: version.id,
          filename: version.originalFilename,
          sizeBytes: version.sizeBytes,
          tags: [
            'UPLOADED',
            ...(submittedIds.has(version.id) ? ['SUBMITTED' as const] : []),
            ...(confirmed?.confirmedComplaintContentVersionId === version.id
              ? ['CONFIRMED' as const]
              : []),
          ] as ComplaintExportCandidate['tags'],
        })),
      );
  }
  async preview(
    actor: ActorContext,
    input: ComplaintExportPreviewDto,
  ): Promise<{
    items: ComplaintExportPreviewItem[];
    limits: { maxCases: number; maxFiles: number; maxBytes: number };
  }> {
    if (!validIds(input?.caseIds))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '请选择1至20件不同案件',
      });
    await this.authorizeExport(actor);
    const items: ComplaintExportPreviewItem[] = [];
    for (const caseId of input.caseIds) {
      const record = await this.readableCase(actor, caseId);
      if (!record) {
        items.push({
          caseId,
          status: 'UNAVAILABLE',
          candidates: [],
          reason: 'CASE_UNAVAILABLE',
        });
        continue;
      }
      try {
        const candidates = await this.candidates(actor, caseId);
        items.push({
          caseId,
          businessNo: record.businessNo,
          status: candidates.length ? 'READY' : 'MISSING',
          candidates,
          ...(candidates.length ? {} : { reason: 'COMPLAINT_MISSING' }),
        });
      } catch (error) {
        if (error instanceof ForbiddenException)
          items.push({
            caseId,
            status: 'UNAVAILABLE',
            candidates: [],
            reason: 'CASE_UNAVAILABLE',
          });
        else throw error;
      }
    }
    return { items, limits: { maxCases, maxFiles, maxBytes } };
  }
  async download(
    actor: ActorContext,
    input: ComplaintExportDownloadDto,
  ): Promise<{ bytes: Buffer; results: ComplaintExportResultItem[] }> {
    const selections = input?.selections;
    if (
      !Array.isArray(selections) ||
      selections.length < 1 ||
      selections.length > maxFiles ||
      selections.some(
        (item) =>
          !item ||
          !uuid.test(item.caseId) ||
          !uuid.test(item.materialId) ||
          !uuid.test(item.contentVersionId),
      ) ||
      new Set(selections.map((item) => item.caseId)).size > maxCases ||
      new Set(
        selections.map(
          (item) =>
            `${item.caseId}:${item.materialId}:${item.contentVersionId}`,
        ),
      ).size !== selections.length
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '请明确选择诉状版本，最多20案、100个文件',
      });
    await this.authorizeExport(actor);
    const entries: Record<string, Uint8Array> = {};
    const resultByCase = new Map<string, ComplaintExportResultItem>();
    const results: ComplaintExportResultItem[] = [];
    const files: Array<{
      caseId: string;
      materialId: string;
      contentVersionId: string;
      businessNo?: string;
      path?: string;
      status: 'SUCCESS' | 'FAILED';
      errorCode?: string;
    }> = [];
    const failures: Array<{
      caseId: string;
      materialId: string;
      contentVersionId: string;
      filename: string | null;
      reason: string;
    }> = [];
    const usedFolders = new Set<string>();
    const folders = new Map<string, string>();
    const usedNames = new Map<string, Set<string>>();
    let totalBytes = 0;
    let successCount = 0;
    for (const item of selections) {
      let candidateFilename: string | null = null;
      let caseResult = resultByCase.get(item.caseId);
      if (!caseResult) {
        caseResult = { caseId: item.caseId, successCount: 0, failCount: 0 };
        resultByCase.set(item.caseId, caseResult);
        results.push(caseResult);
      }
      const failed = (errorCode: string, businessNo?: string) => {
        caseResult!.failCount += 1;
        caseResult!.errorCode = errorCode;
        files.push({
          caseId: item.caseId,
          materialId: item.materialId,
          contentVersionId: item.contentVersionId,
          businessNo,
          status: 'FAILED',
          errorCode,
        });
        failures.push({
          caseId: item.caseId,
          materialId: item.materialId,
          contentVersionId: item.contentVersionId,
          filename: candidateFilename,
          reason: errorCode,
        });
      };
      try {
        await this.authorizeExport(actor);
        const record = await this.readableCase(actor, item.caseId);
        if (!record) {
          failed('CASE_UNAVAILABLE');
          continue;
        }
        const choices = await this.candidates(actor, item.caseId);
        const candidate = choices.find(
          (choice) =>
            choice.materialId === item.materialId &&
            choice.contentVersionId === item.contentVersionId,
        );
        if (!candidate) {
          failed('VERSION_UNAVAILABLE', record.businessNo);
          continue;
        }
        candidateFilename = candidate.filename;
        if (candidate.sizeBytes > maxBytes - totalBytes) {
          failed('SIZE_LIMIT', record.businessNo);
          continue;
        }
        await this.authorizeExport(actor);
        const opened = await this.materials.openVersion(
          actor,
          item.materialId,
          item.contentVersionId,
        );
        if (opened.sizeBytes > maxBytes - totalBytes) {
          if (
            'destroy' in opened.stream &&
            typeof opened.stream.destroy === 'function'
          )
            opened.stream.destroy();
          failed('SIZE_LIMIT', record.businessNo);
          continue;
        }
        const chunks: Buffer[] = [];
        let actualBytes = 0;
        for await (const chunk of opened.stream) {
          const bytes =
            typeof chunk === 'string'
              ? Buffer.from(chunk, 'utf8')
              : Buffer.from(chunk);
          actualBytes += bytes.length;
          if (actualBytes > maxBytes - totalBytes) {
            throw new ConflictException({ code: 'SIZE_LIMIT' });
          }
          chunks.push(bytes);
        }
        if (actualBytes === 0 || actualBytes !== opened.sizeBytes)
          throw new Error('Complaint file bytes are incomplete');
        let folder = folders.get(item.caseId);
        if (!folder) {
          folder = uniqueName(safeZipSegment(record.businessNo), usedFolders);
          folders.set(item.caseId, folder);
          usedNames.set(item.caseId, new Set<string>());
        }
        const filename = uniqueName(
          safeZipSegment(opened.originalFilename),
          usedNames.get(item.caseId)!,
        );
        const path = `${folder}/${filename}`;
        entries[path] = Buffer.concat(chunks);
        totalBytes += actualBytes;
        successCount += 1;
        caseResult.successCount += 1;
        files.push({
          caseId: item.caseId,
          materialId: item.materialId,
          contentVersionId: item.contentVersionId,
          businessNo: record.businessNo,
          path,
          status: 'SUCCESS',
        });
      } catch (error) {
        if (error instanceof ForbiddenException) failed('CASE_UNAVAILABLE');
        else if (
          error instanceof ConflictException &&
          (error.getResponse() as { code?: string }).code === 'SIZE_LIMIT'
        )
          failed('SIZE_LIMIT');
        else failed('FILE_UNAVAILABLE');
      }
    }
    if (successCount === 0)
      throw new ConflictException({
        code: 'CASE_EXPORT_EMPTY',
        message: '所选诉状均未能导出',
        details: { files: failures },
      });
    entries['manifest.json'] = strToU8(
      JSON.stringify(
        {
          kind: 'CASE_COMPLAINT_EXPORT',
          generatedAt: new Date().toISOString(),
          limits: { maxCases, maxFiles, maxBytes },
          files,
        },
        null,
        2,
      ),
    );
    const bytes = Buffer.from(zipSync(entries, { level: 0 }));
    if (bytes.length > maxBytes + 1024 * 1024)
      throw new ConflictException({
        code: 'CASE_EXPORT_SIZE_LIMIT',
        message: '导出包超过大小上限',
        details: results,
      });
    return { bytes, results };
  }
}
