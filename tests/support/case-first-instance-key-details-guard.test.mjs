import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readMigration = (name) =>
  readFileSync(
    new URL(
      `../../backend/prisma/migrations/${name}/migration.sql`,
      import.meta.url,
    ),
    'utf8',
  ).replaceAll('\r\n', '\n');
const legacy = readMigration('20261014170100_case_external_entry_foundation');
const forward = readMigration('20261023091000_first_instance_key_details');
const declaration =
  'FUNCTION "ca018_assert_external_trial_round"(target_case uuid,target_department uuid)';
function definition(sql) {
  const at = sql.indexOf(declaration);
  if (at === -1) return null;
  const start = sql.lastIndexOf('CREATE', at);
  const end = sql.indexOf('END; $$;', at);
  assert.ok(start !== -1 && end !== -1);
  return sql.slice(start, end + 'END; $$;'.length);
}
const rawComparison = 'a."court_case_no" IS DISTINCT FROM c."court_case_no"';
const effectiveComparison =
  'case_effective_acceptance_no(a."id") IS DISTINCT FROM c."court_case_no"';

// This small predicate counterexample checks source wiring and an exact recorded
// a2 projection. It does not execute SQL or replace the required real PG replay.
function rejectsCaseNumber(body, { original, effective, current }) {
  const compared = body.includes(rawComparison)
    ? original
    : (assert.ok(
        body.includes(effectiveComparison),
        'Case-number guard must remain present',
      ),
      effective);
  return compared !== current;
}

test('forward external-round guard accepts the recorded a2 effective acceptance number and still rejects a real mismatch', () => {
  const old = definition(legacy);
  assert.ok(old);
  const a2 = {
    original: 'SYNTH-CA-1',
    effective: 'SYNTH-CA-2',
    current: 'SYNTH-CA-2',
  };
  assert.equal(
    rejectsCaseNumber(old, a2),
    true,
    'Recorded old guard counterexample',
  );
  const installed = definition(forward) ?? old;
  assert.equal(
    rejectsCaseNumber(installed, a2),
    false,
    'a2 must compare the effective correction, retaining the original fact',
  );
  assert.equal(rejectsCaseNumber(installed, { ...a2, current: 'WRONG' }), true);
  assert.equal(rejectsCaseNumber(installed, { ...a2, current: null }), true);
  const a3 = { ...a2, effective: 'SYNTH-CA-3', current: 'SYNTH-CA-3' };
  assert.equal(rejectsCaseNumber(old, a3), true);
  assert.equal(rejectsCaseNumber(installed, a3), false);
  assert.equal(
    rejectsCaseNumber(installed, { ...a3, current: 'SYNTH-CA-2' }),
    true,
    'Superseded No2 cannot replace the latest effective No3',
  );
  assert.equal(
    rejectsCaseNumber(installed, { ...a3, current: 'SYNTH-CA-1' }),
    true,
    'Immutable original No1 cannot replace the latest effective No3',
  );
  assert.equal(rejectsCaseNumber(installed, { ...a3, current: 'WRONG' }), true);
  assert.equal(
    rejectsCaseNumber(installed, {
      original: 'SYNTH-CA-1',
      effective: 'SYNTH-CA-1',
      current: 'SYNTH-CA-1',
    }),
    false,
  );
});

test('176 preserves every external root, department, round, shape and pointer guard while replacing only the number operand', () => {
  const old = definition(legacy);
  const actual = definition(forward);
  assert.ok(actual, '176 must provide a complete forward function replacement');
  assert.equal(old.split(rawComparison).length - 1, 1);
  const expected = old
    .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    .replace(rawComparison, effectiveComparison);
  assert.equal(
    actual,
    expected,
    'No guard other than the effective case-number operand may change',
  );
  const existingHelper = readMigration('20261014120100_case_record_edits');
  assert.ok(
    existingHelper.includes(
      'CREATE FUNCTION "case_effective_acceptance_no"(target_acceptance uuid)',
    ),
  );
  assert.ok(existingHelper.includes('ORDER BY c."to_revision" DESC LIMIT 1'));
});
