import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dirname, '../../backend');
const requireBackend = createRequire(resolve(backend, 'package.json'));
const { Client } = requireBackend('pg');
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is required');
const url = new URL(baseUrl);
if (
  url.hostname !== '127.0.0.1' ||
  url.port !== '55433' ||
  url.pathname !== '/dev_cor_test' ||
  url.username !== 'dev_cor_test' ||
  url.search
)
  throw new Error('The isolated test database URL is required');

const migrationsPath = resolve(backend, 'prisma/migrations');
const migrationNames = readdirSync(migrationsPath)
  .filter((name) => /^20\d+_/.test(name))
  .sort();
if (
  migrationNames.length !== 72 ||
  !migrationNames[67].includes('lawyer_identity_enums') ||
  !migrationNames[68].includes('lawyer_accounts_and_actor_paths') ||
  !migrationNames[69].includes('fix_lawyer_actor_case_variable') ||
  !migrationNames[70].includes('reject_lawyer_internal_membership') ||
  !migrationNames[71].includes('anchor_lawyer_profile_and_cleanup_drafts')
)
  throw new Error(
    'Expected exactly 67 previous migrations and 5 lawyer migrations',
  );

const client = new Client({ connectionString: baseUrl });
await client.connect();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dev-cor-lawyer-migration-'));
const prisma = resolve(backend, 'node_modules/prisma/build/index.js');
const schemaFile = resolve(backend, 'prisma/schema.prisma');

function runPrisma(schema, config, args, expectSuccess) {
  const schemaUrl = new URL(baseUrl);
  schemaUrl.searchParams.set('schema', schema);
  const result = spawnSync(
    process.execPath,
    [prisma, ...args, ...(config ? ['--config', config] : [])],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: schemaUrl.href },
      encoding: 'utf8',
    },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll(
    schemaUrl.password,
    '[REDACTED]',
  );
  if (expectSuccess !== (result.status === 0) || result.error) {
    process.stdout.write(output);
    throw new Error(
      `Prisma ${args.join(' ')} returned ${result.error?.message ?? result.status}`,
    );
  }
  if (!expectSuccess && !output.includes('failed')) {
    process.stdout.write(output);
    throw new Error(
      'Expected a migration failure, but the failure was not reported',
    );
  }
}

function buildCurrentService() {
  runPrisma('public', null, ['generate'], true);
  const result = spawnSync(
    process.execPath,
    [
      resolve(backend, 'node_modules/typescript/bin/tsc'),
      '-p',
      resolve(backend, 'tsconfig.build.json'),
    ],
    { cwd: backend, encoding: 'utf8' },
  );
  if (result.status !== 0 || result.error) {
    process.stdout.write(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    throw new Error(
      `Current backend service build returned ${result.error?.message ?? result.status}`,
    );
  }
}

async function seedLegacyMatch() {
  const departmentId = randomUUID();
  const actorId = randomUUID();
  const caseId = randomUUID();
  const profileId = randomUUID();
  const assignmentId = randomUUID();
  const receiptId = randomUUID();
  const auditId = randomUUID();
  const input = {
    expectedVersion: 1,
    idempotencyKey: `legacy-match-${randomUUID()}`,
    defendants: [{ kind: 'ORGANIZATION', name: '旧被告' }],
    lawyer: { fullName: '旧律师', lawFirm: '旧律所' },
  };
  const matchedAt = new Date().toISOString();
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        caseId,
        expectedVersion: input.expectedVersion,
        defendants: input.defendants,
        lawyer: input.lawyer,
      }),
    )
    .digest('hex');
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
    [departmentId, '旧匹配部门'],
  );
  await client.query(
    "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'INTERNAL',now())",
    [actorId, `legacy-lawyer-${actorId}`, '旧匹配经办'],
  );
  await client.query(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [randomUUID(), actorId, departmentId],
  );
  await client.query('SET session_replication_role = replica');
  try {
    await client.query(
      "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_COMPLAINT',2,$10)",
      [
        caseId,
        `LEGACY-LAWYER-${caseId}`,
        departmentId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        actorId,
        matchedAt,
      ],
    );
  } finally {
    await client.query('SET session_replication_role = origin');
  }
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [profileId, departmentId, input.lawyer.fullName, input.lawyer.lawFirm],
  );
  await client.query(
    "INSERT INTO case_defendants(id,case_id,department_id,kind,name) VALUES ($1,$2,$3,'ORGANIZATION',$4)",
    [randomUUID(), caseId, departmentId, input.defendants[0].name],
  );
  await client.query(
    "INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,'PRIMARY',$5)",
    [assignmentId, caseId, departmentId, profileId, matchedAt],
  );
  await client.query(
    "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.match.succeeded',$5)",
    [
      auditId,
      departmentId,
      actorId,
      caseId,
      {
        lawyerProfileId: profileId,
        fromVersion: 1,
        toVersion: 2,
        defendantCount: 1,
      },
    ],
  );
  await client.query(
    'INSERT INTO case_match_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      receiptId,
      departmentId,
      actorId,
      caseId,
      input.idempotencyKey,
      fingerprint,
      { id: caseId, stage: 'WAITING_COMPLAINT', version: 2, matchedAt },
    ],
  );
  const facts = await readLegacyFacts({
    caseId,
    profileId,
    assignmentId,
    receiptId,
    auditId,
  });
  return {
    actorId,
    departmentId,
    caseId,
    profileId,
    assignmentId,
    receiptId,
    auditId,
    input,
    matchedAt,
    facts,
  };
}

async function readLegacyFacts(ids) {
  const record = await client.query(
    'SELECT id,stage,version,matched_at,matched_on FROM cases WHERE id=$1',
    [ids.caseId],
  );
  const profile = await client.query(
    'SELECT id,department_id,full_name,law_firm,phone FROM lawyer_profiles WHERE id=$1',
    [ids.profileId],
  );
  const assignment = await client.query(
    'SELECT id,case_id,department_id,lawyer_id,role,started_at,ended_at FROM case_lawyer_assignments WHERE id=$1',
    [ids.assignmentId],
  );
  const defendants = await client.query(
    'SELECT kind,name,id_no,phone,address FROM case_defendants WHERE case_id=$1 ORDER BY id',
    [ids.caseId],
  );
  const receipt = await client.query(
    'SELECT id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot FROM case_match_receipts WHERE id=$1',
    [ids.receiptId],
  );
  const audit = await client.query(
    'SELECT id,department_id,actor_user_id,resource_type,resource_id,action,details FROM audit_events WHERE id=$1',
    [ids.auditId],
  );
  return JSON.stringify({
    record: record.rows,
    profile: profile.rows,
    assignment: assignment.rows,
    defendants: defendants.rows,
    receipt: receipt.rows,
    audit: audit.rows,
  });
}

async function replayLegacyMatch(schema, legacy) {
  const schemaUrl = new URL(baseUrl);
  schemaUrl.searchParams.set('schema', schema);
  const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
  const { PrismaPg } = requireBackend('@prisma/adapter-pg');
  const { CaseMatchService } = requireBackend(
    './dist/modules/cases/case-match.service.js',
  );
  const database = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: schemaUrl.href, options: `-c search_path=${schema}` },
      { schema },
    ),
  });
  try {
    const service = new CaseMatchService(database, {
      authorizeCase: async () => undefined,
    });
    const result = await service.match(
      {
        userId: legacy.actorId,
        departmentId: legacy.departmentId,
        authorizationRevision: 1,
      },
      legacy.caseId,
      legacy.input,
    );
    if (
      JSON.stringify(result) !==
      JSON.stringify({
        id: legacy.caseId,
        stage: 'WAITING_COMPLAINT',
        version: 2,
        matchedAt: legacy.matchedAt,
        matchedOn: null,
      })
    )
      throw new Error('Legacy pure-name match replay changed its response');
  } finally {
    await database.$disconnect();
  }
}

async function verifySerializableCompetition(schema) {
  const departmentId = randomUUID();
  const actorId = randomUUID();
  const lawyerId = randomUUID();
  const profileId = randomUUID();
  const sessionId = randomUUID();
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
    [departmentId, '并发律师部门'],
  );
  await client.query(
    "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,'经办','INTERNAL',now())",
    [actorId, `lawyer-actor-${actorId}`],
  );
  await client.query(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [randomUUID(), actorId, departmentId],
  );
  await client.query('BEGIN');
  try {
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,'并发律师','LAWYER',now())",
      [lawyerId, `lawyer-race-${lawyerId}`],
    );
    await client.query(
      "INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,'并发律师','测试律所')",
      [profileId, departmentId],
    );
    await client.query(
      'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
      [randomUUID(), lawyerId, departmentId, profileId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  await client.query(
    "INSERT INTO auth_sessions(id,token_digest,csrf_digest,user_id,department_id,authorization_revision,expires_at) VALUES ($1,$2,$3,$4,$5,1,now()+interval '1 day')",
    [sessionId, 'a'.repeat(64), 'b'.repeat(64), lawyerId, departmentId],
  );
  const schemaUrl = new URL(baseUrl);
  schemaUrl.searchParams.set('schema', schema);
  const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
  const { PrismaPg } = requireBackend('@prisma/adapter-pg');
  const { LawyerAccountService } = requireBackend(
    './dist/modules/cases/lawyer-account.service.js',
  );
  const database = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: schemaUrl.href,
        options: `-c search_path=${schema}`,
        max: 5,
      },
      { schema },
    ),
  });
  const service = new LawyerAccountService(database, {
    authorizeDepartmentAction: async () => undefined,
  });
  try {
    const actor = { userId: actorId, departmentId, authorizationRevision: 1 };
    const outcomes = await Promise.allSettled([
      service.setStatus(actor, lawyerId, false, 1),
      service.setStatus(actor, lawyerId, false, 1),
    ]);
    if (
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length !==
        1 ||
      outcomes.filter(
        (outcome) =>
          outcome.status === 'rejected' &&
          outcome.reason?.status === 409 &&
          outcome.reason?.response?.code === 'VERSION_CONFLICT',
      ).length !== 1
    )
      throw new Error(
        `Same-version lawyer account race did not yield one success and one VERSION_CONFLICT: ${outcomes.map((outcome) => (outcome.status === 'rejected' ? (outcome.reason?.response?.code ?? outcome.reason?.message) : 'success')).join(',')}`,
      );
    const effects = await client.query(
      "SELECT u.active,u.authorization_revision,s.revoked_at,(SELECT COUNT(*)::int FROM audit_events a WHERE a.resource_id=u.id AND a.action='lawyer-account.status-changed') AS audits FROM user_accounts u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2",
      [lawyerId, sessionId],
    );
    const row = effects.rows[0];
    if (
      row?.active !== false ||
      row.authorization_revision !== 2 ||
      row.revoked_at === null ||
      row.audits !== 1
    )
      throw new Error(
        'Same-version lawyer account race left partial or duplicate effects',
      );
  } finally {
    await database.$disconnect();
  }
}

async function withSchema(label, run) {
  const schema = `case_lawyer_${randomBytes(8).toString('hex')}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  try {
    await run(schema);
    console.log(`${label}: passed`);
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

async function expectSqlError(sql, params, code) {
  try {
    await client.query(sql, params);
  } catch (error) {
    if (error.code === code) return;
    throw error;
  }
  throw new Error(`Expected SQLSTATE ${code}`);
}

async function verifySqlActorGuards() {
  const departmentId = randomUUID();
  const otherDepartmentId = randomUUID();
  const userId = randomUUID();
  const profileId = randomUUID();
  const bindingId = randomUUID();
  const roleId = randomUUID();
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now()),($3,$4,now())',
    [departmentId, '律师测试部门', otherDepartmentId, '外部门'],
  );
  await client.query(
    'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
    [roleId, departmentId, '内部模板'],
  );
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
    [userId, `lawyer-test-${userId}`, '同名律师'],
  );
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [profileId, departmentId, '同名律师', '测试律所'],
  );
  await client.query(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [bindingId, userId, departmentId, profileId],
  );
  await client.query('COMMIT');

  await expectSqlError(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [randomUUID(), userId, departmentId],
    '23514',
  );
  await expectSqlError(
    'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), userId, departmentId, roleId],
    '23514',
  );
  const foreignProfileId = randomUUID();
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [foreignProfileId, otherDepartmentId, '同名律师', '外部门律所'],
  );
  await expectSqlError(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), userId, otherDepartmentId, foreignProfileId],
    '23514',
  );
  await expectSqlError(
    'INSERT INTO audit_events(id,department_id,actor_user_id,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      randomUUID(),
      departmentId,
      userId,
      bindingId,
      'customer',
      randomUUID(),
      'lawyer-account.password-reset',
    ],
    '23514',
  );
  await expectSqlError(
    'INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      randomUUID(),
      departmentId,
      userId,
      'CASE',
      randomUUID(),
      'case.complaint.submitted',
    ],
    '23503',
  );
  await expectSqlError(
    'INSERT INTO upload_drafts(id,department_id,actor_user_id,lawyer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())',
    [
      randomUUID(),
      departmentId,
      userId,
      bindingId,
      'NOTARY_MATTER',
      randomUUID(),
      'MAIL_RECEIPT',
      'MAIL_RECEIPT',
      'forged.pdf',
      'application/pdf',
    ],
    '23514',
  );

  const sameNameUser = randomUUID();
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
    [sameNameUser, `lawyer-test-${sameNameUser}`, '同名律师'],
  );
  const sameNameProfile = randomUUID();
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [sameNameProfile, departmentId, '同名律师', '测试律所'],
  );
  await client.query(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), sameNameUser, departmentId, sameNameProfile],
  );
  await client.query('COMMIT');
  const count = await client.query(
    "SELECT COUNT(*)::int AS count FROM user_accounts WHERE display_name = '同名律师' AND account_type = 'LAWYER'",
  );
  if (count.rows[0].count !== 2)
    throw new Error('Same-name accounts were merged');

  // An active PRIMARY profile must not move from A to B through a raw
  // DELETE/INSERT while A retains a second binding for cardinality.
  const spareProfile = randomUUID();
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name) VALUES ($1,$2,$3)',
    [spareProfile, departmentId, '备用档案'],
  );
  await client.query(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), userId, departmentId, spareProfile],
  );
  const caseId = randomUUID();
  await client.query('SET session_replication_role = replica');
  try {
    await client.query(
      "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_COMPLAINT',2,now())",
      [
        caseId,
        `LAWYER-ANCHOR-${caseId}`,
        departmentId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        userId,
      ],
    );
  } finally {
    await client.query('SET session_replication_role = origin');
  }
  const assignmentId = randomUUID();
  await client.query(
    "INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,'PRIMARY',now())",
    [assignmentId, caseId, departmentId, profileId],
  );
  await client.query('BEGIN');
  let transferRejected = false;
  try {
    await client.query('DELETE FROM lawyer_account_bindings WHERE id=$1', [
      bindingId,
    ]);
    await client.query(
      'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
      [randomUUID(), sameNameUser, departmentId, profileId],
    );
  } catch (error) {
    transferRejected = error.code === '23514';
    if (!transferRejected) throw error;
  } finally {
    await client.query('ROLLBACK');
  }
  if (!transferRejected)
    throw new Error(
      'A current PRIMARY profile was transferred to another account',
    );

  async function verifyRevokedDraftCleanup(revoke) {
    const expiredId = randomUUID();
    const orphanId = randomUUID();
    const storageKey = `lawyer-orphan-${orphanId}`;
    await client.query(
      "INSERT INTO upload_drafts(id,department_id,actor_user_id,lawyer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at) VALUES ($1,$2,$3,$4,'CASE',$5,'COMPLAINT','COMPLAINT','old.pdf','application/pdf',now() - interval '1 hour',now())",
      [expiredId, departmentId, userId, bindingId, caseId],
    );
    await client.query(
      "INSERT INTO upload_drafts(id,department_id,actor_user_id,lawyer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,pending_storage_key,expires_at,updated_at) VALUES ($1,$2,$3,$4,'CASE',$5,'COMPLAINT','COMPLAINT','old.pdf','application/pdf',$6,now() + interval '1 hour',now())",
      [orphanId, departmentId, userId, bindingId, caseId, storageKey],
    );
    await revoke();
    await client.query(
      "UPDATE upload_drafts SET status='EXPIRED',updated_at=now() WHERE id=$1",
      [expiredId],
    );
    await client.query(
      'UPDATE upload_drafts SET pending_storage_key=NULL,updated_at=now() WHERE id=$1',
      [orphanId],
    );
    const cleaned = await client.query(
      'SELECT id,status,pending_storage_key FROM upload_drafts WHERE id=ANY($1::uuid[]) ORDER BY id',
      [[expiredId, orphanId]],
    );
    if (
      cleaned.rows.length !== 2 ||
      cleaned.rows.find((row) => row.id === expiredId)?.status !== 'EXPIRED' ||
      cleaned.rows.find((row) => row.id === orphanId)?.pending_storage_key !==
        null
    )
      throw new Error('Revoked draft cleanup did not persist');
    await expectSqlError(
      "UPDATE upload_drafts SET status='FINALIZED',updated_at=now() WHERE id=$1",
      [orphanId],
      '23514',
    );
    await expectSqlError(
      "UPDATE upload_drafts SET original_filename='new.pdf',updated_at=now() WHERE id=$1",
      [orphanId],
      '23514',
    );
    await expectSqlError(
      "INSERT INTO upload_drafts(id,department_id,actor_user_id,lawyer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at) VALUES ($1,$2,$3,$4,'CASE',$5,'COMPLAINT','COMPLAINT','new.pdf','application/pdf',now() + interval '1 hour',now())",
      [randomUUID(), departmentId, userId, bindingId, caseId],
      '23514',
    );
  }
  await verifyRevokedDraftCleanup(() =>
    client.query('UPDATE user_accounts SET active=false WHERE id=$1', [userId]),
  );
  await client.query('UPDATE user_accounts SET active=true WHERE id=$1', [
    userId,
  ]);
  await verifyRevokedDraftCleanup(() =>
    client.query(
      'UPDATE lawyer_account_bindings SET active=false,updated_at=now() WHERE id=$1',
      [bindingId],
    ),
  );
  await client.query(
    'UPDATE lawyer_account_bindings SET active=true,updated_at=now() WHERE id=$1',
    [bindingId],
  );
  await verifyRevokedDraftCleanup(() =>
    client.query(
      'UPDATE case_lawyer_assignments SET ended_at=now() WHERE id=$1',
      [assignmentId],
    ),
  );
}

function temporaryConfig(names, suffix, corruptIndex = -1) {
  const root = join(temporaryRoot, suffix);
  const migrations = join(root, 'migrations');
  mkdirSync(migrations, { recursive: true });
  for (const name of names)
    cpSync(join(migrationsPath, name), join(migrations, name), {
      recursive: true,
    });
  if (corruptIndex >= 0) {
    const targetSql = join(
      migrations,
      migrationNames[corruptIndex],
      'migration.sql',
    );
    writeFileSync(
      targetSql,
      'BEGIN;\nCREATE TABLE "lawyer_migration_rollback_probe" ("id" int);\nSELECT 1 / 0;\nCOMMIT;\n',
    );
  }
  const config = join(root, 'prisma.config.ts');
  writeFileSync(
    config,
    `export default { schema: ${JSON.stringify(schemaFile)}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL ?? '' } };\n`,
  );
  return config;
}

try {
  await withSchema('empty database with 72 migrations', async (schema) => {
    runPrisma(schema, null, ['migrate', 'deploy'], true);
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    if (result.rows[0].count !== 72)
      throw new Error('Empty migration count mismatch');
    await verifySqlActorGuards();
    buildCurrentService();
    await verifySerializableCompetition(schema);
  });

  const previousConfig = temporaryConfig(
    migrationNames.slice(0, 67),
    'previous67',
  );
  await withSchema('previous 67 to lawyer migrations', async (schema) => {
    runPrisma(schema, previousConfig, ['migrate', 'deploy'], true);
    const before = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    if (before.rows[0].count !== 67)
      throw new Error('Previous migration count mismatch');
    const legacy = await seedLegacyMatch();
    runPrisma(schema, null, ['migrate', 'deploy'], true);
    const after = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    if (after.rows[0].count !== 72)
      throw new Error('Upgrade migration count mismatch');
    if ((await readLegacyFacts(legacy)) !== legacy.facts)
      throw new Error(
        'Legacy case, pure-name lawyer, assignment, receipt or audit changed during upgrade',
      );
    const oldProfile = await client.query(
      'SELECT bound_user_id FROM lawyer_profiles WHERE id=$1',
      [legacy.profileId],
    );
    if (oldProfile.rows[0]?.bound_user_id !== null)
      throw new Error(
        'Historical pure-name profile acquired an account identity',
      );
    const newAccountId = randomUUID();
    const newProfileId = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query(
        "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,'旧律师','LAWYER',now())",
        [newAccountId, `new-lawyer-${newAccountId}`],
      );
      await client.query(
        'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
        [newProfileId, legacy.departmentId, '旧律师', '旧律所'],
      );
      await client.query(
        'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
        [randomUUID(), newAccountId, legacy.departmentId, newProfileId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const identities = await client.query(
      'SELECT id,bound_user_id FROM lawyer_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',
      [[legacy.profileId, newProfileId]],
    );
    if (
      identities.rows.find((row) => row.id === legacy.profileId)
        ?.bound_user_id !== null ||
      identities.rows.find((row) => row.id === newProfileId)?.bound_user_id !==
        newAccountId
    )
      throw new Error(
        'New same-name account absorbed the historical lawyer profile',
      );
    await replayLegacyMatch(schema, legacy);
    if ((await readLegacyFacts(legacy)) !== legacy.facts)
      throw new Error('Legacy replay wrote new case, receipt or audit effects');
  });

  const previous71Config = temporaryConfig(
    migrationNames.slice(0, 71),
    'previous71',
  );
  await withSchema(
    'previous 71 binding account anchor backfill',
    async (schema) => {
      runPrisma(schema, previous71Config, ['migrate', 'deploy'], true);
      const departmentId = randomUUID();
      const userId = randomUUID();
      const profileId = randomUUID();
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
        [departmentId, '锚回填部门'],
      );
      await client.query('BEGIN');
      try {
        await client.query(
          "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,'已有律师','LAWYER',now())",
          [userId, `existing-lawyer-${userId}`],
        );
        await client.query(
          "INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,'已有律师','原律所')",
          [profileId, departmentId],
        );
        await client.query(
          'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
          [randomUUID(), userId, departmentId, profileId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      runPrisma(schema, null, ['migrate', 'deploy'], true);
      const anchor = await client.query(
        'SELECT bound_user_id FROM lawyer_profiles WHERE id=$1',
        [profileId],
      );
      if (anchor.rows[0]?.bound_user_id !== userId)
        throw new Error(
          'Existing binding did not backfill its immutable account anchor',
        );
    },
  );

  for (const targetIndex of [67, 68, 69, 70, 71]) {
    const failedConfig = temporaryConfig(
      migrationNames,
      `failed-${targetIndex}`,
      targetIndex,
    );
    await withSchema(
      `migration ${targetIndex + 1} failure atomicity and forward retry`,
      async (schema) => {
        runPrisma(schema, failedConfig, ['migrate', 'deploy'], false);
        const probe = await client.query('SELECT to_regclass($1) AS found', [
          `${schema}.lawyer_migration_rollback_probe`,
        ]);
        if (probe.rows[0].found !== null)
          throw new Error('Failed migration left a table behind');
        const failed = await client.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL`,
          [migrationNames[targetIndex]],
        );
        if (failed.rows[0].count !== 1)
          throw new Error('Failed migration was not recorded');
        runPrisma(
          schema,
          null,
          ['migrate', 'resolve', '--rolled-back', migrationNames[targetIndex]],
          true,
        );
        runPrisma(schema, null, ['migrate', 'deploy'], true);
        const completed = await client.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
          [migrationNames[targetIndex]],
        );
        if (completed.rows[0].count !== 1)
          throw new Error('Forward retry did not complete');
      },
    );
  }
} finally {
  await client.end();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
