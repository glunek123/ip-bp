import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = process.cwd();
const approved = Object.freeze({
  project: 'dev-cor-ui003-r2',
  container: '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  actorId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
  roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
  departmentId: '10000000-0000-4000-8000-000000000001',
  privatePath:
    'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-h-actor-recovery-83ac59ee-1b96-4fde-b1b8-534061a36ed0\\actor.private.json',
  privateSha256:
    'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
});
const sha = (value) => createHash('sha256').update(value).digest('hex');
const approvedReuseMigrationSha256 =
  '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const owned = new Map();
let candidate;

export function assertReferenceReuseTransactionBoundary(sql) {
  const body = sql.replace(/^(?:--[^\n]*\n){3}/u, '');
  assert.ok(
    body.startsWith('BEGIN;\n\n'),
    'Migration must begin one transaction before DDL',
  );
  assert.ok(
    body.endsWith('\nCOMMIT;\n'),
    'Migration must commit only after all DDL',
  );
  assert.equal((sql.match(/^BEGIN;$/gmu) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) ?? []).length, 1);
}

export function assertApprovedReferenceReuseMigration(
  sourceBytes,
  appliedChecksum,
) {
  const actual = sha(sourceBytes);
  assert.equal(
    actual,
    approvedReuseMigrationSha256,
    'Unapproved 0930 raw migration bytes',
  );
  assertReferenceReuseTransactionBoundary(sourceBytes.toString('utf8'));
  if (appliedChecksum !== undefined)
    assert.equal(
      appliedChecksum,
      approvedReuseMigrationSha256,
      'Unapproved 0930 ledger checksum',
    );
  return actual;
}

export function injectReferenceReuseRollbackProbe(sourceSql) {
  const needle =
    'CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"';
  assert.equal(sourceSql.split(needle).length, 2);
  return sourceSql.replace(
    needle,
    () =>
      `DO $$ BEGIN RAISE EXCEPTION 'deliberate migration rollback proof'; END $$;\n${needle}`,
  );
}

// This pure gate runs before capture, pg import, Docker, or any service request.
export function assertReferenceReuseBinding(environment = process.env) {
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.DEV_COR_TEST_DATABASE_PROJECT, approved.project);
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    approved.container,
  );
  assert.ok(environment.DATABASE_URL && environment.DEV_COR_TEST_DATABASE_URL);
  assert.equal(environment.DATABASE_URL, environment.DEV_COR_TEST_DATABASE_URL);
  assert.ok(
    !environment.DATABASE_URL.includes('?') &&
      !environment.DATABASE_URL.includes('#'),
  );
  const parsed = new URL(environment.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '15438');
  assert.equal(parsed.pathname, '/dev_cor_test');
  assert.equal(parsed.username, 'dev_cor_test');
  assert.ok(parsed.password && !parsed.search && !parsed.hash);
  assert.match(
    environment.npm_config_user_agent ?? '',
    /\bpnpm\/11\.27\.0(?:\s|$)/u,
  );
  return environment.DATABASE_URL;
}

function assertCleanReferenceReuseCheckout() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  assert.equal(
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    '',
  );
  assert.match(head, /^[a-f0-9]{40}$/u);
  assert.match(tree, /^[a-f0-9]{40}$/u);
  return { head, tree };
}

export async function verifyReferenceReusePredeploy() {
  const url = assertReferenceReuseBinding();
  const { head, tree } = assertCleanReferenceReuseCheckout();
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 159);
  assert.equal(
    names.at(-1),
    '20261016093000_case_record_material_reference_reuse',
  );
  const sourceBytes = await readFile(
    resolve(migrationRoot, names.at(-1), 'migration.sql'),
  );
  const migrationSha256 = assertApprovedReferenceReuseMigration(sourceBytes);
  const ledger = await Promise.all(
    names.slice(0, -1).map(async (name) => ({
      name,
      checksum: sha(
        await readFile(resolve(migrationRoot, name, 'migration.sql')),
      ),
    })),
  );
  // The literal R2 target and independent approved raw source are checked
  // before capture, the pg driver import, and client creation.
  const { captureTestEnvironment, validateBrowserTestDatabaseUrl } =
    await import('../../scripts/test-environment.mjs');
  const captured = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  const validated = validateBrowserTestDatabaseUrl(url, root);
  assert.equal(captured.childEnvironment.DATABASE_URL, url);
  assert.equal(validated.connectionString, url);
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString: url });
  const schema = `record_reference_reuse_${randomUUID().replaceAll('-', '')}`;
  const qschema = `"${schema}"`;
  const tables = [
    'material_references',
    'audit_events',
    'case_execution_mailing_record_corrections',
    'case_execution_mailing_record_documents',
    'case_execution_filing_record_corrections',
    'case_execution_filing_record_documents',
    'case_execution_finish_record_corrections',
    'case_execution_finish_record_documents',
    'case_judgment_record_corrections',
    'case_judgment_record_documents',
    'case_closure_record_corrections',
    'case_closure_record_documents',
    'case_execution_filings',
    'case_execution_filing_versions',
    'case_execution_filing_receipts',
    'case_execution_finishes',
    'case_execution_finish_versions',
    'case_execution_finish_receipts',
    'case_judgment_facts',
    'case_judgment_versions',
    'case_judgment_receipts',
    'case_closure_versions',
    'case_closure_documents',
    'case_closure_receipts',
  ];
  let created = false;
  let passed = false;
  let result;
  let cleanupFailure;
  let publicBefore;
  const publicSummary = async () =>
    (
      await client.query(`SELECT
    (SELECT count(*)::int FROM public.material_references) AS references,
    (SELECT count(*)::int FROM public.audit_events) AS audits,
    (SELECT jsonb_agg(jsonb_build_array(migration_name,checksum,finished_at,rolled_back_at)
      ORDER BY migration_name) FROM public._prisma_migrations) AS ledger,
    (SELECT pg_get_indexdef('public.material_references_resource_purpose_version_key'::regclass)) AS original_index,
    (SELECT jsonb_agg(jsonb_build_array(c.relname,c.oid::text) ORDER BY c.relname,c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AS catalog`)
    ).rows[0];
  try {
    await client.connect();
    assert.deepEqual(
      (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
        )
      ).rows,
      [{ db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' }],
    );
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.equal(applied.length, 158, 'Predeploy requires public 158');
    for (const [index, item] of ledger.entries()) {
      assert.equal(applied[index].migration_name, item.name);
      assert.equal(applied[index].checksum, item.checksum);
      assert.ok(applied[index].finished_at && !applied[index].rolled_back_at);
    }
    publicBefore = await publicSummary();
    const oldIndex = publicBefore.original_index;
    assert.match(oldIndex, /SECOND_INSTANCE_DOCUMENT/u);
    assert.match(oldIndex, /EXECUTION_FILING_PROOF/u);
    const oldPredicate = (
      await client.query(`SELECT pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_index i WHERE i.indexrelid='public.material_references_resource_purpose_version_key'::regclass`)
    ).rows[0].predicate;
    assert.match(oldPredicate, /EXECUTION_FILING_PROOF/u);
    await client.query(`CREATE SCHEMA ${qschema}`);
    created = true;
    await client.query(`SET search_path TO ${qschema},pg_catalog`);
    assert.equal(
      (await client.query('SELECT current_schema() AS schema')).rows[0].schema,
      schema,
    );
    await client.query(`CREATE TABLE ${qschema}.material_references
      (LIKE public.material_references INCLUDING ALL EXCLUDING INDEXES)`);
    await client.query(`CREATE TABLE ${qschema}.audit_events
      (id uuid PRIMARY KEY,department_id uuid,resource_type text,resource_id uuid,action text)`);
    for (const table of tables.slice(2, 12))
      await client.query(`CREATE TABLE ${qschema}."${table}" (
        id uuid,correction_id uuid,case_id uuid,department_id uuid,
        audit_event_id uuid,material_id uuid,content_version_id uuid)`);
    for (const table of [
      'case_execution_filings',
      'case_execution_finishes',
      'case_judgment_facts',
      'case_closure_versions',
    ])
      await client.query(
        `CREATE TABLE ${qschema}."${table}" (id uuid,case_id uuid,department_id uuid,audit_event_id uuid)`,
      );
    for (const table of [
      'case_execution_filing_versions',
      'case_execution_finish_versions',
      'case_judgment_versions',
      'case_closure_documents',
    ])
      await client.query(
        `CREATE TABLE ${qschema}."${table}" (filing_id uuid,finish_id uuid,fact_id uuid,closure_version_id uuid,case_id uuid,department_id uuid,material_id uuid,content_version_id uuid)`,
      );
    for (const table of [
      'case_execution_filing_receipts',
      'case_execution_finish_receipts',
      'case_judgment_receipts',
      'case_closure_receipts',
    ])
      await client.query(
        `CREATE TABLE ${qschema}."${table}" (case_id uuid,department_id uuid,result_snapshot jsonb)`,
      );
    const ownedIndex = oldIndex.replace(
      / ON (?:public\.)?material_references /u,
      ` ON ${qschema}.material_references `,
    );
    assert.notEqual(
      ownedIndex,
      oldIndex,
      'Cannot clone the exact public 158 index',
    );
    await client.query(ownedIndex);
    const oldGuards = [
      [
        'check_case_execution_filing_reference',
        '89c9b856dd7eea9a9a4da9cf38cbf425',
      ],
      [
        'check_case_execution_finish_reference',
        '93a253023e12d75047452f8d49cc161c',
      ],
      [
        'check_case_judgment_reference_insert',
        '1399d74e07a16c67aa079c1dfeff7f23',
      ],
      ['check_case_closure_reference', 'e8632d06bbde700ddb67828136f7a9eb'],
    ];
    const oldBodies = new Map();
    for (const [name, expectedMd5] of oldGuards) {
      const original = (
        await client.query(
          `SELECT p.prosrc,md5(p.prosrc) AS body_md5
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1 AND p.pronargs=0`,
          [name],
        )
      ).rows;
      assert.equal(original.length, 1);
      assert.equal(original[0].body_md5, expectedMd5);
      assert.ok(!original[0].prosrc.includes('$owned_guard$'));
      oldBodies.set(name, original[0].prosrc);
      await client.query(`CREATE FUNCTION ${qschema}."${name}"() RETURNS trigger LANGUAGE plpgsql
        AS $owned_guard$${original[0].prosrc}$owned_guard$`);
    }
    const oldOwnedIndex = (
      await client.query(
        `SELECT pg_get_indexdef('material_references_resource_purpose_version_key'::regclass) AS definition`,
      )
    ).rows[0].definition;
    const sourceSql = sourceBytes.toString('utf8');
    const injected = injectReferenceReuseRollbackProbe(sourceSql);
    await assert.rejects(
      client.query(injected),
      /deliberate migration rollback proof/u,
    );
    await client.query('ROLLBACK');
    const catalogAfterFailure = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema=$1 AND table_name='material_references' AND column_name='is_repeatable_typed_reference') AS marker,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname IN ('classify_case_record_material_reference','reject_material_reference_classification_change')) AS functions,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgname LIKE 'material_references_repeatable_typed_%') AS triggers`,
        [schema],
      )
    ).rows[0];
    assert.deepEqual(catalogAfterFailure, {
      marker: 0,
      functions: 0,
      triggers: 0,
    });
    assert.equal(
      (
        await client.query(
          `SELECT pg_get_indexdef('material_references_resource_purpose_version_key'::regclass) AS definition`,
        )
      ).rows[0].definition,
      oldOwnedIndex,
      'Failed DDL did not fully restore old index',
    );
    assert.deepEqual(await publicSummary(), publicBefore);
    await client.query(sourceSql);
    const compiled = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema=$1 AND table_name='material_references' AND column_name='is_repeatable_typed_reference') AS marker,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname IN ('classify_case_record_material_reference','reject_material_reference_classification_change')) AS functions,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgname LIKE 'material_references_repeatable_typed_%') AS triggers`,
        [schema],
      )
    ).rows[0];
    assert.deepEqual(compiled, { marker: 1, functions: 2, triggers: 2 });
    for (const [name] of oldGuards) {
      const replacement = (
        await client.query(
          `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=$1 AND p.proname=$2 AND p.pronargs=0`,
          [schema, name],
        )
      ).rows[0].prosrc;
      const original = oldBodies.get(name);
      const beginAt = original.indexOf('\nBEGIN\n');
      assert.ok(beginAt > 0);
      assert.ok(replacement.startsWith(original.slice(0, beginAt + 7)));
      assert.ok(
        replacement.endsWith(original.slice(beginAt + 7)),
        `Original ${name} suffix changed`,
      );
    }
    const newPredicate = (
      await client.query(`SELECT pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i
      WHERE i.indexrelid='material_references_resource_purpose_version_key'::regclass`)
    ).rows[0].predicate;
    assert.match(newPredicate, /is_repeatable_typed_reference/u);
    for (const purpose of [
      'JUDGMENT',
      'SECOND_INSTANCE_DOCUMENT',
      'SECOND_INSTANCE_SERVICE',
      'SECOND_INSTANCE_JUDGMENT',
      'EXECUTION_APPLICATION',
      'EXECUTION_FILING_PROOF',
    ]) {
      const key = randomUUID();
      const caseId = randomUUID();
      const departmentId = randomUUID();
      for (let n = 0; n < 2; n++)
        await client.query(
          `INSERT INTO material_references
          (id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id)
          VALUES ($1,$2,'case',$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            departmentId,
            caseId,
            purpose,
            randomUUID(),
            key,
            randomUUID(),
          ],
        );
      assert.equal(
        (
          await client.query(
            'SELECT count(*)::int AS n FROM material_references WHERE purpose=$1 AND resource_id=$2 AND content_version_id=$3',
            [purpose, caseId, key],
          )
        ).rows[0].n,
        2,
      );
    }
    const branches = [
      {
        name: 'check_case_execution_filing_reference',
        purpose: 'EXECUTION_FILING_PROOF',
        action: 'case.execution.filing.submitted',
        correctionAction: 'case.execution.filing.record-corrected',
        fact: 'case_execution_filings',
        version: 'case_execution_filing_versions',
        versionKey: 'filing_id',
        correction: 'case_execution_filing_record_corrections',
        document: 'case_execution_filing_record_documents',
      },
      {
        name: 'check_case_execution_finish_reference',
        purpose: 'EXECUTION_FINISH_BASIS',
        action: 'case.execution.finished',
        correctionAction: 'case.execution.finish.record-corrected',
        fact: 'case_execution_finishes',
        version: 'case_execution_finish_versions',
        versionKey: 'finish_id',
        correction: 'case_execution_finish_record_corrections',
        document: 'case_execution_finish_record_documents',
      },
      {
        name: 'check_case_judgment_reference_insert',
        purpose: 'JUDGMENT',
        action: 'case.judgment.registered',
        correctionAction: 'case.judgment.record-corrected',
        fact: 'case_judgment_facts',
        version: 'case_judgment_versions',
        versionKey: 'fact_id',
        correction: 'case_judgment_record_corrections',
        document: 'case_judgment_record_documents',
      },
      {
        name: 'check_case_closure_reference',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        action: 'case.closure.recorded',
        correctionAction: 'case.closure.record-corrected',
        fact: 'case_closure_versions',
        version: 'case_closure_documents',
        versionKey: 'closure_version_id',
        correction: 'case_closure_record_corrections',
        document: 'case_closure_record_documents',
      },
    ];
    for (const branch of branches)
      await client.query(`CREATE TRIGGER "${branch.name}" BEFORE INSERT ON material_references
        FOR EACH ROW EXECUTE FUNCTION "${branch.name}"()`);
    for (const branch of branches) {
      const caseId = randomUUID(),
        departmentId = randomUUID(),
        factId = randomUUID();
      const materialId = randomUUID(),
        versionId = randomUUID(),
        originalAudit = randomUUID();
      await client.query(
        "INSERT INTO audit_events(id,department_id,resource_type,resource_id,action) VALUES($1,$2,'CASE',$3,$4)",
        [originalAudit, departmentId, caseId, branch.action],
      );
      await client.query(
        `INSERT INTO "${branch.fact}"(id,case_id,department_id,audit_event_id) VALUES($1,$2,$3,$4)`,
        [factId, caseId, departmentId, originalAudit],
      );
      await client.query(
        `INSERT INTO "${branch.version}"("${branch.versionKey}",case_id,department_id,material_id,content_version_id) VALUES($1,$2,$3,$4,$5)`,
        [factId, caseId, departmentId, materialId, versionId],
      );
      await client.query(
        `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id) VALUES($1,$2,'case',$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          departmentId,
          caseId,
          branch.purpose,
          materialId,
          versionId,
          originalAudit,
        ],
      );
      const correctedAudit = randomUUID(),
        correctionId = randomUUID();
      await client.query('BEGIN');
      try {
        await client.query(
          "INSERT INTO audit_events(id,department_id,resource_type,resource_id,action) VALUES($1,$2,'CASE',$3,$4)",
          [correctedAudit, departmentId, caseId, branch.correctionAction],
        );
        await client.query(
          `INSERT INTO "${branch.correction}"(id,case_id,department_id,audit_event_id) VALUES($1,$2,$3,$4)`,
          [correctionId, caseId, departmentId, correctedAudit],
        );
        await client.query(
          `INSERT INTO "${branch.document}"(correction_id,case_id,department_id,material_id,content_version_id) VALUES($1,$2,$3,$4,$5)`,
          [correctionId, caseId, departmentId, materialId, versionId],
        );
        await client.query(
          `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id) VALUES($1,$2,'case',$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            departmentId,
            caseId,
            branch.purpose,
            materialId,
            versionId,
            correctedAudit,
          ],
        );
        assert.equal(
          (
            await client.query(
              'SELECT is_repeatable_typed_reference AS marker FROM material_references WHERE action_event_id=$1',
              [correctedAudit],
            )
          ).rows[0].marker,
          true,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      await client.query('BEGIN');
      try {
        const badAudit = randomUUID(),
          badCorrection = randomUUID();
        await client.query(
          "INSERT INTO audit_events(id,department_id,resource_type,resource_id,action) VALUES($1,$2,'CASE',$3,$4)",
          [badAudit, departmentId, caseId, branch.correctionAction],
        );
        await client.query(
          `INSERT INTO "${branch.correction}"(id,case_id,department_id,audit_event_id) VALUES($1,$2,$3,$4)`,
          [badCorrection, caseId, departmentId, badAudit],
        );
        await client.query(
          `INSERT INTO "${branch.document}"(correction_id,case_id,department_id,material_id,content_version_id) VALUES($1,$2,$3,$4,$5)`,
          [badCorrection, caseId, departmentId, materialId, versionId],
        );
        await assert.rejects(
          client.query(
            `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id) VALUES($1,$2,'case',$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              departmentId,
              caseId,
              branch.purpose,
              randomUUID(),
              versionId,
              badAudit,
            ],
          ),
          (error) => error.code === '23514',
        );
      } finally {
        await client.query('ROLLBACK');
      }
    }
    assert.deepEqual(
      await publicSummary(),
      publicBefore,
      'Owned compilation changed public',
    );
    passed = true;
    result = {
      head,
      tree,
      migrationSha256,
      failedMigrationRolledBack: true,
      compiled,
      sixExemptPurposesPreserved: true,
      fourOriginalAndCorrectionBranches: true,
      publicUnchanged: true,
      scope: 'owned-schema DDL/index only; full HTTP pending',
    };
  } finally {
    if (created && passed) {
      try {
        await client.query('BEGIN');
        for (const table of tables)
          await client.query(`DROP TABLE ${qschema}."${table}"`);
        await client.query(
          `DROP FUNCTION ${qschema}."classify_case_record_material_reference"()`,
        );
        await client.query(
          `DROP FUNCTION ${qschema}."reject_material_reference_classification_change"()`,
        );
        for (const [name] of [
          ['check_case_execution_filing_reference'],
          ['check_case_execution_finish_reference'],
          ['check_case_judgment_reference_insert'],
          ['check_case_closure_reference'],
        ])
          await client.query(`DROP FUNCTION ${qschema}."${name}"()`);
        await client.query('SET LOCAL search_path TO pg_catalog');
        await client.query(`DROP SCHEMA ${qschema}`);
        await client.query('COMMIT');
        assert.deepEqual(await publicSummary(), publicBefore);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        cleanupFailure = error;
      }
    }
    await client.end();
  }
  if (cleanupFailure) throw cleanupFailure;
  return result;
}

export async function assertReferenceReuseRunner() {
  const url = assertReferenceReuseBinding();
  const { head, tree } = assertCleanReferenceReuseCheckout();
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(
    names.length,
    159,
    'Expected source ledger through reuse migration 159',
  );
  assert.equal(
    names.at(-1),
    '20261016093000_case_record_material_reference_reuse',
  );
  const ledger = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: sha(
        await readFile(resolve(migrationRoot, name, 'migration.sql')),
      ),
    })),
  );
  const reuseBytes = await readFile(
    resolve(migrationRoot, names.at(-1), 'migration.sql'),
  );
  assertApprovedReferenceReuseMigration(reuseBytes, ledger.at(-1).checksum);
  const { captureTestEnvironment, validateBrowserTestDatabaseUrl } =
    await import('../../scripts/test-environment.mjs');
  const captured = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  const validated = validateBrowserTestDatabaseUrl(url, root);
  assert.equal(captured.childEnvironment.DATABASE_URL, url);
  assert.equal(validated.connectionString, url);
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    assert.deepEqual(
      (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
        )
      ).rows,
      [{ db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' }],
    );
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.equal(applied.length, ledger.length);
    for (const [index, source] of ledger.entries()) {
      assert.equal(applied[index].migration_name, source.name);
      assert.equal(applied[index].checksum, source.checksum);
      assert.ok(applied[index].finished_at && !applied[index].rolled_back_at);
    }
    const security = (
      await client.query(
        'SELECT (SELECT count(*)::int FROM role_grants WHERE role_template_id=$1) AS grants, (SELECT count(*)::int FROM role_assignments WHERE user_id=$2 AND role_template_id=$1 AND active) AS active_assignments, (SELECT count(*)::int FROM department_memberships WHERE user_id=$2 AND department_id=$3 AND active) AS active_memberships',
        [approved.roleId, approved.actorId, approved.departmentId],
      )
    ).rows[0];
    assert.deepEqual(security, {
      grants: 42,
      active_assignments: 1,
      active_memberships: 1,
    });
    candidate = { head, tree, migrationSha256: ledger.at(-1).checksum };
    return candidate;
  } finally {
    await client.end();
  }
}

export function referenceReuseActor() {
  assert.ok(
    candidate,
    'Check the exact R2 candidate and ledger before credential access',
  );
  const bytes = readFileSync(approved.privatePath);
  assert.equal(sha(bytes), approved.privateSha256);
  const actor = JSON.parse(bytes.toString('utf8'));
  assert.equal(actor.actorId, approved.actorId);
  assert.equal(actor.roleId, approved.roleId);
  assert.equal(actor.departmentId, approved.departmentId);
  assert.match(actor.username, /^historical-record-[a-f0-9-]{36}$/u);
  assert.ok(typeof actor.password === 'string' && actor.password.length > 0);
  return Object.freeze({
    ...actor,
    userId: approved.actorId,
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
  });
}

export async function ownReferenceReuseCase(caseId, source) {
  assert.ok(candidate);
  assert.match(caseId, uuid);
  assert.match(source, /^case-record-reference-reuse:[0-9a-f-]{36}:/u);
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({
    connectionString: assertReferenceReuseBinding(),
  });
  try {
    await client.connect();
    const result = await client.query(
      'SELECT c.id FROM cases c JOIN case_external_entries e ON e.case_id=c.id WHERE c.id=$1 AND c.department_id=$2 AND e.recorded_by_user_id=$3 AND e.source=$4',
      [caseId, approved.departmentId, approved.actorId, source],
    );
    assert.equal(
      result.rowCount,
      1,
      'Only the current HTTP-created owned case is accepted',
    );
    owned.set(caseId, source);
  } finally {
    await client.end();
  }
}

export async function referenceReuseSnapshot(caseId) {
  assert.ok(owned.has(caseId));
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({
    connectionString: assertReferenceReuseBinding(),
  });
  try {
    await client.connect();
    const rows = await client.query(
      `SELECT r.purpose,r.material_id,r.content_version_id,r.action_event_id,r.is_repeatable_typed_reference,a.action
      FROM material_references r LEFT JOIN audit_events a ON a.id=r.action_event_id
      WHERE r.resource_type='case' AND r.resource_id=$1 AND r.department_id=$2
      ORDER BY r.purpose,r.content_version_id,r.action_event_id`,
      [caseId, approved.departmentId],
    );
    const corrections = await client.query(
      `SELECT 'mailing' AS kind,count(*)::int AS n FROM case_execution_mailing_record_corrections WHERE case_id=$1
      UNION ALL SELECT 'filing',count(*)::int FROM case_execution_filing_record_corrections WHERE case_id=$1
      UNION ALL SELECT 'finish',count(*)::int FROM case_execution_finish_record_corrections WHERE case_id=$1
      UNION ALL SELECT 'judgment',count(*)::int FROM case_judgment_record_corrections WHERE case_id=$1
      UNION ALL SELECT 'closure',count(*)::int FROM case_closure_record_corrections WHERE case_id=$1`,
      [caseId],
    );
    const receipts = await client.query(
      'SELECT command,count(*)::int AS n FROM case_section_record_edit_receipts WHERE case_id=$1 GROUP BY command ORDER BY command',
      [caseId],
    );
    return {
      references: rows.rows,
      corrections: corrections.rows,
      receipts: receipts.rows,
    };
  } finally {
    await client.end();
  }
}

export async function referenceReuseSqlRejections(caseId, purpose) {
  assert.ok(owned.has(caseId));
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({
    connectionString: assertReferenceReuseBinding(),
  });
  const results = [];
  try {
    await client.connect();
    const references = (
      await client.query(
        `SELECT r.department_id,r.resource_type,r.resource_id,r.purpose,r.material_id,r.content_version_id,r.action_event_id,r.is_repeatable_typed_reference
      FROM material_references r WHERE r.resource_type='case' AND r.resource_id=$1 AND r.department_id=$2 ORDER BY r.created_at,r.id`,
        [caseId, approved.departmentId],
      )
    ).rows;
    const ordinary = references.find(
      (row) => row.purpose === purpose && !row.is_repeatable_typed_reference,
    );
    const correction = references.find(
      (row) => row.purpose === purpose && row.is_repeatable_typed_reference,
    );
    const wrong = references.find((row) => row.purpose !== purpose);
    assert.ok(
      ordinary && correction && wrong,
      'Real HTTP source must have original, correction, and other document',
    );
    for (const [name, materialId, versionId, eventId, expectedCode] of [
      [
        'ordinary duplicate',
        ordinary.material_id,
        ordinary.content_version_id,
        null,
        '23505',
      ],
      [
        'committed correction audit with wrong document',
        wrong.material_id,
        wrong.content_version_id,
        correction.action_event_id,
        '23514',
      ],
    ]) {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO material_references
          (id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id)
          VALUES (gen_random_uuid(),$1,'case',$2,$3,$4,$5,$6)`,
          [
            approved.departmentId,
            caseId,
            purpose,
            materialId,
            versionId,
            eventId,
          ],
        );
        assert.fail(`${name} unexpectedly inserted`);
      } catch (error) {
        assert.equal(error.code, expectedCode, name);
        results.push({ name, code: error.code });
      } finally {
        await client.query('ROLLBACK');
      }
    }
    return results;
  } finally {
    await client.end();
  }
}
