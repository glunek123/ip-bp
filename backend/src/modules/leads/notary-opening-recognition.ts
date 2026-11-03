import { Injectable } from '@nestjs/common';

export const NOTARY_OPENING_RECOGNITION = Symbol('NOTARY_OPENING_RECOGNITION');
export type OpeningRecognitionPhoto = Readonly<{
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}>;
export type OpeningRecognitionInput = Readonly<{
  photos: readonly OpeningRecognitionPhoto[];
}>;

export type RecognitionResult = {
  status: 'DISABLED' | 'SUCCEEDED' | 'FAILED';
  trackingCandidate: string | null;
  senderCandidate: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
};

export interface OpeningRecognitionProvider {
  readonly mode: 'DISABLED' | 'MOCK';
  recognize(input: OpeningRecognitionInput): Promise<RecognitionResult>;
}

/** Replaceable local adapter. No image leaves this process. */
@Injectable()
export class NotaryOpeningRecognition implements OpeningRecognitionProvider {
  readonly mode: 'DISABLED' | 'MOCK' =
    process.env.NOTARY_OPENING_RECOGNITION_MODE === 'mock'
      ? 'MOCK'
      : 'DISABLED';

  async recognize(input: OpeningRecognitionInput): Promise<RecognitionResult> {
    if (this.mode === 'DISABLED')
      return {
        status: 'DISABLED',
        trackingCandidate: null,
        senderCandidate: null,
      };
    const tokens = [
      ...new Set(
        input.photos.flatMap(
          (photo) => photo.filename.match(/MOCK\d{11}/g) ?? [],
        ),
      ),
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
