import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/** 待开庭 → 待判决：开庭日到达（或已过）后自动推进。 */
export const HEARING_PASSED_AUDIT = 'case.hearing.date_passed';

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 开庭当天的推进时点（上海时间，0-23）。
 * 默认 0：开庭日 00:00 之后的第一次扫描即推进。
 * 若希望当天先留出改期／补材料的时间，把它设为 18 之类即可，无需改代码。
 */
const DEFAULT_CUTOFF_HOUR = 0;

function shanghaiParts(now: Date): { date: Date; hour: number } {
  const offset = 8 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + offset);
  return {
    date: new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      ),
    ),
    hour: shifted.getUTCHours(),
  };
}

function cutoffHour(): number {
  const raw = Number(process.env.HEARING_ADVANCE_CUTOFF_HOUR ?? '');
  return Number.isInteger(raw) && raw >= 0 && raw <= 23
    ? raw
    : DEFAULT_CUTOFF_HOUR;
}

@Injectable()
export class CaseHearingAdvanceScheduler
  implements OnModuleInit, OnModuleDestroy
{
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
      const { date: today, hour } = shanghaiParts(now);
      const cutoff = cutoffHour();
      const rows = await this.database.case.findMany({
        where: {
          stage: 'WAITING_HEARING',
          // 待开庭阶段 currentHearingAdvance 为空，开庭日期在当前安排上。
          currentHearingArrangement: { is: { hearingAt: { lte: today } } },
        },
        select: {
          id: true,
          departmentId: true,
          version: true,
          currentHearingArrangement: { select: { hearingAt: true } },
        },
        take: 200,
      });
      // 当天的案件要等过了推进时点；之前的案件随时可推；未来的不动。
      const todayMs = today.getTime();
      const due = rows.filter((row) => {
        const hearingAt = row.currentHearingArrangement?.hearingAt ?? null;
        if (hearingAt === null) return false;
        const at = hearingAt.getTime();
        if (at > todayMs) return false;
        if (at < todayMs) return true;
        return hour >= cutoff;
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
      if (advanced > 0) this.logger.log(`开庭日已到，自动推进 ${advanced} 件`);
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
