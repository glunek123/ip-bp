import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { safeZipSegment } from './case-complaint-export.service';

export const caseFileGroups = [
  { id: 'NOTARY_CERTIFICATE', name: '公证书' },
  { id: 'NOTARY_DISCLOSURE', name: '披露文件' },
  { id: 'COMPLAINT', name: '起诉状' },
  { id: 'ACCEPTANCE_NOTICE', name: '立案受理通知书' },
  { id: 'CASE_PRESERVATION_DOCUMENT', name: '保全文书' },
  { id: 'COURT_PAYMENT_PROOF', name: '缴费凭证' },
  { id: 'SERVICE_DOCUMENT', name: '送达文书' },
  { id: 'CASE_COURT_DISCLOSURE_ATTACHMENT', name: '披露数据附件' },
  { id: 'JUDGMENT', name: '判决书' },
  { id: 'SECOND_INSTANCE_DOCUMENT', name: '二审文书' },
  { id: 'SECOND_INSTANCE_SERVICE', name: '二审送达文书' },
  { id: 'SECOND_INSTANCE_JUDGMENT', name: '二审判决书' },
  { id: 'EXECUTION_FILING_PROOF', name: '执行立案截图' },
  { id: 'EXECUTION_FORMAL_DOCUMENT', name: '执行文书' },
  { id: 'CASE_CLOSURE_DOCUMENT', name: '结案文书' },
  { id: 'CASE_CLOSURE_PAYMENT_PROOF', name: '付款凭证' },
] as const;

export type CaseFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  groupId: string;
  isCurrent: boolean;
  labels: string[];
  sha256: string;
};

const maxFiles = 100;
const maxBytes = 100 * 1024 * 1024;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const supplementGroups = new Set([
  'CASE_PRESERVATION_DOCUMENT',
  'CASE_COURT_DISCLOSURE_ATTACHMENT',
  'EXECUTION_FORMAL_DOCUMENT',
]);

function uniqueName(name: string, names: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let value = name;
  for (let suffix = 2; names.has(value.toLowerCase()); suffix++)
    value = `${base} (${suffix})${ext}`;
  names.add(value.toLowerCase());
  return value;
}

@Injectable()
export class CaseFileCatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  private async readableCase(actor: ActorContext, caseId: string) {
    const record = await this.database.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        businessNo: true,
        departmentId: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
      },
    });
    if (!record) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    await this.access.authorizeCase(actor, 'case.read', {
      departmentId: record.departmentId,
      responsibleUserId: record.responsibleUserId,
      ...(record.responsibleMembership.teamId
        ? { teamId: record.responsibleMembership.teamId }
        : {}),
    });
    return record;
  }

  async catalog(actor: ActorContext, caseId: string) {
    const record = await this.readableCase(actor, caseId);
    const metadata = await this.materials.listCaseResourceMetadata(
      actor,
      caseId,
    );
    const supplementRefs = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'CASE_SUPPLEMENT_ENTRY',
        materialId: { in: metadata.map((file) => file.materialId) },
        contentVersionId: { in: metadata.map((file) => file.contentVersionId) },
      },
      select: {
        materialId: true,
        contentVersionId: true,
        purpose: true,
        resourceId: true,
      },
    });
    const supplementKeys = new Set(
      supplementRefs.map((ref) =>
        JSON.stringify([ref.materialId, ref.contentVersionId, ref.purpose]),
      ),
    );
    const caseRefs = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        materialId: { in: metadata.map((file) => file.materialId) },
      },
      select: {
        materialId: true,
        contentVersionId: true,
        purpose: true,
        actionEventId: true,
        actionEvent: { select: { action: true, details: true } },
      },
    });
    const files: CaseFile[] = metadata.flatMap((file) => {
      const groupId = file.category;
      if (
        supplementGroups.has(groupId) &&
        !supplementKeys.has(
          JSON.stringify([file.materialId, file.contentVersionId, groupId]),
        )
      )
        return [];
      return [
        {
          materialId: file.materialId,
          contentVersionId: file.contentVersionId,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: Number(file.sizeBytes),
          groupId,
          isCurrent: file.isCurrent,
          labels: [
            file.isCurrent ? '当前版本' : '历史版本',
            ...(groupId === 'NOTARY_CERTIFICATE' ||
            groupId === 'NOTARY_DISCLOSURE'
              ? ['入案冻结']
              : []),
            ...caseRefs
              .filter(
                (ref) =>
                  ref.materialId === file.materialId &&
                  ref.contentVersionId === file.contentVersionId &&
                  ref.actionEventId !== null,
              )
              .flatMap((ref) => {
                const details = ref.actionEvent?.details;
                const round =
                  details &&
                  typeof details === 'object' &&
                  !Array.isArray(details) &&
                  'trialRoundId' in details &&
                  typeof details.trialRoundId === 'string'
                    ? [`审级轮次：${details.trialRoundId}`]
                    : [];
                return [
                  `业务来源：${ref.actionEvent?.action ?? ref.purpose}`,
                  ...round,
                ];
              }),
            ...supplementRefs
              .filter(
                (ref) =>
                  ref.materialId === file.materialId &&
                  ref.contentVersionId === file.contentVersionId &&
                  ref.purpose === groupId,
              )
              .map((ref) => `补录记录：${ref.resourceId}`),
          ],
          sha256: file.sha256,
        },
      ];
    });
    // The paid fee record establishes an accounting link, not the purpose of
    // the attached file. Keep it outside the confirmed court-payment group.
    try {
      await this.access.authorizeDepartmentAction(actor, 'fee.read');
      const paid = await this.database.feeRecord.findMany({
        where: {
          departmentId: actor.departmentId,
          caseId,
          deletedAt: null,
          type: '诉讼费',
          status: '已支付',
          proofMaterialId: { not: null },
          proofContentVersionId: { not: null },
        },
        select: { proofMaterialId: true, proofContentVersionId: true },
      });
      for (const row of paid) {
        if (!row.proofMaterialId || !row.proofContentVersionId) continue;
        const material = await this.database.material.findFirst({
          where: {
            id: row.proofMaterialId,
            departmentId: actor.departmentId,
            ownerType: 'CASE',
            ownerId: caseId,
            category: 'FEE_PROOF',
            status: 'ACTIVE',
          },
          select: {
            currentVersionId: true,
            contentVersions: {
              where: { id: row.proofContentVersionId, status: 'AVAILABLE' },
              select: {
                id: true,
                originalFilename: true,
                mimeType: true,
                sizeBytes: true,
                sha256: true,
              },
            },
          },
        });
        const version = material?.contentVersions[0];
        if (!version) continue;
        try {
          const opened = await this.materials.openVersion(
            actor,
            row.proofMaterialId,
            version.id,
          );
          if (
            'destroy' in opened.stream &&
            typeof opened.stream.destroy === 'function'
          )
            opened.stream.destroy();
        } catch {
          continue;
        }
        files.push({
          materialId: row.proofMaterialId,
          contentVersionId: version.id,
          originalFilename: version.originalFilename,
          mimeType: version.mimeType,
          sizeBytes: Number(version.sizeBytes),
          groupId: 'FEE_PROOF',
          isCurrent: material?.currentVersionId === version.id,
          labels: [
            '已支付诉讼费关联凭证（费用登记，未核回执用途）',
            material?.currentVersionId === version.id ? '当前版本' : '历史版本',
          ],
          sha256: version.sha256,
        });
      }
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
    }
    const uniqueFiles = [
      ...new Map(
        files.map((file) => [
          JSON.stringify([file.materialId, file.contentVersionId]),
          file,
        ]),
      ).values(),
    ];
    const known = new Set<string>(caseFileGroups.map((group) => group.id));
    return {
      caseId,
      businessNo: record.businessNo,
      groups: caseFileGroups.map((group) => ({
        ...group,
        files: uniqueFiles.filter((file) => file.groupId === group.id),
      })),
      otherFiles: uniqueFiles.filter((file) => !known.has(file.groupId)),
      limits: { maxFiles, maxBytes },
    };
  }

  async export(
    actor: ActorContext,
    caseId: string,
    selections: Array<{ materialId: string; contentVersionId: string }>,
  ) {
    if (
      !Array.isArray(selections) ||
      selections.length < 1 ||
      selections.length > maxFiles ||
      selections.some(
        (item) =>
          !item ||
          !uuid.test(item.materialId) ||
          !uuid.test(item.contentVersionId),
      ) ||
      new Set(
        selections.map((item) =>
          JSON.stringify([item.materialId, item.contentVersionId]),
        ),
      ).size !== selections.length
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    await this.access.authorizeDepartmentAction(actor, 'case.export');
    const entries: Record<string, Uint8Array> = {};
    const used = new Set<string>(['manifest.json']);
    const results: Array<{
      materialId: string;
      contentVersionId: string;
      status: 'SUCCESS' | 'FAILED';
      path?: string;
      reason?: string;
      groupId?: string;
      filename?: string;
      labels?: string[];
    }> = [];
    let totalBytes = 0;
    for (const selected of selections) {
      try {
        await this.access.authorizeDepartmentAction(actor, 'case.export');
        const available = await this.catalog(actor, caseId);
        const file = [
          ...available.groups.flatMap((group) => group.files),
          ...available.otherFiles,
        ].find(
          (entry) =>
            entry.materialId === selected.materialId &&
            entry.contentVersionId === selected.contentVersionId,
        );
        if (!file) throw new NotFoundException();
        if (file.sizeBytes > maxBytes - totalBytes)
          throw new ConflictException({ code: 'SIZE_LIMIT' });
        const opened = await this.materials.openVersion(
          actor,
          selected.materialId,
          selected.contentVersionId,
        );
        const chunks: Buffer[] = [];
        let actualBytes = 0;
        for await (const chunk of opened.stream) {
          const bytes = Buffer.from(chunk);
          actualBytes += bytes.length;
          if (actualBytes > maxBytes - totalBytes)
            throw new ConflictException({ code: 'SIZE_LIMIT' });
          chunks.push(bytes);
        }
        const content = Buffer.concat(chunks);
        if (
          !actualBytes ||
          actualBytes !== opened.sizeBytes ||
          createHash('sha256').update(content).digest('hex') !== file.sha256
        )
          throw new Error('Material content mismatch');
        const groupName =
          available.groups.find((group) => group.id === file.groupId)?.name ??
          '其他材料与历史';
        const folder = `${safeZipSegment(available.businessNo)}/${safeZipSegment(groupName)}`;
        const filename = uniqueName(
          safeZipSegment(opened.originalFilename),
          used,
        );
        const path = `${folder}/${filename}`;
        entries[path] = content;
        totalBytes += actualBytes;
        results.push({
          ...selected,
          status: 'SUCCESS',
          path,
          groupId: file.groupId,
          filename: opened.originalFilename,
          labels: file.labels,
        });
      } catch (error) {
        const reason =
          error instanceof ConflictException
            ? 'SIZE_LIMIT'
            : error instanceof ForbiddenException ||
                error instanceof NotFoundException
              ? 'VERSION_UNAVAILABLE'
              : 'FILE_UNAVAILABLE';
        results.push({ ...selected, status: 'FAILED', reason });
      }
    }
    if (!results.some((result) => result.status === 'SUCCESS'))
      throw new ConflictException({
        code: 'CASE_EXPORT_EMPTY',
        details: { files: results },
      });
    entries['manifest.json'] = strToU8(
      JSON.stringify(
        {
          kind: 'CASE_FILE_EXPORT',
          caseId,
          generatedAt: new Date().toISOString(),
          limits: { maxFiles, maxBytes },
          files: results,
        },
        null,
        2,
      ),
    );
    const bytes = Buffer.from(zipSync(entries, { level: 0 }));
    if (bytes.length > maxBytes + 1024 * 1024)
      throw new ConflictException({ code: 'CASE_EXPORT_SIZE_LIMIT' });
    return { bytes, results };
  }
}
