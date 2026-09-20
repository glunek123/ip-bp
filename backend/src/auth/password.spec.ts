import {
  hashPassword,
  normalizeUsername,
  prepareLocalCredential,
  validatePassword,
  verifyPassword,
} from './password';

describe('local password boundary', () => {
  it('normalizes usernames with trim, NFKC and lowercase', () => {
    expect(normalizeUsername('  Ａdmin.User  ')).toBe('admin.user');
  });

  it.each(['ab', 'has space', '中文用户', 'a'.repeat(65)])(
    'rejects invalid username %p',
    (value) =>
      expect(() => normalizeUsername(value)).toThrow('USERNAME_INVALID'),
  );

  it('counts password Unicode code points without trimming', () => {
    expect(() => validatePassword('🔐'.repeat(12))).not.toThrow();
    expect(() => validatePassword('short')).toThrow('PASSWORD_INVALID');
    expect(() => validatePassword('a'.repeat(129))).toThrow('PASSWORD_INVALID');
  });

  it('prepares a normalized username and non-plaintext credential for account creation', async () => {
    const prepared = prepareLocalCredential(
      '  Operator.B  ',
      'temporary-pass-123',
    );

    expect(prepared.username).toBe('operator.b');
    await expect(prepared.passwordHash).resolves.toMatch(
      /^scrypt\$v2\$131072\$8\$1\$/,
    );
    await expect(prepared.passwordHash).resolves.not.toContain(
      'temporary-pass-123',
    );
  });

  it('stores a versioned scrypt hash and verifies in constant-time form', async () => {
    const encoded = await hashPassword(' correct horse battery staple ');
    expect(encoded).toMatch(/^scrypt\$v2\$131072\$8\$1\$/);
    expect(encoded).not.toContain('correct horse');
    await expect(
      verifyPassword(' correct horse battery staple ', encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword('wrong password value', encoded)).resolves.toBe(
      false,
    );
  });

  it('keeps the legacy v1 format verifiable during the v2 transition', async () => {
    const legacyHash =
      'scrypt$v1$16384$8$1$bGVnYWN5LXYxLXNhbHQhIQ$pZvZij3YSVf7LX5VNmX3dOn3DDbUNnc_8tRQaxJ-8iVLMXv4RH7IN2FajhK1bgIUjV-zOu8vUuC8cGrmSxBi7A';

    await expect(
      verifyPassword('legacy passphrase value', legacyHash),
    ).resolves.toBe(true);
    await expect(
      verifyPassword('different passphrase value', legacyHash),
    ).resolves.toBe(false);
  });

  it('rejects malformed or unsupported hashes without throwing', async () => {
    await expect(verifyPassword('any password here', 'broken')).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword('any password here', 'scrypt$v2$1$2$3'),
    ).resolves.toBe(false);
  });
});
