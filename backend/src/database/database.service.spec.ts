import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool, PoolConfig } from 'pg';
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

  it('keeps server and connection caps while allowing bounded acknowledgement margin', () => {
    const config = actualPoolConfig();
    expect(config.statement_timeout).toBe(3000);
    expect(config.connectionTimeoutMillis).toBe(3000);
    expect(config.max).toBe(5);
    if (typeof config.statement_timeout !== 'number')
      throw new Error('Numeric server statement deadline required');
    expect(config.query_timeout).toBeGreaterThan(config.statement_timeout);
    expect(config.query_timeout).toBeLessThanOrEqual(5000);
  });

  it('the installed pg client still waits at the server deadline and then times out within its client budget', async () => {
    const config = actualPoolConfig();
    const serverBudget = config.statement_timeout;
    const clientBudget = config.query_timeout;
    if (typeof serverBudget !== 'number' || typeof clientBudget !== 'number')
      throw new Error('Numeric bounded deadlines required');
    jest.useFakeTimers();
    fakeTimers = true;
    const client = new Client(config);
    queuedClients.push(client);
    let failure: unknown;
    // Never connect: this exercises pg's real query-timeout queue and callback,
    // without dispatching SQL or opening a network connection.
    const completion = client.query('SELECT 1').catch((error: unknown) => {
      failure = error;
    });
    await jest.advanceTimersByTimeAsync(serverBudget);
    expect(failure).toBeUndefined();
    await jest.advanceTimersByTimeAsync(clientBudget - serverBudget);
    await completion;
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty('message', 'Query read timeout');
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not raise the installed Prisma interactive transaction defaults', () => {
    const engine = Reflect.get(service, '_engineConfig') as {
      transactionOptions: { timeout: number; maxWait: number };
    };
    expect(engine.transactionOptions.timeout).toBe(5000);
    expect(engine.transactionOptions.maxWait).toBe(2000);
  });
});
