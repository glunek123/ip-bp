export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  AUTH_THROTTLE_SECRET: string;
  TRUST_PROXY_HOPS: number;
  E2E_IDENTITY_FIXTURES?: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const mode = input.NODE_ENV;
  if (mode !== 'development' && mode !== 'test' && mode !== 'production') {
    throw new Error('NODE_ENV must be development, test or production');
  }
  const rawPort = input.PORT;
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535');
  const databaseUrl = input.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !databaseUrl)
    throw new Error('DATABASE_URL is required');
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    ) {
      throw new Error('Invalid URL');
    }
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const identityFixtures = input.E2E_IDENTITY_FIXTURES;
  const rawTrustProxyHops = input.TRUST_PROXY_HOPS ?? '0';
  if (
    typeof rawTrustProxyHops !== 'string' ||
    !/^\d+$/.test(rawTrustProxyHops) ||
    Number(rawTrustProxyHops) > 10
  ) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  }
  const throttleSecret = input.AUTH_THROTTLE_SECRET;
  if (
    typeof throttleSecret !== 'string' ||
    !/^[a-f0-9]{64,}$/i.test(throttleSecret)
  ) {
    throw new Error(
      'AUTH_THROTTLE_SECRET must be at least 32 random bytes encoded as hexadecimal',
    );
  }
  if (identityFixtures !== undefined && typeof identityFixtures !== 'string') {
    throw new Error('E2E_IDENTITY_FIXTURES must be a JSON string');
  }
  if (identityFixtures !== undefined && mode !== 'test') {
    throw new Error('E2E_IDENTITY_FIXTURES is allowed only in test');
  }
  return {
    NODE_ENV: mode,
    PORT: port,
    DATABASE_URL: databaseUrl,
    AUTH_THROTTLE_SECRET: throttleSecret,
    TRUST_PROXY_HOPS: Number(rawTrustProxyHops),
    ...(identityFixtures === undefined
      ? {}
      : { E2E_IDENTITY_FIXTURES: identityFixtures }),
  };
}
