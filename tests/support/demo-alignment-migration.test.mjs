import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  admitDemoMigration,
  assertDemoFault,
  assertDemoCatalogDelta,
  assertDemoImportedSources,
  assertDemoPlan,
  assertDemoLedger,
  assertDemoMirror,
  assertOwnedDemoSchema,
  demoMigrationPlan,
  injectDemoMigrationFailure,
  ownedDemoSchema,
  verifyDemoAlignmentMigration,
  cleanupDemoSchemas,
  endDemoConnection,
} from './demo-alignment-migration.mjs';
// Pure tests may explicitly read the approved integration source. The runtime
// entry deliberately has no environment/path override and uses its own tree.
const directory = resolve(
  process.env.DEV_COR_DEMO_TEST_SOURCE_DIRECTORY ?? 'backend/prisma/migrations',
);

const admitted = () => ({
  NODE_ENV: 'test',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  DATABASE_URL:
    'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test',
  DEV_COR_TEST_DATABASE_URL:
    'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test',
  npm_config_user_agent: 'pnpm/11.27.0 node/v24.21.0',
});

test('actual module import loads only builtins and never reaches pg before admission', async () => {
  const url = pathToFileURL(
    resolve('tests/support/demo-alignment-migration.mjs'),
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import Module from 'node:module';
    const load = Module._load; let pgLoads=0;
    Module._load = function(id,...args) {
      if (id==='pg' || id.startsWith('pg/')) {pgLoads++; throw new Error('pg loaded during import');}
      return load.call(this,id,...args);
    };
    await import(${JSON.stringify(url)});
    process.stdout.write(JSON.stringify({pgLoads}));
  `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { pgLoads: 0 });
  const source = await readFile(
    new URL('./demo-alignment-migration.mjs', import.meta.url),
    'utf8',
  );
  const staticImports = [
    ...source.matchAll(/^import\b[\s\S]*?from\s+['"]([^'"]+)['"]/gmu),
  ].map((match) => match[1]);
  assert.ok(staticImports.length > 0);
  assert.ok(
    staticImports.every((name) => name.startsWith('node:')),
    'No transitive task/pg module during import',
  );
});

function fakeCleanup({
  secondDrop = false,
  badPublic = false,
  commitLost = false,
  rollbackLost = false,
} = {}) {
  const names = [
    'd165_' + 'a'.repeat(32) + '_empty',
    'd165_' + 'a'.repeat(32) + '_upgrade',
  ];
  const schemas = new Set(names);
  const queries = [];
  let transaction;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (sql === 'BEGIN') transaction = new Set(schemas);
      else if (sql === 'ROLLBACK') {
        if (rollbackLost) throw new Error('rollback acknowledgement lost');
        if (transaction) {
          schemas.clear();
          for (const name of transaction) schemas.add(name);
        }
        transaction = undefined;
      } else if (sql === 'COMMIT') {
        transaction = undefined;
        if (commitLost) throw new Error('commit acknowledgement lost');
      } else if (sql.startsWith('DROP SCHEMA')) {
        const name = sql.match(/"([^"]+)"/u)[1];
        if (secondDrop && name === names[1])
          throw new Error('second drop failed');
        schemas.delete(name);
      }
      return { rows: [] };
    },
  };
  const result = {
    cleanedSchemas: 0,
    publicUnchanged: false,
    publicDigests: { before: 'original' },
    cleanup: { state: 'not-started', schemasRetained: true },
  };
  return {
    names,
    schemas,
    queries,
    client,
    result,
    verify: async () => {},
    readPublic: async () => (badPublic ? 'changed' : 'original'),
  };
}

test('rejected pre-cleanup report executes zero DROP and retains both schemas', async () => {
  const f = fakeCleanup();
  await assert.rejects(
    cleanupDemoSchemas(
      f.client,
      f.names,
      f.verify,
      f.readPublic,
      async () => {
        throw new Error('report rejected');
      },
      f.result,
    ),
    /report rejected/u,
  );
  assert.equal(f.queries.filter((sql) => sql.startsWith('DROP')).length, 0);
  assert.deepEqual([...f.schemas], f.names);
  assert.equal(f.result.cleanedSchemas, 0);
});
test('second DROP failure rolls back the first and retains both owned schemas', async () => {
  const f = fakeCleanup({ secondDrop: true });
  await assert.rejects(
    cleanupDemoSchemas(
      f.client,
      f.names,
      f.verify,
      f.readPublic,
      async () => {},
      f.result,
    ),
    /second drop/u,
  );
  assert.deepEqual([...f.schemas], f.names);
  assert.equal(f.queries.at(-1), 'ROLLBACK');
  assert.equal(f.result.cleanedSchemas, 0);
});
test('after-DROP public check and report failures are inside the rollback window', async () => {
  for (const reason of ['public', 'report']) {
    const f = fakeCleanup({ badPublic: reason === 'public' });
    let reports = 0;
    await assert.rejects(
      cleanupDemoSchemas(
        f.client,
        f.names,
        f.verify,
        f.readPublic,
        async () => {
          reports++;
          if (reason === 'report' && reports === 2)
            throw new Error('transaction report rejected');
        },
        f.result,
      ),
    );
    assert.deepEqual([...f.schemas], f.names);
    assert.equal(f.queries.at(-1), 'ROLLBACK');
    assert.equal(f.result.cleanedSchemas, 0);
  }
});
test('cleanup commit acknowledgement loss is uncertain and never claims rollback retained schemas', async () => {
  const f = fakeCleanup({ commitLost: true });
  let reports = 0;
  await assert.rejects(
    cleanupDemoSchemas(
      f.client,
      f.names,
      f.verify,
      f.readPublic,
      async () => {
        reports++;
      },
      f.result,
    ),
    /commit acknowledgement/u,
  );
  assert.equal(f.result.cleanup.state, 'commit-uncertain');
  assert.equal(f.result.cleanup.schemasRetained, null);
  assert.equal(f.result.cleanedSchemas, null);
  assert.equal(f.queries.at(-1), 'COMMIT');
  assert.equal(reports, 2);
});
test('successful cleanup commits both DROPs after all reports and makes no post-commit report', async () => {
  const f = fakeCleanup();
  const reportPositions = [];
  await cleanupDemoSchemas(
    f.client,
    f.names,
    f.verify,
    f.readPublic,
    async () => {
      reportPositions.push(f.queries.length);
    },
    f.result,
  );
  assert.equal(f.result.cleanup.state, 'committed');
  assert.equal(f.result.cleanedSchemas, 2);
  assert.equal(f.schemas.size, 0);
  assert.equal(f.queries.at(-1), 'COMMIT');
  assert.deepEqual(reportPositions, [0, 3]);
});
test('failed rollback has an unknown retention count instead of claiming the two schemas were retained', async () => {
  const f = fakeCleanup({ secondDrop: true, rollbackLost: true });
  await assert.rejects(
    cleanupDemoSchemas(
      f.client,
      f.names,
      f.verify,
      f.readPublic,
      async () => {},
      f.result,
    ),
    AggregateError,
  );
  assert.equal(f.result.cleanup.state, 'rollback-uncertain');
  assert.equal(f.result.cleanup.schemasRetained, null);
  assert.equal(f.result.cleanedSchemas, null);
});
test('connection-end uncertainty preserves an acknowledged commit and retains its original failure separately', async () => {
  const f = fakeCleanup();
  await cleanupDemoSchemas(
    f.client,
    f.names,
    f.verify,
    f.readPublic,
    async () => {},
    f.result,
  );
  const failure = new Error('connection end failed');
  const result = await endDemoConnection(
    {
      end: async () => {
        throw failure;
      },
    },
    f.result,
  );
  assert.equal(result, failure);
  assert.equal(f.result.cleanup.state, 'committed');
  assert.equal(f.result.cleanedSchemas, 2);
  assert.equal(f.result.connectionEnd, 'uncertain');
  const original = new Error('original risk failure');
  const combined = await endDemoConnection(
    {
      end: async () => {
        throw failure;
      },
    },
    f.result,
    original,
  );
  assert.ok(combined instanceof AggregateError);
  assert.deepEqual(combined.errors, [original, failure]);
});

test('pure exact R2 admission rejects wrong binding and non-protected/offline execution before capture', () => {
  assert.equal(admitDemoMigration(admitted()).pnpmVersion, '11.27.0');
  for (const [key, value] of [
    ['NODE_ENV', 'development'],
    ['DEV_COR_TEST_DATABASE_PROJECT', 'other'],
    ['DEV_COR_TEST_DATABASE_CONTAINER_ID', '45addc'],
    ['DATABASE_URL', undefined],
    ['DEV_COR_TEST_DATABASE_URL', undefined],
    ['npm_config_user_agent', 'npm/11'],
    ['npm_config_user_agent', 'pnpm/11.26.0'],
    ['DEV_COR_DEMO_OFFLINE_LIST', '1'],
  ])
    assert.throws(() => admitDemoMigration({ ...admitted(), [key]: value }));
  for (const value of [
    'postgresql://synthetic:placeholder@localhost:15438/dev_cor_test',
    'postgresql://synthetic:placeholder@127.0.0.1:5432/dev_cor_test',
    'postgresql://synthetic:placeholder@127.0.0.1:15438/production',
    `${admitted().DATABASE_URL}?schema=public`,
    `${admitted().DATABASE_URL}#public`,
    'postgresql://127.0.0.1:15438/dev_cor_test',
  ])
    assert.throws(() =>
      admitDemoMigration({
        ...admitted(),
        DATABASE_URL: value,
        DEV_COR_TEST_DATABASE_URL: value,
      }),
    );
  assert.throws(() =>
    admitDemoMigration({
      ...admitted(),
      DEV_COR_TEST_DATABASE_URL:
        'postgresql://other:placeholder@127.0.0.1:15438/dev_cor_test',
    }),
  );
});

test('offline guard rejects the runtime entry without calling report or loading/constructing its driver', async () => {
  const previous = process.env.DEV_COR_DEMO_OFFLINE_LIST;
  process.env.DEV_COR_DEMO_OFFLINE_LIST = '1';
  let callbacks = 0;
  try {
    await assert.rejects(
      verifyDemoAlignmentMigration(() => {
        callbacks += 1;
      }),
      /Offline discovery/u,
    );
  } finally {
    if (previous === undefined) delete process.env.DEV_COR_DEMO_OFFLINE_LIST;
    else process.env.DEV_COR_DEMO_OFFLINE_LIST = previous;
  }
  assert.equal(callbacks, 0);
});

test('approved165 plan reads every original byte with exact suffix pins and no source rewrites', async () => {
  const plan = await demoMigrationPlan(directory);
  assert.equal(plan.length, 165);
  for (const entry of plan)
    assert.equal(
      entry.sql,
      await readFile(resolve(directory, entry.name, 'migration.sql'), 'utf8'),
    );
  assert.ok(plan[162].sql.includes(`ADD VALUE IF NOT EXISTS 'FEE_PROOF'`));
  assert.ok(plan[163].sql.startsWith('BEGIN;'));
  assert.throws(() => assertDemoPlan(plan.slice(1)));
  for (const index of [0, 161, 162, 163, 164]) {
    const changed = [...plan];
    changed[index] = { ...changed[index], sql: changed[index].sql + '\n' };
    assert.throws(() => assertDemoPlan(changed));
  }
  assert.throws(() =>
    assertDemoPlan([...plan.slice(0, 161), ...plan.slice(161).reverse()]),
  );
});

test('four memory-only failures are after full work and preserve originals for a whole-file retry', async () => {
  const plan = await demoMigrationPlan(directory);
  for (const [index, entry] of plan.slice(161).entries()) {
    const original = entry.sql;
    const fault = injectDemoMigrationFailure(entry);
    assert.equal(entry.sql, original);
    assert.equal(fault.marker, `d165_failure_${162 + index}`);
    assert.equal(fault.sql.split(fault.marker).length, 2);
    if (index === 1) {
      assert.equal(fault.sql.slice(0, original.length), original);
      assert.ok(
        fault.sql.indexOf('ALTER TYPE') < fault.sql.indexOf(fault.marker),
      );
      assert.doesNotMatch(original, /\bBEGIN;|\bCOMMIT;/u);
    } else {
      const terminal = original.lastIndexOf('COMMIT;');
      assert.equal(fault.sql.slice(0, terminal), original.slice(0, terminal));
      assert.ok(
        fault.sql.indexOf(fault.marker) < fault.sql.lastIndexOf('COMMIT;'),
      );
      if (index >= 2)
        assert.ok(
          fault.sql.lastIndexOf('INSERT INTO') <
            fault.sql.indexOf(fault.marker),
        );
    }
    assertDemoFault({ code: 'P0001', message: fault.marker }, fault.marker);
    assert.throws(() =>
      assertDemoFault({ code: '23514', message: fault.marker }, fault.marker),
    );
    assert.throws(() =>
      assertDemoFault({ code: 'P0001', message: 'other' }, fault.marker),
    );
    assert.throws(() => assertDemoFault(undefined, fault.marker));
  }
  assert.throws(() => injectDemoMigrationFailure(plan[160]));
  assert.throws(() =>
    injectDemoMigrationFailure({ ...plan[162], sql: plan[162].sql + 'BEGIN;' }),
  );
  assert.throws(() =>
    injectDemoMigrationFailure({
      ...plan[163],
      sql: plan[163].sql.replace(/COMMIT;/u, ''),
    }),
  );
});

test('owned namespace accepts exactly the two created names and original marker', () => {
  const nonce = 'a'.repeat(32);
  const empty = ownedDemoSchema(nonce, 'empty');
  const upgrade = ownedDemoSchema(nonce, 'upgrade');
  const created = new Set([empty, upgrade]);
  for (const name of created)
    assertOwnedDemoSchema(name, nonce, created, `d165-owned:${nonce}`);
  assert.throws(() => ownedDemoSchema(nonce, 'third'));
  assert.throws(() => ownedDemoSchema('../public', 'empty'));
  assert.throws(() =>
    assertOwnedDemoSchema('public', nonce, created, `d165-owned:${nonce}`),
  );
  assert.throws(() =>
    assertOwnedDemoSchema(empty, nonce, new Set(), `d165-owned:${nonce}`),
  );
  assert.throws(() => assertOwnedDemoSchema(empty, nonce, created, 'adopted'));
});

test('public ledger accepts exactly161 source checksums and the one immutable resolved failure', async () => {
  const plan = await demoMigrationPlan(directory);
  const rows = plan.slice(0, 161).map((entry) => ({
    id: entry.name,
    migration_name: entry.name,
    checksum: entry.sha256,
    started_at: 'started',
    finished_at: 'finished',
    rolled_back_at: null,
    applied_steps_count: 1,
    logs: null,
  }));
  const original = {
    id: '9f547970-6eaa-4628-a670-f505590482e9',
    migration_name: '20261016100000_case_execution_filing_followups',
    checksum:
      'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
    started_at: '2026-10-16 09:36:04.56343+00',
    finished_at: null,
    rolled_back_at: '2026-10-17 01:46:38.755138+00',
    applied_steps_count: 0,
    logs: null,
  };
  const ledger = [...rows, original];
  assertDemoLedger(ledger, plan);
  assertDemoLedger([...ledger].reverse(), plan);
  assert.throws(() => assertDemoLedger(rows, plan));
  assert.throws(() =>
    assertDemoLedger([...ledger, { ...original, id: 'new' }], plan),
  );
  for (const patch of [
    { id: 'new' },
    { checksum: '0'.repeat(64) },
    { rolled_back_at: null },
    { finished_at: 'finished' },
    { logs: 'changed' },
    { applied_steps_count: 1 },
  ])
    assert.throws(() =>
      assertDemoLedger([...rows, { ...original, ...patch }], plan),
    );
  assert.throws(() =>
    assertDemoLedger(
      [{ ...rows[0], checksum: '0'.repeat(64) }, ...rows.slice(1), original],
      plan,
    ),
  );
});

test('mirror compares all152 PK/hash/column projections and rejects filtered or altered rows', () => {
  const source = Array.from({ length: 152 }, (_, index) => ({
    name: `table_${index}`,
    columns: ['id', 'value'],
    pk: ['id'],
    count: '1',
    hash: String(index),
  }));
  assertDemoMirror(source, globalThis.structuredClone(source));
  assert.throws(() => assertDemoMirror(source, source.slice(1)));
  assert.throws(() =>
    assertDemoMirror(source, [
      { ...source[0], count: '0' },
      ...source.slice(1),
    ]),
  );
  assert.throws(() =>
    assertDemoMirror(source, [
      { ...source[0], hash: 'changed' },
      ...source.slice(1),
    ]),
  );
  assert.throws(() =>
    assertDemoMirror(source, [
      { ...source[0], columns: ['id'] },
      ...source.slice(1),
    ]),
  );
});

test('DDL budget counts actual catalog deltas including automatic PK indexes', () => {
  const baseline = {
    tables: 152,
    enumTypes: 30,
    functions: 100,
    userTriggers: 100,
    constraints: 1000,
    indexes: 700,
    existingEnumLabels: 100,
  };
  const delta = {
    tables: 12,
    enumTypes: 5,
    functions: 16,
    userTriggers: 23,
    constraints: 73,
    indexes: 43,
    existingEnumLabels: 15,
  };
  const after = Object.fromEntries(
    Object.entries(baseline).map(([key, value]) => [key, value + delta[key]]),
  );
  assert.deepEqual(assertDemoCatalogDelta(baseline, after), delta);
  for (const key of Object.keys(delta))
    assert.throws(() =>
      assertDemoCatalogDelta(baseline, { ...after, [key]: after[key] + 1 }),
    );
});

test('exact N2 requires each real case/certificate/original actor/audit/CV and cannot pass with borrowed files', () => {
  const rows = [
    {
      matter: '498096c8-982d-45d6-99e8-9c8806d2a86c',
      caseId: '9a658c0e-97bf-484f-b3d1-dfcb33722f17',
      certificate: '14e8f547-fe67-49b8-a6c4-263198629214',
      actor: '6d67e817-9f9b-4e13-9e02-ab319e855528',
      binding: 'b1fb2f9a-e976-4b0b-9c2f-ba667ac8c5dc',
      originalAudits: ['a0b38d1f-ce2f-44d0-b302-20f1059cd597'],
      files: [
        {
          materialId: '095dfd70-425b-4dc9-b9ca-30fff80f6257',
          contentVersionId: 'a70ae1cc-8a20-41a6-b538-f54d77f825d3',
          filename: 'original.pdf',
        },
      ],
    },
    {
      matter: 'bc36619d-a8d0-4942-b76b-23f364e3313f',
      caseId: '64f48c1f-d003-4f33-9130-de9bd0879c81',
      certificate: '2c64c319-0c20-4073-a4c4-0c07b2ffe05f',
      actor: '72fb2bf2-c3be-4164-89c4-f1a4bde5f6f8',
      binding: '0214c0df-d982-4441-a389-9491686bc5a6',
      originalAudits: ['a5eb1774-7ad9-4272-a418-6eb1c90a51a7'],
      files: [
        {
          materialId: '14ae2818-2116-4e0e-a501-fdff62c4fba4',
          contentVersionId: '9305bd4f-fe11-47af-bd15-c8c3f4504cc0',
          filename: 'original.pdf',
        },
      ],
    },
  ].map((row) => ({
    ...row,
    department: '10000000-0000-4000-8000-000000000001',
    itemCase: row.caseId,
    paperCase: row.caseId,
    sourceVersion: 6,
    issuanceVersion: 6,
    filename: 'original.pdf',
    size: '46',
    sha256: 'b8274cd2f933ba897ac5a626e96063aa6ed45d4389b105279661a55aedd2bc6f',
  }));
  assertDemoImportedSources(rows);
  for (const patch of [
    { department: 'other' },
    { caseId: 'other' },
    { actor: 'other' },
    { binding: 'other' },
    { originalAudits: [] },
    { sourceVersion: 5 },
    { size: '47' },
    { filename: 'borrowed.pdf' },
    { files: rows[1].files },
  ])
    assert.throws(() =>
      assertDemoImportedSources([{ ...rows[0], ...patch }, rows[1]]),
    );
  assert.throws(() => assertDemoImportedSources([rows[0], rows[0]]));
});
