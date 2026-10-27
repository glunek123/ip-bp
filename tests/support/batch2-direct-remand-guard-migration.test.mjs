import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

const migrationSource = (name) =>
  readFileSync(
    resolve('backend/prisma/migrations', name, 'migration.sql'),
    'utf8',
  );
const original = migrationSource(
  '20261015130000_guard_direct_second_remand_child',
);
const forward = migrationSource(
  '20261027170000_fix_re_registered_direct_remand_guard',
);
const marker = 'CREATE OR REPLACE FUNCTION "ca018_h_direct_second_chain"';
const functionBody = (source) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const end = source.indexOf('END; $$;', start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 'END; $$;'.length);
};

test('191 preserves every published direct-chain head and audit check except the exact child sequence predicate', () => {
  const replacement = `AND r."origin"='NORMAL'
        AND ca018_h_direct_remand_history(target_case,target_department,e."id",
              root_round."id",root_round."sequence",r."sequence")`;
  assert.ok(functionBody(forward).includes(replacement));
  assert.equal(
    functionBody(forward).replace(
      replacement,
      `AND r."origin"='NORMAL' AND r."sequence"=root_round."sequence"+1`,
    ),
    functionBody(original),
  );
});

test('191 helper requires all skipped slots to be revoked same-source remand children and current child to be latest', () => {
  for (const fragment of [
    'child_sequence = (SELECT max(r."sequence")',
    'generate_series(root_sequence+1,child_sequence-1)',
    'prior."case_id"=target_case AND prior."department_id"=target_department',
    'prior."external_entry_id"=entry_id AND prior."revoked_at" IS NOT NULL',
    'prior_result."trial_round_id"=root_id AND prior_result."external_entry_id"=entry_id',
    'prior_result."result"=\'REMAND\'',
    'prior_revocation."result_id"=prior_result."id"',
  ])
    assert.ok(forward.includes(fragment), `missing guard: ${fragment}`);
});

test('191 database probe refuses execution without separate approval', async () => {
  const previous = process.env.BATCH2_191_ACCEPTANCE_READY;
  delete process.env.BATCH2_191_ACCEPTANCE_READY;
  try {
    const { verifyBatch2DirectRemandGuardMigration } =
      await import('./batch2-direct-remand-guard-migration.mjs');
    await assert.rejects(
      verifyBatch2DirectRemandGuardMigration(),
      /has not been approved/,
    );
  } finally {
    if (previous === undefined) delete process.env.BATCH2_191_ACCEPTANCE_READY;
    else process.env.BATCH2_191_ACCEPTANCE_READY = previous;
  }
});
