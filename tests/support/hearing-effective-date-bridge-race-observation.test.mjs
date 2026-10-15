import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute only the actual observation functions. No application dist, environment
// capture, database, Docker or browser is imported or called.
const source = ts.createSourceFile(
  'hearing-support.mjs',
  readFileSync(
    new URL('./hearing-effective-date-bridge-database.mjs', import.meta.url),
    'utf8',
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const declarations = ['scopedDatabase', 'deferred', 'orderedRace'].map(
  (name) => {
    const node = source.statements.find(
      (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
    );
    assert.ok(node, 'Missing actual function ' + name);
    return node.getText(source);
  },
);
const { scopedDatabase, orderedRace } = new Function(
  'assert',
  declarations.join('\n') + '\nreturn { scopedDatabase, orderedRace };',
)(assert);
const sql = 'SELECT id FROM cases WHERE id = $1 FOR UPDATE';
const options = { isolationLevel: 'Serializable' };
const secret = 'postgresql://synthetic:DO_NOT_EMIT@invalid.example/db';
const errorCases = [
  [
    'raw adapter serialization',
    {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '40001',
            kind: 'TransactionWriteConflict',
          },
        },
      },
    },
    {
      prismaCode: 'P2010',
      sqlState: '40001',
      driverKind: 'TransactionWriteConflict',
    },
  ],
  [
    'nested deadlock',
    {
      code: 'P2034',
      cause: { cause: { sqlState: '40P01', kind: 'TransactionWriteConflict' } },
    },
    {
      prismaCode: 'P2034',
      sqlState: '40P01',
      driverKind: 'TransactionWriteConflict',
    },
  ],
  [
    'raw SQLSTATE metadata',
    { code: 'P2010', meta: { code: '23505' } },
    { prismaCode: 'P2010', sqlState: '23505', driverKind: 'UNKNOWN' },
  ],
  [
    'Prisma code is not SQLSTATE',
    { code: 'P2010' },
    { prismaCode: 'P2010', sqlState: 'UNKNOWN', driverKind: 'UNKNOWN' },
  ],
  [
    'untrusted metadata',
    {
      code: secret,
      meta: {
        sqlState: '40001\n' + secret,
        driverAdapterError: { cause: { originalCode: secret, kind: secret } },
      },
    },
    { prismaCode: 'UNKNOWN', sqlState: 'UNKNOWN', driverKind: 'UNKNOWN' },
  ],
  [
    'non-string metadata',
    { code: 40001, cause: { kind: { unsafe: secret }, sqlState: 40001 } },
    { prismaCode: 'UNKNOWN', sqlState: 'UNKNOWN', driverKind: 'UNKNOWN' },
  ],
];
function lazyQuery(execute, onStart) {
  return {
    then(fulfilled, rejected) {
      onStart();
      return Promise.resolve().then(execute).then(fulfilled, rejected);
    },
  };
}

for (const [label, fields, expected] of errorCases) {
  test(
    'FOR UPDATE observes filtered ' + label + ' and rethrows identical error',
    async () => {
      const original = Object.assign(new Error(secret), fields);
      const events = [];
      let starts = 0;
      let forwardedOptions;
      const database = {
        $transaction(callback, transactionOptions) {
          forwardedOptions = transactionOptions;
          return callback({
            $queryRawUnsafe() {
              return lazyQuery(
                () => {
                  throw original;
                },
                () => {
                  starts++;
                },
              );
            },
          });
        },
      };
      const scoped = scopedDatabase(
        database,
        'synthetic-case',
        async (event, summary) => {
          assert.equal(starts, 1, 'Lazy query must start before observation');
          events.push({ event, summary });
        },
      );
      await assert.rejects(
        scoped.$transaction((tx) => tx.$queryRawUnsafe(sql, secret), options),
        (error) => error === original,
      );
      assert.equal(forwardedOptions, options);
      assert.deepEqual(events, [
        { event: 'attempt', summary: undefined },
        { event: 'rejected', summary: expected },
      ]);
      assert.doesNotMatch(
        JSON.stringify(events),
        /DO_NOT_EMIT|SELECT|invalid\.example/u,
      );
    },
  );
}

test('non-lock query rejects unchanged without lock observations', async () => {
  const original = new Error(secret);
  const events = [];
  const database = {
    $transaction(callback) {
      return callback({
        $queryRawUnsafe() {
          return lazyQuery(
            () => {
              throw original;
            },
            () => {},
          );
        },
      });
    },
  };
  const scoped = scopedDatabase(database, 'synthetic-case', async (event) => {
    events.push(event);
  });
  await assert.rejects(
    scoped.$transaction((tx) => tx.$queryRawUnsafe('SELECT 1')),
    (error) => error === original,
  );
  assert.deepEqual(events, []);
});

function racingDatabase(secondError) {
  let transactions = 0;
  let releaseFirst;
  const firstFinished = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const database = {
    async $transaction(callback, transactionOptions) {
      assert.equal(transactionOptions, options);
      const index = transactions++;
      try {
        return await callback({
          $queryRawUnsafe() {
            return lazyQuery(
              async () => {
                if (index > 0) {
                  await firstFinished;
                  if (secondError) throw secondError;
                }
                return [{ id: 'synthetic-case' }];
              },
              () => {},
            );
          },
        });
      } finally {
        if (index === 0) releaseFirst();
      }
    },
  };
  return database;
}
const command = (database) =>
  database.$transaction(
    (tx) => tx.$queryRawUnsafe(sql, 'synthetic-case'),
    options,
  );

test('successful competition keeps the original four ordered lock assertions', async () => {
  const { outcomes, lockEvents } = await orderedRace(
    racingDatabase(),
    'synthetic-case',
    command,
    command,
  );
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['fulfilled', 'fulfilled'],
  );
  assert.deepEqual(lockEvents, [
    'first:attempt',
    'first:acquired',
    'second:attempt',
    'first:barrier-released',
    'second:acquired',
  ]);
});

test('caught scan failure still fails missing acquired assertion with sanitized raw metadata', async () => {
  const original = Object.assign(new Error(secret), errorCases[0][1]);
  const scanLike = async (database) => {
    try {
      await command(database);
      return { advanced: 0, failed: 0 };
    } catch (error) {
      assert.equal(error, original);
      return { advanced: 0, failed: 1 };
    }
  };
  await assert.rejects(
    orderedRace(racingDatabase(original), 'synthetic-case', command, scanLike),
    (error) => {
      assert.match(
        error.message,
        /Missing or out-of-order case lock event: second:acquired/u,
      );
      assert.match(error.message, /second:rejected/u);
      assert.match(error.message, /"prismaCode":"P2010"/u);
      assert.match(error.message, /"sqlState":"40001"/u);
      assert.match(error.message, /"driverKind":"TransactionWriteConflict"/u);
      assert.doesNotMatch(
        error.message,
        /DO_NOT_EMIT|SELECT|invalid\.example/u,
      );
      return true;
    },
  );
});
