import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/** 待开庭 → 待判决：开庭日期已过（严格早于今天）的案子自动推进。 */
export const HEARING_PASSED_AUDIT = 'case.hearing.date_passed';

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

function shanghaiToday(now: Date): Date {
  const offset = 8 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + offset);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}

@Injectable()
export class CaseHearingAdvanceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CaseHearingAdvanceScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce(), CHECK_INTERVAL_MS);
    // 进程退出时不要把定时器挂住。
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 单次扫描。幂等：以 stage + version 作为条件更新，重复执行不会重复推进。
   * 单独暴露出来便于用例直接调用。
   */
  async runOnce(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const today = shanghaiToday(now);
      const due = await this.database.case.findMany({
        where: {
          stage: 'WAITING_HEARING',
          currentHearingAdvance: {
            is: { arrangement: { hearingAt: { lt: today } } },
          },
        },
        select: { id: true, departmentId: true, version: true },
        take: 200,
      });
      let advanced = 0;
      for (const item of due) {
        try {
          if (await this.advance(item)) advanced += 1;
        } catch (error) {
          this.logger.warn(
            `推进开庭案件失败 case=${item.id}: ${(error as Error).message}`,
          );
        }
      }
      if (advanced > 0) this.logger.log(`开庭日期已过，自动推进 ${advanced} 件`);
      return advanced;
    } finally {
      this.running = false;
    }
  }

  private async advance(item: {
    id: string;
    departmentId: string;
    version: number;
  }): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const changed = await tx.case.updateMany({
        where: {
          id: item.id,
          departmentId: item.departmentId,
          stage: 'WAITING_HEARING',
          version: item.version,
        },
        data: { stage: 'WAITING_JUDGMENT', version: { increment: 1 } },
      });
      if (changed.count !== 1) return false;
      await tx.auditEvent.create({
        data: {
          departmentId: item.departmentId,
          actorKind: 'SYSTEM',
          actorUserId: null,
          resourceType: 'CASE',
          resourceId: item.id,
          action: HEARING_PASSED_AUDIT,
          details: {
            fromStage: 'WAITING_HEARING',
            toStage: 'WAITING_JUDGMENT',
            fromVersion: item.version,
            toVersion: item.version + 1,
          },
        },
      });
      return true;
    });
  }
}
