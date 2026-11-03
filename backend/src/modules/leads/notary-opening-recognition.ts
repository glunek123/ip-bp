import { Injectable } from '@nestjs/common';

export type RecognitionResult = {
  status: 'DISABLED' | 'SUCCEEDED' | 'FAILED';
  trackingCandidate: string | null;
  senderCandidate: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
};

/** Replaceable local adapter. No image leaves this process. */
@Injectable()
export class NotaryOpeningRecognition {
  readonly mode: 'DISABLED' | 'MOCK' =
    process.env.NOTARY_OPENING_RECOGNITION_MODE === 'mock'
      ? 'MOCK'
      : 'DISABLED';

  recognize(filenames: readonly string[]): RecognitionResult {
    if (this.mode === 'DISABLED')
      return {
        status: 'DISABLED',
        trackingCandidate: null,
        senderCandidate: null,
      };
    const tokens = [
      ...new Set(filenames.flatMap((name) => name.match(/MOCK\d{11}/g) ?? [])),
    ];
    if (tokens.length !== 1)
      return {
        status: 'FAILED',
        trackingCandidate: null,
        senderCandidate: null,
      };
    return {
      status: 'SUCCEEDED',
      trackingCandidate: tokens[0],
      senderCandidate: null,
    };
  }
}
