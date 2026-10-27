import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = backend('pg');

// Run once in the new, empty, owned public database after all migrations and
// before any suite seeds a customer. Never call this from a fixture.
export async function initializeBatch2EmptyNumbering() {
  const { databaseUrl } = assertBatch2Admission();
  const path = resolve(
    process.cwd(),
    '.local/batch2-calendar/numbering-receipt.json',
  );
  try {
    const previous = JSON.parse(readFileSync(path, 'utf8'));
    if (previous.containerId !== process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID)
      throw new Error(
        'Existing numbering receipt belongs to a different container',
      );
    throw new Error(
      'Batch 2 numbering was already initialized in this container',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let committed = false;
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected numbering database namespace');
    await client.query('BEGIN');
    const counter = (
      await client.query(
        'SELECT last_value FROM customer_business_number_counters WHERE singleton_id=1 FOR UPDATE',
      )
    ).rows[0];
    const customerCount = Number(
      (await client.query('SELECT count(*)::integer AS n FROM customers'))
        .rows[0].n,
    );
    if (!counter || String(counter.last_value) !== '-1' || customerCount !== 0)
      throw new Error(
        'Batch 2 numbering requires zero customers and the original -1 counter',
      );
    const updated = await client.query(
      'UPDATE customer_business_number_counters SET last_value=0 WHERE singleton_id=1 AND last_value=-1',
    );
    if (updated.rowCount !== 1)
      throw new Error('Batch 2 numbering counter changed concurrently');
    await client.query('COMMIT');
    committed = true;
  } finally {
    if (!committed) await client.query('ROLLBACK');
    await client.end();
  }
  const receipt = {
    project: process.env.DEV_COR_TEST_DATABASE_PROJECT,
    containerId: process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    host: '127.0.0.1',
    port: 15440,
    database: 'dev_cor_test',
    customerCountBefore: 0,
    counterBefore: -1,
    counterAfter: 0,
    initializedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'w' });
  return receipt;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  console.log(JSON.stringify(await initializeBatch2EmptyNumbering()));
}
