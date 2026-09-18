import { createOpaqueToken, digestSource, digestToken } from './auth-token';

describe('authentication token helpers', () => {
  it('creates URL-safe tokens with at least 32 random bytes', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(second).not.toBe(first);
  });

  it('stores deterministic SHA-256 token digests only', () => {
    expect(digestToken('secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(digestToken('secret')).toBe(digestToken('secret'));
    expect(digestToken('secret')).not.toBe(digestToken('different'));
  });

  it('uses a keyed digest for low-entropy request sources', () => {
    const first = digestSource('127.0.0.1', 'a'.repeat(64));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(digestSource('127.0.0.1', 'a'.repeat(64)));
    expect(first).not.toBe(digestSource('127.0.0.1', 'b'.repeat(64)));
  });
});
