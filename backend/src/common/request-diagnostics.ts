import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request } from 'express';

const backendRoot = resolve(__dirname, '../..').replace(/\\/g, '/');

export function requestDiagnostics(request: Request) {
  const route: unknown = request.route;
  const path: unknown =
    route && typeof route === 'object' && 'path' in route
      ? route.path
      : undefined;
  return {
    method: request.method,
    route: typeof path === 'string' ? path : 'UNMATCHED',
  };
}

// Only expose a verified project filename and position, never stack prose.
export function errorLocation(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== 'string')
    return undefined;
  for (const line of error.stack.split('\n').slice(1)) {
    const normalized = line.replace(/\\/g, '/');
    const index = normalized.lastIndexOf(`${backendRoot}/`);
    if (index < 0) continue;
    const candidate = normalized.slice(index + backendRoot.length + 1).trim();
    const match =
      /^((src|dist)\/[a-zA-Z0-9_./-]+\.(?:ts|js)):(\d+):(\d+)\)?$/.exec(
        candidate,
      );
    if (
      !match ||
      match[1].split('/').includes('..') ||
      !existsSync(resolve(backendRoot, match[1]))
    )
      continue;
    return `${match[1]}:${match[3]}:${match[4]}`;
  }
  return undefined;
}
