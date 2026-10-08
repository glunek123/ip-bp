import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CaseHearingService } from './case-hearing.service';
import {
  CASE_HEARING_CLOCK,
  CaseHearingClock,
  CaseHearingSignal,
} from './case-hearing-signal';
import { Inject } from '@nestjs/common';

@Injectable()
export class CaseHearingSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CaseHearingSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private scanning: Promise<void> | null = null;
  private pending = false;
  private active = false;

  constructor(
    private readonly hearing: CaseHearingService,
    private readonly signal: CaseHearingSignal,
    @Inject(CASE_HEARING_CLOCK) private readonly clock: CaseHearingClock,
  ) {}

  async onModuleInit(): Promise<void> {
    this.active = true;
    this.unsubscribe = this.signal.subscribe(() => {
      void this.requestScan();
    });
    this.timer = setInterval(() => {
      void this.requestScan();
    }, 60_000);
    this.timer.unref?.();
    await this.requestScan();
  }

  onModuleDestroy(): void {
    this.active = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private requestScan(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.scanning !== null) {
      this.pending = true;
      return this.scanning;
    }
    const run = async () => {
      do {
        this.pending = false;
        try {
          const result = await this.hearing.advanceDue(this.clock.now());
          if (result.failed > 0)
            this.logger.warn(`Hearing scan will retry ${result.failed} cases`);
        } catch (error) {
          this.logger.error(
            'Hearing scan failed; next persistent scan will retry',
            error,
          );
        }
      } while (this.active && this.pending);
    };
    this.scanning = run().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }
}
