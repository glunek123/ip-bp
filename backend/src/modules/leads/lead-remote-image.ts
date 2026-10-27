import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';

export class RemoteImageError extends Error {
  constructor(
    readonly code:
      | 'INVALID_URL'
      | 'BLOCKED_ADDRESS'
      | 'HTTP_ERROR'
      | 'INVALID_IMAGE'
      | 'TOO_LARGE'
      | 'TIMEOUT',
  ) {
    super(code);
  }
}
type Address = { address: string; family: 4 | 6 };
export type ImageTransport = (
  url: URL,
  address: Address,
  signal: AbortSignal,
) => Promise<{
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}>;
export type ImageResolver = (host: string) => Promise<Address[]>;
const maxImageBytes = 8 * 1024 * 1024;

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const [a, b, c] = parts;
    if (a === undefined || b === undefined || c === undefined) return false;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
      return false;
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    // Only native globally routed unicast is accepted; mapped/NAT64/transition
    // encodings and special-purpose ranges require explicit network policy.
    if (!/^[23][0-9a-f]/u.test(lower)) return false;
    if (/^(?:2001:db8|2001:0|2001:10|2001:20|2002:|2001:2|2001:3)/u.test(lower))
      return false;
    return true;
  }
  return false;
}

function validateUrl(raw: string): URL {
  if (!raw || /[\s\\<>]/u.test(raw) || raw.length > 2048)
    throw new RemoteImageError('INVALID_URL');
  if (/^https?:\/\/[^/?#]*@/iu.test(raw))
    throw new RemoteImageError('INVALID_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError('INVALID_URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new RemoteImageError('INVALID_URL');
  return url;
}

export const defaultImageResolver: ImageResolver = async (host) => {
  const literal = host.replace(/^\[|\]$/gu, '');
  if (isIP(literal))
    return [{ address: literal, family: isIP(literal) as 4 | 6 }];
  const entries = await dnsLookup(host, { all: true, verbatim: true });
  return entries.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));
};

export const pinnedImageTransport: ImageTransport = async (
  url,
  address,
  signal,
) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          Accept: 'image/png,image/jpeg,image/webp',
          'User-Agent': 'dev-cor-image-import/1',
        },
        signal,
        timeout: 5_000,
      },
      (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxImageBytes) {
            request.destroy(new RemoteImageError('TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: {
              location: response.headers.location,
              'content-type': response.headers['content-type'],
            },
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () =>
      request.destroy(new RemoteImageError('TIMEOUT')),
    );
    request.on('error', reject);
    request.end();
  });

export async function downloadLeadImage(
  raw: string,
  dependencies: { resolve: ImageResolver; transport: ImageTransport } = {
    resolve: defaultImageResolver,
    transport: pinnedImageTransport,
  },
): Promise<{
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}> {
  let url = validateUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      dependencies.resolve(url.hostname.replace(/^\[|\]$/gu, '')),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(
          () => reject(new RemoteImageError('TIMEOUT')),
          5_000,
        );
      }),
    ]).finally(() => {
      if (dnsTimer) clearTimeout(dnsTimer);
    });
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicImageAddress(address))
    )
      throw new RemoteImageError('BLOCKED_ADDRESS');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    let response: Awaited<ReturnType<ImageTransport>>;
    try {
      response = await dependencies.transport(
        url,
        addresses[0]!,
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) throw new RemoteImageError('TIMEOUT');
      throw cause;
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === 3 || !response.headers.location)
        throw new RemoteImageError('HTTP_ERROR');
      url = validateUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (response.status !== 200) throw new RemoteImageError('HTTP_ERROR');
    if (response.body.length > maxImageBytes || response.body.length === 0)
      throw new RemoteImageError('TOO_LARGE');
    const contentType = response.headers['content-type']
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const bytes = response.body;
    const actual =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
        ? 'image/png'
        : bytes.length >= 3 &&
            bytes[0] === 0xff &&
            bytes[1] === 0xd8 &&
            bytes[2] === 0xff
          ? 'image/jpeg'
          : bytes.length >= 12 &&
              String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
              String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
            ? 'image/webp'
            : null;
    if (!actual || actual !== contentType)
      throw new RemoteImageError('INVALID_IMAGE');
    return { bytes, mimeType: actual };
  }
  throw new RemoteImageError('HTTP_ERROR');
}
