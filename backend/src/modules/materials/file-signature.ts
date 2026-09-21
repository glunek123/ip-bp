import { BlobValidationError } from './private-blob-storage';

const signatures = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  {
    mime: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', riff: true },
] as const;

export function detectMimeType(prefix: Buffer): string {
  for (const signature of signatures) {
    if ('bytes' in signature) {
      if (
        prefix.length >= signature.bytes.length &&
        signature.bytes.every((value, index) => prefix[index] === value)
      ) {
        return signature.mime;
      }
      continue;
    }
    if (
      prefix.length >= 12 &&
      prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
      prefix.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return signature.mime;
    }
  }
  throw new BlobValidationError('Unsupported file signature');
}

export function containsPdfEncryptionToken(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from('/Encrypt', 'ascii'));
}
