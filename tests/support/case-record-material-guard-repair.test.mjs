import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordMaterialGuardSources } from './case-record-material-guard-repair.mjs';

test('the five forward function replacements invert exactly to frozen 156 source', async () => {
  const source = await recordMaterialGuardSources();
  assert.equal(source.oldFunctions.length, 5);
  assert.match(source.sourceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    (source.repairSql.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length,
    5,
  );
});
