import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { captureTestEnvironment } from '../../../../scripts/test-environment.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20260929010000_add_notary_return_archive';
const whitespaceFix = '20260929011000_harden_notary_return_whitespace';
const snapshotFix = '20260929012000_add_notary_return_actor_snapshot';
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const targetIndex = migrations.indexOf(target);
assert.notEqual(targetIndex, -1);
assert.deepEqual(migrations.slice(targetIndex, targetIndex + 3), [
  target,
  whitespaceFix,
  snapshotFix,
]);

async function expectRejected(client, sql, params, code, constraint) {
  const savepoint = `negative_${randomBytes(4).toString('hex')}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(
      client.query(sql, params),
      (error) =>
        error.code === code && (!constraint || error.constraint === constraint),
    );
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
}

async function seedMatter(client, label, { evidence = true } = {}) {
  const ids = Object.fromEntries(
    [
      'department',
      'user',
      'customer',
      'rights',
      'lead',
      'office',
      'matter',
      'review',
      'decision',
    ].map((name) => [name, randomUUID()]),
  );
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
    [ids.department, label],
  );
  await client.query(
    'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
    [ids.user, `${label}:${ids.user}`, 'Probe actor'],
  );
  await client.query(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [randomUUID(), ids.user, ids.department],
  );
  await client.query(
    'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
    [ids.customer, label, label.toLowerCase(), ids.department, ids.user],
  );
  await client.query(
    'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [ids.rights, label, ids.department],
  );
  await client.query(
    `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,status,case_type,source,platform,found_at,shop_name,need_disclose,version,pushed_at,pushed_by_user_id,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'TRANSFERRED_TO_NOTARY','CIVIL','ONLINE','TAOBAO',now(),'Probe Shop',false,3,now(),$6,now())`,
    [
      ids.lead,
      ids.department,
      `${label}-${ids.lead}`,
      ids.customer,
      ids.rights,
      ids.user,
    ],
  );
  await client.query(
    'INSERT INTO notary_offices(id,department_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)',
    [ids.office, ids.department, label, ids.user],
  );
  await client.query(
    `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,stage,version,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'WAITING_RETURN',5,'ONLINE_PURCHASE','Probe','{}',$7,3,4)`,
    [
      ids.matter,
      `${label}-matter-${ids.matter}`,
      ids.department,
      ids.lead,
      ids.customer,
      ids.rights,
      ids.user,
      ids.office,
    ],
  );
  if (evidence)
    await client.query(
      `INSERT INTO notary_matter_evidence(matter_id,department_id,evidence_at,sample_fee_state,sample_fee_amount,recorded_by_user_id)
      VALUES ($1,$2,CURRENT_DATE,'KNOWN',100.00,$3)`,
      [ids.matter, ids.department, ids.user],
    );
  await client.query(
    'INSERT INTO notary_matter_opening(matter_id,department_id,recorded_by_user_id,internal_actor_user_id) VALUES ($1,$2,$3,$3)',
    [ids.matter, ids.department, ids.user],
  );
  await client.query(
    `INSERT INTO notary_opening_review_decisions(id,matter_id,department_id,customer_id,actor_user_id,actor_kind,internal_actor_user_id,actor_display_name_snapshot,result,from_version,to_version)
    VALUES ($1,$2,$3,$4,$5,'INTERNAL',$5,'Probe actor','INFRINGEMENT',3,4)`,
    [ids.review, ids.matter, ids.department, ids.customer, ids.user],
  );
  await client.query(
    `INSERT INTO notary_issuance_decisions(id,matter_id,department_id,opening_review_decision_id,actor_user_id,actor_display_name_snapshot,decision,from_version,to_version)
    VALUES ($1,$2,$3,$4,$5,'Probe actor','NO_ISSUE',4,5)`,
    [ids.decision, ids.matter, ids.department, ids.review, ids.user],
  );
  return ids;
}

const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
await client.connect();
try {
  assert.equal(
    (await client.query('SELECT current_database() AS name')).rows[0].name,
    'dev_cor_test',
  );
  for (const mode of ['empty', 'upgrade', 'guard']) {
    const schema = `nt006_${mode}_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    try {
      await client.query(`SET search_path TO "${schema}"`);
      for (const name of migrations.filter((name) => name < target))
        await client.query(
          readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
        );
      const legacy =
        mode !== 'empty'
          ? await seedMatter(client, `NT006 legacy ${schema}`)
          : null;
      const migration = readFileSync(
        resolve(migrationRoot, target, 'migration.sql'),
        'utf8',
      );
      if (mode === 'upgrade') {
        await client.query(
          'CREATE TABLE notary_return_archives(probe integer)',
        );
        await assert.rejects(
          client.query(migration),
          (error) => error.code === '42P07',
        );
        await client.query('ROLLBACK');
        const afterFailure = await client.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name='notary_return_amounts'`,
          [schema],
        );
        assert.equal(afterFailure.rowCount, 0);
        const probeTable = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='notary_return_archives'`,
          [schema],
        );
        assert.deepEqual(
          probeTable.rows.map((row) => row.column_name),
          ['probe'],
        );
        const rolledBackTypes = await client.query(
          `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname IN ('notary_return_choice','notary_return_amount_kind','notary_return_party_kind')`,
          [schema],
        );
        assert.equal(rolledBackTypes.rowCount, 0);
        const rolledBackAction = await client.query(
          `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='notary.return.archive'`,
          [schema],
        );
        assert.equal(rolledBackAction.rowCount, 0);
        const rolledBackFunction = await client.query(
          `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='reject_notary_return_mutation'`,
          [schema],
        );
        assert.equal(rolledBackFunction.rowCount, 0);
        await client.query('DROP TABLE notary_return_archives');
      }
      await client.query(migration);
      await client.query(
        readFileSync(
          resolve(migrationRoot, whitespaceFix, 'migration.sql'),
          'utf8',
        ),
      );
      const snapshotMigration = readFileSync(
        resolve(migrationRoot, snapshotFix, 'migration.sql'),
        'utf8',
      );
      if (mode === 'guard') {
        await client.query(
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,issuance_decision_choice,actor_user_id,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,'NO_ISSUE',$5,'KEEP','Legacy reason',5,6)`,
          [
            randomUUID(),
            legacy.matter,
            legacy.department,
            legacy.decision,
            legacy.user,
          ],
        );
        await assert.rejects(
          client.query(snapshotMigration),
          (error) => error.code === '55000',
        );
        await client.query('ROLLBACK');
        const historical = await client.query(
          'SELECT archive_reason FROM notary_return_archives WHERE matter_id=$1',
          [legacy.matter],
        );
        assert.equal(historical.rows[0].archive_reason, 'Legacy reason');
        const absentSnapshot = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='notary_return_archives' AND column_name='actor_display_name_snapshot'`,
          [schema],
        );
        assert.equal(absentSnapshot.rowCount, 0);
        console.log('NT006 historical archive guard probe passed');
        continue;
      }
      await client.query(snapshotMigration);
      const snapshotColumn = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='notary_return_archives' AND column_name='actor_display_name_snapshot'`,
        [schema],
      );
      assert.equal(snapshotColumn.rowCount, 1);
      const enumValue = await client.query(
        `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='permission_action' AND e.enumlabel='notary.return.archive'`,
        [schema],
      );
      assert.equal(enumValue.rowCount, 1);
      const ids = legacy ?? (await seedMatter(client, `NT006 empty ${schema}`));
      const archive = randomUUID();
      await client.query(
        `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,issuance_decision_choice,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
        VALUES ($1,$2,$3,$4,'NO_ISSUE',$5,'Probe actor','RETURN','Returned after review',5,6)`,
        [archive, ids.matter, ids.department, ids.decision, ids.user],
      );
      const snapshot = await client.query(
        'SELECT actor_display_name_snapshot FROM notary_return_archives WHERE id=$1',
        [archive],
      );
      assert.equal(snapshot.rows[0].actor_display_name_snapshot, 'Probe actor');
      const insertAmount = `INSERT INTO notary_return_amounts(id,archive_id,matter_id,department_id,return_choice,kind,state,amount,party_kind,party_name,source_evidence_matter_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
      const base = [archive, ids.matter, ids.department, 'RETURN'];
      await client.query(insertAmount, [
        randomUUID(),
        ...base,
        'REFUND',
        'KNOWN',
        '25.00',
        'CUSTOMER',
        null,
        ids.matter,
      ]);
      await client.query(insertAmount, [
        randomUUID(),
        ...base,
        'FREIGHT',
        'PENDING',
        null,
        null,
        null,
        null,
      ]);
      const noEvidence = await seedMatter(
        client,
        `NT006 no evidence ${schema}`,
        { evidence: false },
      );
      const noEvidenceArchive = randomUUID();
      await client.query(
        `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,issuance_decision_choice,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
        VALUES ($1,$2,$3,$4,'NO_ISSUE',$5,'Probe actor','RETURN','No original expense',5,6)`,
        [
          noEvidenceArchive,
          noEvidence.matter,
          noEvidence.department,
          noEvidence.decision,
          noEvidence.user,
        ],
      );
      const noEvidenceBase = [
        noEvidenceArchive,
        noEvidence.matter,
        noEvidence.department,
        'RETURN',
      ];
      await client.query(insertAmount, [
        randomUUID(),
        ...noEvidenceBase,
        'FREIGHT',
        'KNOWN',
        '0.00',
        null,
        null,
        null,
      ]);
      const refundOnly = await seedMatter(
        client,
        `NT006 refund only ${schema}`,
      );
      const refundOnlyArchive = randomUUID();
      await client.query(
        `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,issuance_decision_choice,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
        VALUES ($1,$2,$3,$4,'NO_ISSUE',$5,'Probe actor','REFUND_ONLY','Refund without return',5,6)`,
        [
          refundOnlyArchive,
          refundOnly.matter,
          refundOnly.department,
          refundOnly.decision,
          refundOnly.user,
        ],
      );
      const refundOnlyBase = [
        refundOnlyArchive,
        refundOnly.matter,
        refundOnly.department,
        'REFUND_ONLY',
      ];
      await client.query(insertAmount, [
        randomUUID(),
        ...refundOnlyBase,
        'REFUND',
        'PENDING',
        null,
        null,
        null,
        refundOnly.matter,
      ]);
      await client.query('BEGIN');
      try {
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'FREIGHT',
            'KNOWN',
            '-1.00',
            null,
            null,
            null,
          ],
          '23514',
          'notary_return_amounts_state_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'FREIGHT',
            'PENDING',
            '0.00',
            null,
            null,
            null,
          ],
          '23514',
          'notary_return_amounts_state_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [randomUUID(), ...base, 'FREIGHT', 'KNOWN', null, null, null, null],
          '23514',
          'notary_return_amounts_state_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'REFUND',
            'KNOWN',
            '5.00',
            'CUSTOMER',
            null,
            randomUUID(),
          ],
          '23514',
          'notary_return_amounts_source_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'REFUND',
            'KNOWN',
            '5.00',
            'CUSTOMER',
            null,
            null,
          ],
          '23514',
          'notary_return_amounts_source_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [randomUUID(), ...base, 'FREIGHT', 'KNOWN', '5.00', null, null, null],
          '23514',
          'notary_return_amounts_party_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'FREIGHT',
            'KNOWN',
            '5.00',
            'OTHER',
            ' ',
            null,
          ],
          '23514',
          'notary_return_amounts_party_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...noEvidenceBase,
            'REFUND',
            'PENDING',
            null,
            null,
            null,
            noEvidence.matter,
          ],
          '23503',
          'notary_return_amounts_source_fkey',
        );
        await expectRejected(
          client,
          insertAmount,
          [randomUUID(), ...base, 'FREIGHT', 'PENDING', null, null, null, null],
          '23505',
          'notary_return_amounts_archive_kind_key',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'FREIGHT',
            'KNOWN',
            '5.00',
            'OTHER',
            '\tVendor',
            null,
          ],
          '23514',
          'notary_return_amounts_party_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...base,
            'FREIGHT',
            'KNOWN',
            '5.00',
            'OTHER',
            '\t\n',
            null,
          ],
          '23514',
          'notary_return_amounts_party_check',
        );
        await expectRejected(
          client,
          insertAmount,
          [
            randomUUID(),
            ...refundOnlyBase,
            'FREIGHT',
            'PENDING',
            null,
            null,
            null,
            null,
          ],
          '23514',
          'notary_return_amounts_branch_check',
        );
        await expectRejected(
          client,
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,$5,'Probe actor','RETURN',' Another archive ',5,6)`,
          [randomUUID(), ids.matter, ids.department, ids.decision, ids.user],
          '23514',
          'notary_return_archives_reason_check',
        );
        await expectRejected(
          client,
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,actor_user_id,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,$5,'RETURN','Valid reason',5,6)`,
          [randomUUID(), ids.matter, ids.department, ids.decision, ids.user],
          '23502',
        );
        await expectRejected(
          client,
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,$5,$6,'RETURN','Valid reason',5,6)`,
          [
            randomUUID(),
            ids.matter,
            ids.department,
            ids.decision,
            ids.user,
            '\t\n',
          ],
          '23514',
          'notary_return_archives_actor_name_check',
        );
        await expectRejected(
          client,
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,$5,$6,'RETURN','Valid reason',5,6)`,
          [
            randomUUID(),
            ids.matter,
            ids.department,
            ids.decision,
            ids.user,
            ' Probe actor',
          ],
          '23514',
          'notary_return_archives_actor_name_check',
        );
        await expectRejected(
          client,
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,$5,'Probe actor','RETURN',$6,5,6)`,
          [
            randomUUID(),
            ids.matter,
            ids.department,
            ids.decision,
            ids.user,
            '\t\n',
          ],
          '23514',
          'notary_return_archives_reason_check',
        );
        await expectRejected(
          client,
          `INSERT INTO notary_return_archives(id,matter_id,department_id,issuance_decision_id,actor_user_id,actor_display_name_snapshot,return_choice,archive_reason,from_version,to_version)
          VALUES ($1,$2,$3,$4,$5,'Probe actor','RETURN',$6,5,6)`,
          [
            randomUUID(),
            ids.matter,
            ids.department,
            ids.decision,
            ids.user,
            'Reason\n',
          ],
          '23514',
          'notary_return_archives_reason_check',
        );
        await expectRejected(
          client,
          'UPDATE notary_return_archives SET archive_reason=$1 WHERE id=$2',
          ['changed', archive],
          '55000',
        );
        await expectRejected(
          client,
          'DELETE FROM notary_return_amounts WHERE archive_id=$1',
          [archive],
          '55000',
        );
      } finally {
        await client.query('ROLLBACK');
      }
      if (legacy) {
        const original = await client.query(
          'SELECT sample_fee_amount FROM notary_matter_evidence WHERE matter_id=$1',
          [ids.matter],
        );
        assert.equal(original.rows[0].sample_fee_amount, '100.00');
      }
      console.log(`NT006 ${mode} migration probe passed`);
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
} finally {
  await client.end();
}
