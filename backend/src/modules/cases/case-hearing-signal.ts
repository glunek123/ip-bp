import { Injectable } from '@nestjs/common';

@Injectable()
export class CaseHearingSignal {
  private listener: (() => void) | null = null;
  subscribe(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
  wake(): void {
    this.listener?.();
  }
}

export const CASE_HEARING_CLOCK = Symbol('CASE_HEARING_CLOCK');
export interface CaseHearingClock {
  now(): Date;
}
export class SystemCaseHearingClock implements CaseHearingClock {
  now(): Date {
    return new Date();
  }
}
