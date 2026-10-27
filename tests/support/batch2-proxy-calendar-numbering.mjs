import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = backend('pg');

export function assertPlainNumberingReceiptPath(candidateRoot) {
  const root = resolve(candidateRoot);
  const local = resolve(root, '.local');
  const path = resolve(local, 'batch2-calendar/numbering-receipt.json');
  if (
    relative(root, local) !== '.local' ||
    !path.toLowerCase().startsWith(`${local.toLowerCase()}${sep}`)
  )
    throw new Error('Numbering receipt escaped the candidate .local directory');
  let reachedCandidate = false;
  for (let current = path; ; current = dirname(current)) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat) {
      if (stat.isSymbolicLink())
        throw new Error('Linked numbering receipt path');
      if (realpathSync.native(current).toLowerCase() !== current.toLowerCase())
        throw new Error('Linked numbering receipt path');
    }
    if (current === root) reachedCandidate = true;
    const parent = dirname(current);
    if (parent === current) break;
  }
  if (!reachedCandidate) throw new Error('Candidate root was not reached');
  if (lstatExists(path))
    throw new Error('Batch 2 numbering receipt already exists');
  return path;
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Run once in the new, empty, owned public database after all migrations and
// before any suite seeds a customer. Never call this from a fixture.
export async function initializeBatch2EmptyNumbering() {
  const { databaseUrl } = assertBatch2Admission();
  const path = assertPlainNumberingReceiptPath(process.cwd());
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
  assertPlainNumberingReceiptPath(process.cwd());
  mkdirSync(dirname(path), { recursive: true });
  assertPlainNumberingReceiptPath(process.cwd());
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return receipt;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  console.log(JSON.stringify(await initializeBatch2EmptyNumbering()));
}
