export type BootstrapLocalAccountOptions = {
  departmentName: string;
  username: string;
  displayName: string;
  expectedHost: string;
  expectedPort: string;
  expectedDatabase: string;
};

type BootstrapDatabaseTarget = {
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
  expectedHost: string;
  expectedPort: string;
  expectedDatabase: string;
};

const OPTION_NAMES = {
  '--department': 'departmentName',
  '--username': 'username',
  '--display-name': 'displayName',
  '--expected-db-host': 'expectedHost',
  '--expected-db-port': 'expectedPort',
  '--expected-db-name': 'expectedDatabase',
} as const;

const USAGE =
  'Usage: auth:bootstrap-local --department <name> --username <name> --display-name <name> --expected-db-host <host> --expected-db-port <port> --expected-db-name <database>';

export function parseBootstrapOptions(
  args: string[],
): BootstrapLocalAccountOptions {
  const result: Partial<BootstrapLocalAccountOptions> = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index] as keyof typeof OPTION_NAMES | undefined;
    const value = args[index + 1];
    const property = option === undefined ? undefined : OPTION_NAMES[option];
    if (
      property === undefined ||
      value === undefined ||
      value.length === 0 ||
      result[property] !== undefined
    ) {
      throw new Error(USAGE);
    }
    result[property] = value;
  }
  const missingOption = Object.entries(OPTION_NAMES).find(
    ([, property]) => result[property] === undefined,
  );
  if (missingOption !== undefined) {
    throw new Error(`${USAGE}; missing ${missingOption[0]}`);
  }
  return result as BootstrapLocalAccountOptions;
}

export function assertSafeBootstrapDatabaseTarget(
  target: BootstrapDatabaseTarget,
): void {
  try {
    if (target.nodeEnv !== 'development' && target.nodeEnv !== 'test') {
      throw new Error('Unsafe environment');
    }
    if (target.databaseUrl === undefined) throw new Error('Missing URL');
    const actual = new URL(target.databaseUrl);
    const actualPort = actual.port || '5432';
    const actualDatabase = decodeURIComponent(actual.pathname.slice(1));
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (
      !['postgres:', 'postgresql:'].includes(actual.protocol) ||
      !localHosts.has(actual.hostname) ||
      actual.hostname !== target.expectedHost ||
      actualPort !== target.expectedPort ||
      actualDatabase !== target.expectedDatabase ||
      actualDatabase.length === 0 ||
      !/^\d{1,5}$/.test(target.expectedPort) ||
      Number(target.expectedPort) < 1 ||
      Number(target.expectedPort) > 65_535
    ) {
      throw new Error('Target mismatch');
    }
  } catch {
    throw new Error('BOOTSTRAP_DATABASE_TARGET_REJECTED');
  }
}
