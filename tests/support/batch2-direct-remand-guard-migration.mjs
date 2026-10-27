import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = backend('pg');
const migration = '20261027170000_fix_re_registered_direct_remand_guard';

// Standalone probe only. Do not invoke until the operator separately approves
// 191 for the owned target; the existing 184-190 acceptance flag is insufficient.
export async function verifyBatch2DirectRemandGuardMigration() {
  if (process.env.BATCH2_191_ACCEPTANCE_READY !== 'approved-191-owned-schema')
    throw new Error('191 owned-schema migration probe has not been approved');
  const { databaseUrl } = assertBatch2Admission();
  const schema = `b2dr_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  const client = new Client({ connectionString: databaseUrl });
  const caseId = randomUUID();
  const departmentId = randomUUID();
  const entryId = randomUUID();
  const rootId = randomUUID();
  const priorId = randomUUID();
  const currentId = randomUUID();
  const priorResultId = randomUUID();
  let created = false;
  await client.connect();
  try {
    const namespace = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (namespace.db !== 'dev_cor_test' || namespace.schema !== 'public')
      throw new Error('Unexpected 191 probe namespace');
    await client.query(`CREATE SCHEMA ${quoted}`);
    created = true;
    await client.query(`SET search_path TO ${quoted}`);
    await client.query(`CREATE TABLE case_trial_rounds (
      id uuid PRIMARY KEY,case_id uuid NOT NULL,department_id uuid NOT NULL,
      sequence integer NOT NULL,origin text NOT NULL,external_entry_id uuid,
      source_result_id uuid,revoked_at timestamptz,
      UNIQUE(case_id,department_id,sequence));
      CREATE TABLE case_second_instance_results (
      id uuid PRIMARY KEY,case_id uuid NOT NULL,department_id uuid NOT NULL,
      trial_round_id uuid NOT NULL,external_entry_id uuid,choice_id uuid,
      judgment_id uuid,result text NOT NULL);
      CREATE TABLE case_second_instance_result_revocations (
      id uuid PRIMARY KEY,result_id uuid NOT NULL,case_id uuid NOT NULL,department_id uuid NOT NULL);`);
    await client.query(
      readFileSync(
        resolve('backend/prisma/migrations', migration, 'migration.sql'),
        'utf8',
      ),
    );
    await client.query(
      `INSERT INTO case_trial_rounds(id,case_id,department_id,sequence,origin,external_entry_id)
       VALUES($1,$2,$3,1,'EXTERNAL_CURRENT',$4)`,
      [rootId, caseId, departmentId, entryId],
    );
    await client.query(
      `INSERT INTO case_trial_rounds(id,case_id,department_id,sequence,origin,external_entry_id,source_result_id)
       VALUES($1,$2,$3,2,'NORMAL',$4,$5)`,
      [priorId, caseId, departmentId, entryId, priorResultId],
    );
    await client.query(
      `INSERT INTO case_second_instance_results
       (id,case_id,department_id,trial_round_id,external_entry_id,result)
       VALUES($1,$2,$3,$4,$5,'REMAND')`,
      [priorResultId, caseId, departmentId, rootId, entryId],
    );
    const accepts = async (sequence) =>
      (
        await client.query(
          'SELECT ca018_h_direct_remand_history($1,$2,$3,$4,1,$5) AS accepted',
          [caseId, departmentId, entryId, rootId, sequence],
        )
      ).rows[0].accepted;
    let checked = 0;
    const check = async (name, expected, sequence = 3) => {
      const actual = await accepts(sequence);
      if (actual !== expected)
        throw new Error(`${name}: expected ${expected}, got ${actual}`);
      checked += 1;
    };
    await check('first direct child', true, 2);
    await client.query(
      `INSERT INTO case_trial_rounds(id,case_id,department_id,sequence,origin,external_entry_id)
       VALUES($1,$2,$3,3,'NORMAL',$4)`,
      [currentId, caseId, departmentId, entryId],
    );
    await check('active prior child', false);
    await client.query(
      'UPDATE case_trial_rounds SET revoked_at=now() WHERE id=$1',
      [priorId],
    );
    await check('revoked child without result revocation', false);
    await client.query(
      'INSERT INTO case_second_instance_result_revocations(id,result_id,case_id,department_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), priorResultId, caseId, departmentId],
    );
    await check('legitimately revoked intermediate child', true);
    const mutations = [
      [
        'wrong child entry',
        'case_trial_rounds',
        'external_entry_id',
        priorId,
        randomUUID(),
        entryId,
      ],
      [
        'wrong child source',
        'case_trial_rounds',
        'source_result_id',
        priorId,
        randomUUID(),
        priorResultId,
      ],
      [
        'wrong child origin',
        'case_trial_rounds',
        'origin',
        priorId,
        'EXTERNAL_CURRENT',
        'NORMAL',
      ],
      [
        'active extra child',
        'case_trial_rounds',
        'revoked_at',
        priorId,
        null,
        'RESTORE_TIMESTAMP',
      ],
      [
        'wrong result entry',
        'case_second_instance_results',
        'external_entry_id',
        priorResultId,
        randomUUID(),
        entryId,
      ],
      [
        'wrong result root',
        'case_second_instance_results',
        'trial_round_id',
        priorResultId,
        randomUUID(),
        rootId,
      ],
      [
        'unexpected choice source',
        'case_second_instance_results',
        'choice_id',
        priorResultId,
        randomUUID(),
        null,
      ],
      [
        'invented first judgment source',
        'case_second_instance_results',
        'judgment_id',
        priorResultId,
        randomUUID(),
        null,
      ],
      [
        'wrong result type',
        'case_second_instance_results',
        'result',
        priorResultId,
        'AFFIRM',
        'REMAND',
      ],
      [
        'cross-case revocation',
        'case_second_instance_result_revocations',
        'case_id',
        priorResultId,
        randomUUID(),
        caseId,
      ],
    ];
    for (const [name, table, column, id, bad, original] of mutations) {
      const key =
        table === 'case_second_instance_result_revocations'
          ? 'result_id'
          : 'id';
      const restore =
        original === 'RESTORE_TIMESTAMP'
          ? (
              await client.query(
                'SELECT revoked_at FROM case_trial_rounds WHERE id=$1',
                [priorId],
              )
            ).rows[0].revoked_at
          : original;
      await client.query(`UPDATE ${table} SET ${column}=$1 WHERE ${key}=$2`, [
        bad,
        id,
      ]);
      await check(name, false);
      await client.query(`UPDATE ${table} SET ${column}=$1 WHERE ${key}=$2`, [
        restore,
        id,
      ]);
    }
    await client.query('UPDATE case_trial_rounds SET case_id=$1 WHERE id=$2', [
      randomUUID(),
      priorId,
    ]);
    await check('cross-case intermediate child', false);
    await client.query('UPDATE case_trial_rounds SET case_id=$1 WHERE id=$2', [
      caseId,
      priorId,
    ]);
    await client.query(
      'UPDATE case_trial_rounds SET department_id=$1 WHERE id=$2',
      [randomUUID(), priorId],
    );
    await check('cross-department intermediate child', false);
    await client.query(
      'UPDATE case_trial_rounds SET department_id=$1 WHERE id=$2',
      [departmentId, priorId],
    );
    await client.query('DELETE FROM case_trial_rounds WHERE id=$1', [priorId]);
    await check('missing sequence slot', false);
    await client.query(
      `INSERT INTO case_trial_rounds
       (id,case_id,department_id,sequence,origin,external_entry_id,source_result_id,revoked_at)
       VALUES($1,$2,$3,2,'NORMAL',$4,$5,now())`,
      [priorId, caseId, departmentId, entryId, priorResultId],
    );
    await check('restored valid history', true);
    await client.query(
      `INSERT INTO case_trial_rounds(id,case_id,department_id,sequence,origin,external_entry_id)
       VALUES($1,$2,$3,4,'NORMAL',$4)`,
      [randomUUID(), caseId, departmentId, entryId],
    );
    await check('current child is not latest', false);
    return { migration, checked };
  } finally {
    if (created) {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA ${quoted} CASCADE`);
    }
    await client.end();
  }
}
