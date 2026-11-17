import { Injectable } from '@nestjs/common';
import { zipSync } from 'fflate';
import { ActorContext } from '../../access-control/actor-context';
import { CaseReadService } from './case-read.service';
import { MaterialService } from '../materials';

type ExecutionSubmission = { toVersion: number; files: CaseFile[] };
type CaseFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
};

@Injectable()
export class CaseExecutionArchiveService {
  constructor(
    private readonly reads: CaseReadService,
    private readonly materials: MaterialService,
  ) {}

  /**
   * 把所选案件当前的执行申请文书打成一个 zip。
   * 逐案走详情读取（自带 case.read 权限），文件再走材料版本读取（自带所有者校验）。
   */
  async archive(
    actor: ActorContext,
    caseIds: string[],
  ): Promise<{
    filename: string;
    buffer: Uint8Array;
    caseCount: number;
    fileCount: number;
    skipped: string[];
  }> {
    const entries: Record<string, Uint8Array> = {};
    const skipped: string[] = [];
    let fileCount = 0;
    const seen = new Map<string, number>();

    for (const caseId of caseIds) {
      const detail = await this.reads.get(actor, caseId);
      const businessNo = detail.businessNo;
      const files = this.executionFiles(
        (
          detail as {
            executionSubmission?: {
              current?: ExecutionSubmission | null;
              submissions?: ExecutionSubmission[];
            };
          }
        ).executionSubmission,
      );
      if (!files.length) {
        skipped.push(businessNo);
        continue;
      }
      for (const file of files) {
        const opened = await this.materials.openVersion(
          actor,
          file.materialId,
          file.contentVersionId,
        );
        const chunks: Buffer[] = [];
        for await (const chunk of opened.stream as AsyncIterable<Buffer>)
          chunks.push(Buffer.from(chunk));
        const name = this.uniqueName(
          seen,
          `${this.safe(businessNo)}/${this.safe(file.originalFilename)}`,
        );
        entries[name] = new Uint8Array(Buffer.concat(chunks));
        fileCount += 1;
      }
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/gu, '');
    return {
      filename: `执行文书-${stamp}.zip`,
      buffer: zipSync(entries, { level: 6 }),
      caseCount: caseIds.length,
      fileCount,
      skipped,
    };
  }

  private executionFiles(execution?: {
    current?: ExecutionSubmission | null;
    submissions?: ExecutionSubmission[];
  }): CaseFile[] {
    // 优先当前有效提交；退化到最近一次提交。
    if (execution?.current?.files?.length) return execution.current.files;
    const submissions = execution?.submissions ?? [];
    if (!submissions.length) return [];
    const latest = submissions.reduce((left, right) =>
      right.toVersion > left.toVersion ? right : left,
    );
    return latest.files;
  }

  private uniqueName(seen: Map<string, number>, name: string): string {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0
      ? `${name.slice(0, dot)}(${count})${name.slice(dot)}`
      : `${name}(${count})`;
  }

  private safe(value: string): string {
    const cleaned = value
      .replace(/[\\/:*?"<>|\r\n]/gu, '_')
      .replace(/^\.+/u, '')
      .trim();
    return cleaned.length === 0 ? '未命名' : cleaned.slice(0, 120);
  }
}
