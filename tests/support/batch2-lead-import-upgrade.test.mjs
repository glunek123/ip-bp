import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { injectOwnedMigrationFault } from './batch2-lead-import-upgrade.mjs';

const fault =
  "\nDO $$ BEGIN RAISE EXCEPTION 'owned migration fault' USING ERRCODE = '23514'; END $$;\nCOMMIT;";

for (const name of [
  '20261027150000_batch2_lead_import_images',
  '20261027160000_batch2_import_responsible_operator',
]) {
  test(`${name} fault injection keeps PostgreSQL dollar quotes and replaces only the final COMMIT`, () => {
    const source = readFileSync(
      resolve('backend/prisma/migrations', name, 'migration.sql'),
      'utf8',
    );
    const footer = /\nCOMMIT;\s*$/u;
    assert.match(source, footer);
    const injected = injectOwnedMigrationFault(source);
    assert.equal(injected, source.replace(footer, '') + fault);
    assert.equal((injected.match(/\nCOMMIT;/gu) ?? []).length, 1);
    assert.ok(injected.includes('DO $$ BEGIN RAISE EXCEPTION'));
    assert.ok(injected.includes('END $$;\nCOMMIT;'));
  });
}
