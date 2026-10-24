import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const migration = (name) =>
  readFileSync(
    resolve('backend/prisma/migrations', name, 'migration.sql'),
    'utf8',
  ).replaceAll('\r\n', '\n');
const predecessor = migration(
  '20261015123000_disambiguate_execution_reference_locals',
);
const forward = migration(
  '20261025090000_case_second_instance_normal_source_guard',
);

test('177 fingerprints the complete external-only source clause and changes only its source gate', () => {
  const expectedClause = forward.match(
    /needle := \$guard\$\n([\s\S]*?)\$guard\$;/u,
  )?.[1];
  assert.ok(expectedClause, '177 must pin the existing source clause');
  const start = predecessor.indexOf(
    'CREATE OR REPLACE FUNCTION "check_case_second_instance_final"()',
  );
  const end = predecessor.indexOf('CREATE OR REPLACE FUNCTION ', start + 1);
  const oldFunction = predecessor.slice(start, end < 0 ? undefined : end);
  assert.ok(start >= 0, '151230 must define the predecessor function');
  assert.equal(oldFunction.split(expectedClause).length, 2);
  const laterNames = readdirSync(resolve('backend/prisma/migrations'))
    .filter(
      (name) =>
        name > '20261015123000_disambiguate_execution_reference_locals' &&
        name < '20261025090000_case_second_instance_normal_source_guard',
    )
    .sort();
  for (const name of laterNames) {
    assert.doesNotMatch(
      migration(name),
      /check_case_second_instance_final/u,
      `${name} unexpectedly changes the predecessor function`,
    );
  }
  assert.match(
    expectedClause,
    /actual\."external_entry_id"=e\."id" AND judgment\."external_entry_id"=e\."id"/u,
  );
  assert.match(expectedClause, /actual\."next"='APPEAL'/u);
  assert.match(expectedClause, /case_judgment_next_step_revocations/u);

  const newPrefix = 'IF EXISTS (SELECT 1 FROM "case_external_entries" entry';
  assert.equal(forward.split(newPrefix).length, 2);
  assert.match(
    forward,
    /entry\."case_id"=target_case AND entry\."department_id"=target_department/u,
  );
  assert.match(
    forward,
    /\|\| 'AND NOT EXISTS \(SELECT 1 FROM "case_judgment_next_steps" actual'\)/u,
  );
  assert.match(forward, /EXECUTE replace\(definition,needle,replacement\)/u);
  assert.doesNotMatch(
    forward,
    /\bDROP\b|\bALTER TABLE\b|\bUPDATE\b|\bDELETE\b|session_replication_role/iu,
  );
});
