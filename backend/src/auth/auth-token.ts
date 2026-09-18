import { createHash, createHmac, randomBytes } from 'node:crypto';

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function digestToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digestSource(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}
