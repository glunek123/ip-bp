import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
const CURRENT_SCRYPT_VERSION = 'v2';
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

type ScryptPolicy = {
  n: number;
  r: number;
  p: number;
  compatibilityPadding: readonly number[];
};

const SCRYPT_POLICIES: Readonly<Record<string, ScryptPolicy>> = {
  // v1 remains readable so accounts created before the OWASP cost increase can
  // still log in. Every supported version performs one v1 and one v2 derivation,
  // so the hard-coded unknown-user v1 dummy in AuthService has the same work and
  // peak memory cost as verification of a current v2 credential.
  v1: {
    n: 16_384,
    r: SCRYPT_R,
    p: SCRYPT_P,
    compatibilityPadding: [SCRYPT_N],
  },
  // OWASP Password Storage Cheat Sheet minimum for scrypt (128 MiB working set).
  v2: {
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    compatibilityPadding: [16_384],
  },
};

export function normalizeUsername(value: string): string {
  const normalized = value.trim().normalize('NFKC').toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) {
    throw new Error('USERNAME_INVALID');
  }
  return normalized;
}

export function validatePassword(value: string): void {
  const length = Array.from(value).length;
  if (length < 12 || length > 128) {
    throw new Error('PASSWORD_INVALID');
  }
}

async function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_BYTES,
      { N: n, r, p, maxmem: SCRYPT_MAXMEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    'scrypt',
    CURRENT_SCRYPT_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export function prepareLocalCredential(
  username: string,
  password: string,
): { username: string; passwordHash: Promise<string> } {
  return {
    username: normalizeUsername(username),
    passwordHash: hashPassword(password),
  };
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') return false;
  const policy = SCRYPT_POLICIES[parts[1] ?? ''];
  if (policy === undefined) return false;
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (n !== policy.n || r !== policy.r || p !== policy.p) return false;
  try {
    const salt = Buffer.from(parts[5] ?? '', 'base64url');
    const expected = Buffer.from(parts[6] ?? '', 'base64url');
    if (salt.length < SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = await derive(password, salt, n, r, p);
    const matches = timingSafeEqual(actual, expected);
    for (const paddingN of policy.compatibilityPadding) {
      await derive(password, salt, paddingN, r, p);
    }
    return matches;
  } catch {
    return false;
  }
}
