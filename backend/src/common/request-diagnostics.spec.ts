import { resolve } from 'node:path';
import { errorLocation } from './request-diagnostics';

describe('safe error location', () => {
  it('extracts only the filename and position from a multiline exception', () => {
    const error = new Error('secret\npostgresql://secret:password');
    expect(errorLocation(error)).toMatch(
      /^src\/common\/request-diagnostics.spec.ts:\d+:\d+$/,
    );
  });
  it.each([
    'outside/file.ts',
    'src/../common/file.ts',
    'src/common/missing-file.ts',
  ])('rejects unverified path %s', (path) => {
    const error = new Error('secret');
    const root = resolve(__dirname, '../..').replace(/\\/g, '/');
    error.stack = `Error: secret\n    at handler (${root}/${path}:1:2)`;
    expect(errorLocation(error)).toBeUndefined();
  });
  it('omits locations for unknown errors and external stacks', () => {
    expect(errorLocation('secret')).toBeUndefined();
    const error = new Error('secret');
    error.stack = 'Error: secret\n at handler (C:/private/secret.ts:1:2)';
    expect(errorLocation(error)).toBeUndefined();
  });
});
