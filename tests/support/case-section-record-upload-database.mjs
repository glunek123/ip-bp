import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

const root = process.cwd();
const approved = {
  project: 'dev-cor-ui003-r2',
  container: '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  host: '127.0.0.1',
  port: 15438,
  database: 'dev_cor_test',
};
const fixture = {
  departmentId: '10000000-0000-4000-8000-000000000001',
  customerId: '50000000-0000-4000-8000-000000000002',
  rightsHolderId: '60000000-0000-4000-8000-000000000001',
};
const prefix = 'section-record-upload-r2:';
const ownedActors = new Map();
const ownedCases = new Set();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Deliberately no database or application-service import at module load.
function admission() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DEV_COR_TEST_DATABASE_PROJECT, approved.project);
  assert.equal(
    process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    approved.container,
  );
  assert.ok(process.env.DEV_COR_TEST_DATABASE_URL);
  assert.ok(process.env.DATABASE_URL);
  for (const value of [
    process.env.DATABASE_URL,
    process.env.DEV_COR_TEST_DATABASE_URL,
  ]) {
    const parsed = new URL(value);
    assert.equal(parsed.hostname, approved.host);
    assert.equal(Number(parsed.port), approved.port);
    assert.equal(
      decodeURIComponent(parsed.pathname.slice(1)),
      approved.database,
    );
  }
  const pnpmVersion = (process.env.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/u,
  )?.[1];
  assert.ok(pnpmVersion, 'Use the protected pnpm E2E runner');
  const captured = captureTestEnvironment(root, { pnpmVersion });
  const target = validateBrowserTestDatabaseUrl(process.env.DATABASE_URL, root);
  assert.equal(target.connectionString, captured.childEnvironment.DATABASE_URL);
  assert.equal(target.connectionString, process.env.DEV_COR_TEST_DATABASE_URL);
  const url = new URL(target.connectionString);
  assert.equal(url.hostname, approved.host);
  assert.equal(Number(url.port), approved.port);
  assert.equal(decodeURIComponent(url.pathname.slice(1)), approved.database);
  return target.connectionString;
}

async function withDatabase(operation) {
  const connectionString = admission();
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    assert.deepEqual(identity, { db: approved.database, schema: 'public' });
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function assertSectionUploadRunner() {
  return withDatabase(async (client) => {
    const migrationRoot = resolve(root, 'backend/prisma/migrations');
    const names = (await readdir(migrationRoot))
      .filter((name) => /^\d{14}_/u.test(name))
      .sort();
    assert.equal(names.length, 157);
    assert.deepEqual(names.slice(-3), [
      '20261015130000_guard_direct_second_remand_child',
      '20261015150000_case_section_record_edits',
      '20261015170000_case_section_record_uploads',
    ]);
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.deepEqual(
      applied.map((row) => row.migration_name),
      names,
    );
    for (const [index, name] of names.entries()) {
      assert.ok(applied[index].finished_at);
      assert.equal(applied[index].rolled_back_at, null);
      const bytes = await readFile(
        resolve(migrationRoot, name, 'migration.sql'),
      );
      assert.equal(
        applied[index].checksum,
        createHash('sha256').update(bytes).digest('hex'),
      );
    }
  });
}

export async function createSectionUploadActor() {
  // Password hashing is loaded after admission, so importing this support is inert.
  admission();
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { hashPassword } = requireBackend('./dist/auth/password.js');
  const userId = randomUUID();
  const roleId = randomUUID();
  const username = `${prefix}${randomUUID()}`;
  const password = `R2-${randomUUID()}-synthetic`;
  const passwordHash = await hashPassword(password);
  await withDatabase(async (client) => {
    const present = (
      await client.query('SELECT id FROM departments WHERE id=$1', [
        fixture.departmentId,
      ])
    ).rows;
    assert.equal(
      present.length,
      1,
      'Runner must prepare the approved synthetic department',
    );
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$2,now())',
        [userId, username],
      );
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
        [randomUUID(), userId, fixture.departmentId],
      );
      await client.query(
        'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), userId, username, passwordHash],
      );
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
        [roleId, fixture.departmentId, `${prefix}${roleId}`],
      );
      for (const action of [
        'customer.read',
        'case.read',
        'case.external-entry.create',
        'case.execution.mail',
        'case.judgment.register',
        'case.judgment.next_step',
        'case.execution.filing.submit',
        'case.execution.finish',
        'case.closure.record',
        'case.archive',
        'case.execution.mailing.correct',
        'case.execution.filing.correct',
        'case.execution.finish.correct',
        'case.judgment.correct',
        'case.closure.correct',
      ]) {
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,'DEPARTMENT')",
          [randomUUID(), roleId, action],
        );
      }
      await client.query(
        'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), userId, fixture.departmentId, roleId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  ownedActors.set(userId, roleId);
  return { userId, roleId, username, password, ...fixture };
}

export async function ownSectionUploadCase(caseId, actorUserId) {
  assert.match(caseId, uuid);
  assert.ok(
    ownedActors.has(actorUserId),
    'Only this test actor may own a case',
  );
  await withDatabase(async (client) => {
    const rows = (
      await client.query(
        'SELECT id FROM case_external_entries WHERE case_id=$1 AND recorded_by_user_id=$2 AND source LIKE $3',
        [caseId, actorUserId, `${prefix}%`],
      )
    ).rows;
    assert.equal(
      rows.length,
      1,
      'Case must be appended by this section-upload test',
    );
  });
  ownedCases.add(caseId);
}

export function sectionUploadFixture() {
  return { ...fixture, sourcePrefix: prefix };
}

export async function revokeSectionUploadActor(userId) {
  const roleId = ownedActors.get(userId);
  assert.ok(roleId, 'Only a role appended by this support may be revoked');
  await withDatabase(async (client) => {
    const result = await client.query(
      'UPDATE role_assignments SET active=false,updated_at=now() WHERE user_id=$1 AND role_template_id=$2 AND department_id=$3 AND active=true',
      [userId, roleId, fixture.departmentId],
    );
    assert.equal(result.rowCount, 1);
  });
}

export async function sectionUploadSnapshot(caseId) {
  assert.ok(ownedCases.has(caseId));
  return withDatabase(async (client) => {
    const rows = await client.query(
      `
      SELECT v.id AS version_id,v.storage_key,d.id AS draft_id,d.status AS draft_status,
        d.case_section_record_command AS command,d.case_section_record_target_id AS target_id,
        d.case_section_record_revision AS revision,
        case_section_upload_has_first_freeze(v.id) AS first_freeze
      FROM content_versions v JOIN upload_drafts d ON d.id=v.case_section_record_upload_draft_id
      WHERE d.owner_type='CASE' AND d.owner_id=$1 AND d.department_id=$2 ORDER BY v.id`,
      [caseId, fixture.departmentId],
    );
    return rows.rows;
  });
}

export async function sectionUploadRollbackProbe(caseId, versionId, mutation) {
  assert.ok(ownedCases.has(caseId));
  assert.match(versionId, uuid);
  assert.ok(
    [
      'rebind',
      'unlink',
      'material-scope',
      'material-purpose',
      'fake-reference',
      'workflow',
    ].includes(mutation),
  );
  return withDatabase(async (client) => {
    const owned = (
      await client.query(
        `SELECT v.id,v.material_id,d.id AS draft_id,d.case_section_record_command AS command,d.case_section_record_target_id AS target_id
      FROM content_versions v JOIN upload_drafts d ON d.id=v.case_section_record_upload_draft_id
      WHERE v.id=$1 AND d.owner_id=$2 AND d.department_id=$3`,
        [versionId, caseId, fixture.departmentId],
      )
    ).rows[0];
    assert.ok(owned, 'Probe only this test case and its bound version');
    await client.query('BEGIN');
    let rejected = false;
    try {
      if (mutation === 'rebind') {
        await client.query(
          'UPDATE upload_drafts SET case_section_record_target_id=$2 WHERE id=$1',
          [owned.draft_id, randomUUID()],
        );
      } else if (mutation === 'unlink') {
        await client.query(
          'UPDATE content_versions SET case_section_record_upload_draft_id=NULL WHERE id=$1',
          [versionId],
        );
      } else if (mutation === 'material-scope') {
        await client.query('UPDATE materials SET owner_id=$2 WHERE id=$1', [
          owned.material_id,
          randomUUID(),
        ]);
      } else if (mutation === 'material-purpose') {
        await client.query(
          "UPDATE materials SET purpose='JUDGMENT' WHERE id=$1",
          [owned.material_id],
        );
      } else if (mutation === 'fake-reference') {
        await client.query(
          `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id,created_at)
          VALUES($1,$2,'case',$3,'MAIL_RECEIPT',$4,$5,NULL,now())`,
          [
            randomUUID(),
            fixture.departmentId,
            caseId,
            owned.material_id,
            versionId,
          ],
        );
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      } else {
        assert.equal(owned.command, 'EXECUTION_MAILING_CORRECTION');
        await client.query(
          'INSERT INTO case_execution_mailing_versions(mailing_id,case_id,department_id,material_id,content_version_id) VALUES($1,$2,$3,$4,$5)',
          [
            owned.target_id,
            caseId,
            fixture.departmentId,
            owned.material_id,
            versionId,
          ],
        );
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }
    } catch {
      rejected = true;
    } finally {
      await client.query('ROLLBACK');
    }
    return rejected;
  });
}

export async function sectionUploadLifecycleProbe(caseId, versionId) {
  assert.ok(ownedCases.has(caseId));
  assert.match(versionId, uuid);
  return withDatabase(async (client) => {
    const original = (
      await client.query(
        `SELECT v.*,to_jsonb(v)-'status' AS metadata FROM content_versions v JOIN materials m ON m.id=v.material_id
      WHERE v.id=$1 AND m.owner_type='CASE' AND m.owner_id=$2 AND m.department_id=$3 AND v.case_section_record_upload_draft_id IS NOT NULL
      AND NOT case_section_upload_has_first_freeze(v.id)`,
        [versionId, caseId, fixture.departmentId],
      )
    ).rows[0];
    assert.ok(
      original,
      'Only an owned unconsumed upload can enter a rollback lifecycle probe',
    );
    await client.query('BEGIN');
    try {
      const otherCase = [...ownedCases].find((id) => id !== caseId);
      assert.ok(
        otherCase,
        'Use a second owned existing case before the first freeze',
      );
      await client.query('SAVEPOINT unconsumed_binding');
      let bindingRejected = false;
      try {
        await client.query('UPDATE materials SET owner_id=$2 WHERE id=$1', [
          original.material_id,
          otherCase,
        ]);
      } catch {
        bindingRejected = true;
      }
      await client.query('ROLLBACK TO SAVEPOINT unconsumed_binding');
      assert.ok(
        bindingRejected,
        '157 must protect the binding before any typed correction exists',
      );
      await client.query(
        "UPDATE materials SET status='DELETED',deleted_at=now()-INTERVAL '91 days' WHERE id=$1",
        [original.material_id],
      );
      await client.query(
        "UPDATE content_versions SET status='DELETED' WHERE id=$1",
        [versionId],
      );
      await client.query(
        "UPDATE content_versions SET status='PURGED' WHERE id=$1",
        [versionId],
      );
      const after = (
        await client.query(
          "SELECT status,to_jsonb(v)-'status' AS metadata FROM content_versions v WHERE id=$1",
          [versionId],
        )
      ).rows[0];
      assert.deepEqual(after.metadata, original.metadata);
      return after.status === 'PURGED';
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

export async function sectionUploadQuotaProofProbe(caseId, versionId) {
  assert.ok(ownedCases.has(caseId));
  assert.match(versionId, uuid);
  return withDatabase(async (client) => {
    const source = (
      await client.query(
        `SELECT v.*,m.category FROM content_versions v JOIN materials m ON m.id=v.material_id
      WHERE v.id=$1 AND m.current_version_id=v.id AND m.owner_type='CASE' AND m.owner_id=$2 AND m.department_id=$3
        AND v.case_section_record_upload_draft_id IS NOT NULL`,
        [versionId, caseId, fixture.departmentId],
      )
    ).rows[0];
    assert.ok(source, 'Only this run current dedicated version may be probed');
    const check = async (targetCase, department, category) =>
      (
        await client.query(
          'SELECT case_section_upload_current_is_frozen($1,$2,$3,$4) AS frozen',
          [source.material_id, targetCase, department, category],
        )
      ).rows[0].frozen;
    assert.equal(
      await check(caseId, fixture.departmentId, source.category),
      true,
    );
    assert.equal(
      await check(randomUUID(), fixture.departmentId, source.category),
      false,
    );
    assert.equal(await check(caseId, randomUUID(), source.category), false);
    assert.equal(await check(caseId, fixture.departmentId, 'JUDGMENT'), false);
    await client.query('BEGIN');
    try {
      const nextId = randomUUID();
      await client.query(
        `INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'AVAILABLE')`,
        [
          nextId,
          source.material_id,
          `rollback-only/${nextId}`,
          source.original_filename,
          source.mime_type,
          source.size_bytes,
          source.sha256,
          source.uploaded_by,
        ],
      );
      await client.query(
        'UPDATE materials SET current_version_id=$2 WHERE id=$1',
        [source.material_id, nextId],
      );
      const excludesOldFrozen = await check(
        caseId,
        fixture.departmentId,
        source.category,
      );
      return { excludesOldFrozen };
    } finally {
      await client.query('ROLLBACK');
    }
  });
}
