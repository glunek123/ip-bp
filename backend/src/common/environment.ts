export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
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
  return { NODE_ENV: mode, PORT: port, DATABASE_URL: databaseUrl };
}
