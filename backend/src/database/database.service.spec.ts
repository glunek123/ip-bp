import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, defaults, Pool, PoolConfig } from 'pg';
import { DatabaseService } from './database.service';

// Observe the actual adapter constructor while returning the real adapter.
// DatabaseService, PrismaClient, Nest and pg.Client are not replaced.
jest.mock('@prisma/adapter-pg', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/adapter-pg')>(
      '@prisma/adapter-pg',
    );
  return {
    ...actual,
    PrismaPg: jest.fn(
      (...args: ConstructorParameters<typeof actual.PrismaPg>) =>
        new actual.PrismaPg(...args),
    ),
  };
});

describe('DatabaseService acknowledgement budget', () => {
  let moduleRef: TestingModule;
  let service: DatabaseService;
  let connect: jest.SpyInstance;
  let fakeTimers = false;
  const queuedClients: Client[] = [];

  function actualPoolConfig(): PoolConfig {
    const config = jest.mocked(PrismaPg).mock.calls.at(-1)?.[0];
    if (!config || typeof config === 'string' || config instanceof Pool)
      throw new Error('DatabaseService did not configure the actual adapter');
    return config;
  }

  beforeEach(async () => {
    connect = jest.spyOn(Client.prototype, 'connect');
    moduleRef = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            DATABASE_URL:
              'postgresql://synthetic.invalid:5432/ack_budget_offline',
          }),
        },
      ],
    }).compile();
    service = moduleRef.get(DatabaseService);
  });

  afterEach(async () => {
    try {
      if (fakeTimers) await jest.runOnlyPendingTimersAsync();
    } finally {
      jest.useRealTimers();
      fakeTimers = false;
      try {
        for (const client of queuedClients.splice(0)) await client.end();
      } finally {
        try {
          await moduleRef?.close();
          expect(connect).not.toHaveBeenCalled();
        } finally {
          jest.restoreAllMocks();
        }
      }
    }
  });

  it('resolves the real Nest service with Prisma operations without connecting', () => {
    // Prisma's returned client proxy reports Object.prototype. instanceof is
    // therefore not a reliable service identity check; use Nest's actual token.
    expect(moduleRef.get(DatabaseService)).toBe(service);
    expect(typeof service.ping).toBe('function');
    expect(typeof service.$transaction).toBe('function');
    expect(PrismaPg).toHaveBeenCalledTimes(1);
    expect(actualPoolConfig().connectionString).toBe(
      'postgresql://synthetic.invalid:5432/ack_budget_offline',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('keeps server and connection caps without a client acknowledgement timer', () => {
    const config = actualPoolConfig();
    expect(config.statement_timeout).toBe(3000);
    expect(config.connectionTimeoutMillis).toBe(3000);
    expect(config.max).toBe(5);
    if (typeof config.statement_timeout !== 'number')
      throw new Error('Numeric server statement deadline required');
    expect(config.query_timeout).toBe(0);
    expect(defaults.query_timeout).toBe(false);
  });

  it('accepts delayed COMMIT acknowledgements without a pg client timer', async () => {
    const config = actualPoolConfig();
    jest.useFakeTimers();
    fakeTimers = true;
    const client = new Client(config);
    queuedClients.push(client);
    let failure: unknown;
    let command: string | undefined;
    // No connection or fake server: hold the real pg Query callback past the
    // previous client budget, then deliver its protocol acknowledgement locally.
    const completion = client.query('COMMIT').then(
      (result) => {
        command = result.command;
      },
      (error: unknown) => {
        failure = error;
      },
    );
    await jest.advanceTimersByTimeAsync(5250);
    expect(failure).toBeUndefined();
    expect(command).toBeUndefined();
    const queue: unknown = Reflect.get(client, '_queryQueue');
    if (!Array.isArray(queue) || queue.length !== 1)
      throw new Error('Expected one real queued pg query without a connection');
    const query: unknown = queue.shift();
    if (typeof query !== 'object' || query === null)
      throw new Error('Expected the real pg Query object');
    const completed: unknown = Reflect.get(query, 'handleCommandComplete');
    const ready: unknown = Reflect.get(query, 'handleReadyForQuery');
    if (typeof completed !== 'function' || typeof ready !== 'function')
      throw new Error('Installed pg protocol acknowledgement methods changed');
    Reflect.apply(completed, query, [{ text: 'COMMIT' }, {}]);
    Reflect.apply(ready, query, [{}]);
    await completion;
    expect(command).toBe('COMMIT');
    expect(failure).toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
  });

  it('ignores PGQUERY environment timers with the installed pg defaults unchanged', () => {
    const names = ['PGQUERY_TIMEOUT', 'PGQUERYTIMEOUT'] as const;
    const previous = names.map((name) => process.env[name]);
    try {
      for (const name of names) process.env[name] = '1';
      const config = actualPoolConfig();
      expect(config.query_timeout).toBe(0);
      expect(defaults.query_timeout).toBe(false);
      const client = new Client(config);
      queuedClients.push(client);
      const parameters: unknown = Reflect.get(client, 'connectionParameters');
      if (typeof parameters !== 'object' || parameters === null)
        throw new Error('Installed pg connection parameters unavailable');
      expect(Reflect.get(parameters, 'query_timeout')).toBe(false);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      for (const [index, name] of names.entries()) {
        const value = previous[index];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('does not raise the installed Prisma interactive transaction defaults', () => {
    const engine = Reflect.get(service, '_engineConfig') as {
      transactionOptions: { timeout: number; maxWait: number };
    };
    expect(engine.transactionOptions.timeout).toBe(5000);
    expect(engine.transactionOptions.maxWait).toBe(2000);
  });
});
