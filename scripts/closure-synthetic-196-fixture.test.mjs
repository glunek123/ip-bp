import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  seedSynthetic196ExternalCase,
  snapshotSynthetic196ExternalCase,
} from './closure-synthetic-196-fixture.mjs';

const schema = `closure_upgrade_${'a'.repeat(32)}`;
const { types } = createRequire(
  new URL('../backend/package.json', import.meta.url),
)('pg');
function fakeClient({
  context = schema,
  failCommit = false,
  failInsert = false,
  schemas = [context],
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT current_schema'))
        return { rows: [{ schema: context, schemas }] };
      if (failInsert && sql.includes('INSERT INTO audit_events'))
        throw new Error('audit failed');
      if (failCommit && sql === 'COMMIT')
        throw new Error('deferred guard failed');
      if (sql.includes('RETURNING recorded_at'))
        return { rows: [{ recorded_at: new Date('2026-10-25T01:00:00Z') }] };
      if (sql.startsWith('SELECT to_jsonb'))
        return { rows: [{ row: { id: values[0] } }] };
      return { rows: [] };
    },
  };
}
test('seed uses one caller client and one transaction for external source, audit and receipt', async () => {
  const client = fakeClient();
  const result = await seedSynthetic196ExternalCase(client, schema);
  assert.equal(client.calls.filter(({ sql }) => sql === 'BEGIN').length, 1);
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  assert.equal(Object.keys(result.snapshot).length, 11);
  assert.equal(Object.keys(result.ids).length, 8);
  for (const id of Object.values(result.ids))
    assert.match(id, /^[a-f0-9-]{36}$/u);
  const entry = client.calls.find(({ sql }) =>
    sql.includes('INSERT INTO case_external_entries'),
  );
  const receipt = client.calls.find(({ sql }) =>
    sql.includes('INSERT INTO case_external_entry_receipts'),
  );
  const audit = client.calls.find(({ sql }) =>
    sql.includes('INSERT INTO audit_events'),
  );
  assert.equal(entry.values[0], result.ids.entryId);
  assert.equal(entry.values.at(-1), result.ids.auditId);
  assert.equal(audit.values[3], result.ids.caseId);
  assert.equal(JSON.parse(receipt.values.at(-1)).entryId, result.ids.entryId);
  assert.equal(JSON.parse(receipt.values.at(-1)).stage, 'PENDING_MATCH');
  assert.equal(JSON.parse(audit.values.at(-1)).entryKind, 'EXTERNAL_TRANSFER');
  assert.ok(
    !client.calls.some(({ sql }) =>
      /SET search_path|CREATE SCHEMA|DROP|DISABLE TRIGGER|case_early_archives|INSERT INTO case_archives/iu.test(
        sql,
      ),
    ),
  );
});
test('rejects public, malformed and mismatched search paths before writes', async () => {
  for (const supplied of [
    'public',
    'closure_upgrade_bad',
    `${schema}; DROP SCHEMA public`,
  ]) {
    const client = fakeClient();
    await assert.rejects(seedSynthetic196ExternalCase(client, supplied));
    assert.equal(client.calls.length, 0);
  }
  const client = fakeClient({ context: 'public' });
  await assert.rejects(
    seedSynthetic196ExternalCase(client, schema),
    /single probe-owned/,
  );
  assert.equal(client.calls.length, 1);
});
for (const options of [{ failInsert: true }, { failCommit: true }]) {
  test(`failure rolls back and returns no successful evidence: ${JSON.stringify(options)}`, async () => {
    const client = fakeClient(options);
    await assert.rejects(seedSynthetic196ExternalCase(client, schema));
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  });
}
test('snapshot can be repeated without writes and detects missing fixture rows', async () => {
  const client = fakeClient();
  const result = await seedSynthetic196ExternalCase(client, schema);
  const next = fakeClient();
  assert.deepEqual(
    await snapshotSynthetic196ExternalCase(next, schema, result.ids),
    result.snapshot,
  );
  assert.ok(next.calls.every(({ sql }) => sql.startsWith('SELECT')));
  const missing = {
    query: async (sql) =>
      sql.startsWith('SELECT current_schema')
        ? { rows: [{ schema, schemas: [schema] }] }
        : { rows: [] },
  };
  await assert.rejects(
    snapshotSynthetic196ExternalCase(missing, schema, result.ids),
    /Incomplete synthetic fixture/,
  );
});
test('standalone fixture imports no database driver, environment or old wrapper', () => {
  const source = readFileSync(
    new URL('./closure-synthetic-196-fixture.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /process\.env|new Client|\.connect\(|withV6FollowupSchema|createRequire|from ['"].*fixture/,
  );
});

test('installed pg parser needs text[] for strict single-schema validation', async () => {
  const wire = `{${schema}}`;
  const names = types.getTypeParser(1003, 'text')(wire);
  const texts = types.getTypeParser(1009, 'text')(wire);
  assert.equal(typeof names, 'string');
  assert.deepEqual(texts, [schema]);
  await assert.rejects(
    seedSynthetic196ExternalCase(fakeClient({ schemas: names }), schema),
    /single probe-owned/,
  );
  const client = fakeClient({ schemas: texts });
  await seedSynthetic196ExternalCase(client, schema);
  assert.equal(
    client.calls[0].sql,
    'SELECT current_schema() AS schema, current_schemas(false)::text[] AS schemas',
  );
  for (const value of [`{${schema},public}`, '{public}', '{}']) {
    const rejected = fakeClient({
      schemas: types.getTypeParser(1009, 'text')(value),
    });
    await assert.rejects(
      seedSynthetic196ExternalCase(rejected, schema),
      /single probe-owned/,
    );
    assert.equal(rejected.calls.length, 1);
  }
});
