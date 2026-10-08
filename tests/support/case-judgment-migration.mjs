import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

function runPrisma(schema, config, args, expectSuccess) {
  const schemaUrl = new URL(databaseUrl);
  schemaUrl.searchParams.set('schema', schema);
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'backend/node_modules/prisma/build/index.js'),
      ...args,
      ...(config ? ['--config', config] : []),
    ],
    {
      cwd: resolve(root, 'backend'),
      env: { ...process.env, DATABASE_URL: schemaUrl.href },
      encoding: 'utf8',
    },
  );
  const rawOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const output = schemaUrl.password
    ? rawOutput.replaceAll(schemaUrl.password, '[REDACTED]')
    : rawOutput;
  if (result.error || (result.status === 0) !== expectSuccess) {
    throw new Error(
      `Prisma ${args.join(' ')} status ${result.error?.message ?? result.status}: ${output}`,
    );
  }
  return output;
}

function temporaryConfig(migrations, names, target, phase, temporaryRoot) {
  const directory = join(temporaryRoot, `${target}-${phase}`);
  const copied = join(directory, 'migrations');
  mkdirSync(copied, { recursive: true });
  for (const name of names)
    cpSync(resolve(migrations, name), join(copied, name), { recursive: true });
  const sql = join(copied, target, 'migration.sql');
  const original = readFileSync(sql, 'utf8');
  const nextStatement = {
    'before-second-enum':
      'ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS \'case.judgment.correct\';',
    'before-third-enum':
      'ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS \'JUDGMENT\';',
    'before-type': 'CREATE TYPE "case_judgment_kind"',
    'before-second-index':
      'CREATE UNIQUE INDEX "case_judgment_facts_prior_fact_id_case_id_department_id_key"',
    'before-function': '-- PL/pgSQL',
    'before-check':
      'ALTER TABLE "material_references" ADD CONSTRAINT "material_references_judgment_event_check"',
    'before-partial-index':
      'CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"',
    'before-event-index':
      'CREATE UNIQUE INDEX "material_references_resource_purpose_version_event_key"',
    'after-last': null,
  }[phase];
  if (
    nextStatement === undefined ||
    (nextStatement !== null && !original.includes(nextStatement))
  )
    throw new Error('Migration injection point changed');
  const fault =
    'CREATE TABLE "ca008_migration_rollback_probe" ("id" integer);\nSELECT 1 / 0;\n';
  writeFileSync(
    sql,
    nextStatement === null
      ? `${original}\n${fault}`
      : original.replace(nextStatement, `${fault}${nextStatement}`),
  );
  const config = join(directory, 'prisma.config.ts');
  writeFileSync(
    config,
    `export default { schema: ${JSON.stringify(resolve(root, 'backend/prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(copied)} }, datasource: { url: process.env.DATABASE_URL ?? '' } };\n`,
  );
  return config;
}

export async function verifyCaseJudgmentMigration() {
  const migrations = resolve(root, 'backend/prisma/migrations');
  const target = [
    '20261008020000_add_case_judgment_enums',
    '20261008021000_add_case_judgment_facts',
    '20261008022000_add_case_judgment_grants',
    '20261008023000_allow_lawyer_judgment_actor_path',
    '20261008024000_align_case_judgment_constraints',
    '20261008025000_allow_judgment_version_reuse',
    '20261008026000_repair_case_judgment_deployment',
    '20261008027000_guard_case_judgment_references',
    '20261008028000_guard_case_judgment_reference_inserts',
  ];
  const previous = (await readdir(migrations))
    .filter((name) => /^\d{14}_/u.test(name) && name < target[0])
    .sort();
  if (
    previous.length !== 82 ||
    previous.at(-1) !== '20261008015000_require_latest_case_hearing_chain'
  )
    throw new Error('Unexpected previous schema');
  const suffix = randomUUID().replaceAll('-', '');
  const recoveryCases = [
    { targetName: target[0], phase: 'before-second-enum' },
    { targetName: target[0], phase: 'before-third-enum' },
    { targetName: target[0], phase: 'before-type' },
    { targetName: target[0], phase: 'after-last' },
    { targetName: target[4], phase: 'before-second-index' },
    { targetName: target[4], phase: 'before-function' },
    { targetName: target[4], phase: 'after-last' },
    { targetName: target[5], phase: 'before-check' },
    { targetName: target[5], phase: 'before-partial-index' },
    { targetName: target[5], phase: 'before-event-index' },
    { targetName: target[5], phase: 'after-last' },
  ];
  const schemas = {
    empty: `ca008_empty_${suffix}`,
    upgrade: `ca008_upgrade_${suffix}`,
    failure: `ca008_failure_${suffix}`,
    badIndex: `ca008_badindex_${suffix}`,
    badFunction: `ca008_badfunction_${suffix}`,
    badTrigger: `ca008_badtrigger_${suffix}`,
    guardFailure: `ca008_guardfailure_${suffix}`,
    insertFailure: `ca008_insertfailure_${suffix}`,
    badData: `ca008_baddata_${suffix}`,
  };
  for (const [index, recovery] of recoveryCases.entries()) {
    recovery.schema = `ca008_r${index}_${suffix}`;
    schemas[`recovery${index}`] = recovery.schema;
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'dev-cor-ca008-migration-'));
  const client = new Client({ connectionString: databaseUrl });
  const use = (name) => client.query(`SET search_path TO "${name}"`);
  const apply = async (names) => {
    for (const name of names)
      await client.query(
        await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'),
      );
  };
  const count = async (sql, params = []) =>
    Number((await client.query(sql, params)).rows[0].n);
  const assertJudgmentVersionTrigger = async (schema) => {
    const valid = await count(
      `SELECT COUNT(*) AS n FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid
        JOIN pg_namespace pn ON pn.oid=p.pronamespace
        WHERE n.nspname=$1 AND pn.nspname=$1
          AND c.relname='case_judgment_versions'
          AND t.tgname='case_judgment_versions_guard'
          AND p.proname='check_case_judgment_version' AND p.pronargs=0
          AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal
          AND t.tgparentid=0 AND t.tgqual IS NULL AND t.tgnargs=0
          AND t.tgargs=''::bytea AND t.tgattr::text=''
          AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred`,
      [schema],
    );
    if (valid !== 1)
      throw new Error(
        'Judgment version trigger definition mismatch before resolve',
      );
  };
  await client.connect();
  try {
    if (
      (await client.query('SELECT current_database() AS name')).rows[0].name !==
      'dev_cor_test'
    )
      throw new Error('Unexpected database');
    for (const schema of Object.values(schemas))
      await client.query(`CREATE SCHEMA "${schema}"`);
    await use(schemas.empty);
    await apply([...previous, ...target]);
    const emptyFacts = await count(
      'SELECT COUNT(*) AS n FROM case_judgment_facts',
    );
    const emptyReceipts = await count(
      'SELECT COUNT(*) AS n FROM case_judgment_receipts',
    );

    await use(schemas.upgrade);
    await apply(previous);
    const departmentId = randomUUID(),
      actorId = randomUUID(),
      caseId = randomUUID();
    const hearingId = randomUUID(),
      advanceId = randomUUID(),
      roleId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, 'CA008 isolated'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actorId, `ca008-${actorId}`, 'CA008 actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), actorId, departmentId],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, departmentId, 'judgment migration'],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.acceptance.register','SELF'),($3,$2,'case.hearing.correct','DEPARTMENT')",
      [randomUUID(), roleId, randomUUID()],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), actorId, departmentId, roleId],
    );
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_hearing_arrangement_id,current_hearing_advance_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',9,now(),'KNOWN',0,now(),$9,'CA008-old',$10,$11)",
        [
          caseId,
          `CA008-${suffix}`,
          departmentId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          actorId,
          hearingId,
          advanceId,
        ],
      );
      await client.query(
        "INSERT INTO case_hearing_arrangements(id,department_id,case_id,hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,'2026-10-02','SCHEDULE',$4,7,8,$5)",
        [hearingId, departmentId, caseId, actorId, randomUUID()],
      );
      await client.query(
        "INSERT INTO case_hearing_advances(id,department_id,case_id,arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-02T16:00:00Z','2026-10-02T16:00:01Z',8,9,$5)",
        [advanceId, departmentId, caseId, hearingId, randomUUID()],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    await apply(target);
    const oldHearing = await count(
      'SELECT COUNT(*) AS n FROM case_hearing_advances WHERE id=$1',
      [advanceId],
    );
    const oldCaseStage = (
      await client.query(
        'SELECT stage,version,current_judgment_id FROM cases WHERE id=$1',
        [caseId],
      )
    ).rows[0];
    const registerGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.judgment.register' AND scope='SELF'",
      [roleId],
    );
    const correctGrant = await count(
      "SELECT COUNT(*) AS n FROM role_grants WHERE role_template_id=$1 AND action='case.judgment.correct' AND scope='DEPARTMENT'",
      [roleId],
    );

    await use(schemas.failure);
    await apply([...previous, target[0]]);
    await client.query('CREATE TABLE case_judgment_facts(id UUID)');
    let failedCode = null;
    try {
      await apply([target[1]]);
    } catch (error) {
      failedCode = error.code ?? null;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const noPartialColumn = await count(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='cases' AND column_name='current_judgment_id'",
      [schemas.failure],
    );
    await client.query('DROP TABLE case_judgment_facts');
    await apply(target.slice(1));
    const retryTable = await count(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_judgment_facts'",
      [schemas.failure],
    );
    const prismaRecoveryCases = [];
    const repairSql = resolve(
      migrations,
      '20261008026000_repair_case_judgment_deployment/migration.sql',
    );
    if (!existsSync(repairSql))
      throw new Error('Forward repair migration is missing');
    const regclass = async (schema, objectName) =>
      (
        await client.query('SELECT to_regclass($1) AS name', [
          `${schema}.${objectName}`,
        ])
      ).rows[0].name;
    const constraintCount = (schema, name) =>
      count(
        'SELECT COUNT(*) AS n FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname=$2',
        [schema, name],
      );
    for (const { schema, targetName, phase } of recoveryCases) {
      const config = temporaryConfig(
        migrations,
        [...previous, ...target],
        targetName,
        phase,
        temporaryRoot,
      );
      const failureOutput = runPrisma(
        schema,
        config,
        ['migrate', 'deploy'],
        false,
      );
      if (!failureOutput.includes('division by zero'))
        throw new Error('Expected a runtime migration failure');
      const probe = await regclass(schema, 'ca008_migration_rollback_probe');
      const failed = await count(
        `SELECT COUNT(*) AS n FROM "${schema}"."_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NULL`,
        [targetName],
      );
      if (probe === null || failed !== 1)
        throw new Error(
          `Prisma migration ${targetName} did not preserve the proven partial-DDL failure (probe=${probe === null ? 'absent' : 'present'}, failed=${failed})`,
        );
      if (targetName === target[0]) {
        const enumRows = (
          await client.query(
            `SELECT t.typname,e.enumlabel FROM pg_type t
          JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
          WHERE n.nspname=$1 AND ((t.typname='permission_action' AND e.enumlabel IN
            ('case.judgment.register','case.judgment.correct')) OR
            (t.typname='material_category' AND e.enumlabel='JUDGMENT'))`,
            [schema],
          )
        ).rows;
        const enumLabels = enumRows
          .map((row) => `${row.typname}:${row.enumlabel}`)
          .sort();
        const expectedLabels = [
          'permission_action:case.judgment.register',
          ...(phase === 'before-second-enum'
            ? []
            : ['permission_action:case.judgment.correct']),
          ...(['before-second-enum', 'before-third-enum'].includes(phase)
            ? []
            : ['material_category:JUDGMENT']),
        ].sort();
        if (JSON.stringify(enumLabels) !== JSON.stringify(expectedLabels))
          throw new Error(`200 enum failure prefix mismatch: ${phase}`);
        const typeBefore = (
          await client.query('SELECT to_regtype($1) AS name', [
            `${schema}.case_judgment_kind`,
          ])
        ).rows[0].name;
        if ((phase === 'after-last') !== (typeBefore !== null))
          throw new Error('200 enum/type failure prefix mismatch');
        runPrisma(
          schema,
          null,
          [
            'migrate',
            'resolve',
            phase === 'after-last' ? '--applied' : '--rolled-back',
            targetName,
          ],
          true,
        );
        runPrisma(schema, null, ['migrate', 'deploy'], true);
      } else {
        if (targetName === target[4]) {
          const first = await regclass(
            schema,
            'cases_current_judgment_id_id_department_id_key',
          );
          const second = await regclass(
            schema,
            'case_judgment_facts_prior_fact_id_case_id_department_id_key',
          );
          const guard = (
            await client.query(
              `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=$1 AND p.proname='check_case_judgment_version'`,
              [schema],
            )
          ).rows[0]?.prosrc;
          if (
            first === null ||
            (second !== null) === (phase === 'before-second-index') ||
            guard?.includes('prior_version."material_id"') !==
              (phase === 'after-last')
          )
            throw new Error(`240 partial-DDL prefix mismatch: ${phase}`);
        } else {
          const old = await constraintCount(
            schema,
            'material_references_resource_purpose_version_key',
          );
          const check = await constraintCount(
            schema,
            'material_references_judgment_event_check',
          );
          const partial = await regclass(
            schema,
            'material_references_resource_purpose_version_key',
          );
          const event = await regclass(
            schema,
            'material_references_resource_purpose_version_event_key',
          );
          if (
            old !== 0 ||
            check !== Number(phase !== 'before-check') ||
            (partial !== null) !==
              ['before-event-index', 'after-last'].includes(phase) ||
            (event !== null) !== (phase === 'after-last')
          )
            throw new Error(`250 partial-DDL prefix mismatch: ${phase}`);
        }
        if (targetName === target[4] && phase === 'before-second-index') {
          const brokenRepair = join(
            temporaryRoot,
            'repair-fault-before-commit.sql',
          );
          writeFileSync(
            brokenRepair,
            readFileSync(repairSql, 'utf8').replace(
              /\nCOMMIT;\s*$/u,
              '\nCREATE TABLE "ca008_repair_rollback_probe" (id integer);\nSELECT 1 / 0;\nCOMMIT;\n',
            ),
          );
          const brokenOutput = runPrisma(
            schema,
            null,
            ['db', 'execute', '--file', brokenRepair],
            false,
          );
          if (
            !brokenOutput.includes('division by zero') ||
            (await regclass(schema, 'ca008_repair_rollback_probe')) !== null ||
            (await regclass(
              schema,
              'case_judgment_facts_prior_fact_id_case_id_department_id_key',
            )) !== null
          )
            throw new Error(
              '260 repair transaction left partial DDL after injected failure',
            );
        }
        runPrisma(schema, null, ['db', 'execute', '--file', repairSql], true);
        runPrisma(schema, null, ['db', 'execute', '--file', repairSql], true);
        const indexes = [
          'cases_current_judgment_id_id_department_id_key',
          'case_judgment_facts_prior_fact_id_case_id_department_id_key',
          'material_references_resource_purpose_version_key',
          'material_references_resource_purpose_version_event_key',
        ];
        for (const name of indexes)
          if ((await regclass(schema, name)) === null)
            throw new Error(`Forward repair did not restore ${name}`);
        if (
          (await constraintCount(
            schema,
            'material_references_resource_purpose_version_key',
          )) !== 0 ||
          (await constraintCount(
            schema,
            'material_references_judgment_event_check',
          )) !== 1
        )
          throw new Error(
            'Forward repair did not restore 250 material constraints',
          );
        const functionBody = (
          await client.query(
            `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='check_case_judgment_version'`,
            [schema],
          )
        ).rows[0]?.prosrc;
        if (!functionBody?.includes('prior_version."material_id"'))
          throw new Error(
            'Forward repair did not restore 240 judgment version guard',
          );
        await assertJudgmentVersionTrigger(schema);
        runPrisma(
          schema,
          null,
          ['migrate', 'resolve', '--applied', targetName],
          true,
        );
        if (targetName === target[4])
          runPrisma(
            schema,
            null,
            ['migrate', 'resolve', '--applied', target[5]],
            true,
          );
        runPrisma(schema, null, ['migrate', 'deploy'], true);
      }
      const completed = await count(
        `SELECT COUNT(*) AS n FROM "${schema}"."_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL`,
        [targetName],
      );
      if (completed !== 1)
        throw new Error(`Prisma migration ${targetName} did not forward-retry`);
      if (
        (await count(
          `SELECT COUNT(*) AS n FROM "${schema}"."_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL`,
          [target[6]],
        )) !== 1
      )
        throw new Error('260 was not deployed after forward recovery');
      prismaRecoveryCases.push(`${targetName}:${phase}`);
    }
    const baselineObjects = async (schema) =>
      (
        await client.query(
          `
      SELECT
        (SELECT p.xmin::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=$1 AND p.proname='check_case_judgment_version') AS function_version,
        (SELECT c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname='material_references_resource_purpose_version_key') AS partial_index_id,
        (SELECT c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname='material_references_resource_purpose_version_event_key') AS event_index_id,
        (SELECT p.xmin::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=$1 AND p.proname='check_case_judgment_reference_immutable') AS reference_function_version,
        (SELECT t.oid::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
          AND c.relname='material_references' AND t.tgname='material_references_judgment_immutable_guard') AS reference_trigger_id,
        (SELECT p.xmin::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=$1 AND p.proname='check_case_judgment_reference_insert') AS insert_function_version,
        (SELECT t.oid::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
          AND c.relname='material_references' AND t.tgname='material_references_judgment_insert_guard') AS insert_trigger_id
    `,
          [schema],
        )
      ).rows[0];
    const beforeNormal = await baselineObjects(schemas.upgrade);
    const beforeCase = (
      await client.query(
        `SELECT xmin::text AS row_version,version,current_judgment_id
      FROM "${schemas.upgrade}".cases WHERE id=$1`,
        [caseId],
      )
    ).rows[0];
    runPrisma(
      schemas.upgrade,
      null,
      ['db', 'execute', '--file', repairSql],
      true,
    );
    const guardSql = resolve(
      migrations,
      '20261008027000_guard_case_judgment_references/migration.sql',
    );
    runPrisma(
      schemas.upgrade,
      null,
      ['db', 'execute', '--file', guardSql],
      true,
    );
    const insertSql = resolve(
      migrations,
      '20261008028000_guard_case_judgment_reference_inserts/migration.sql',
    );
    runPrisma(
      schemas.upgrade,
      null,
      ['db', 'execute', '--file', insertSql],
      true,
    );
    runPrisma(
      schemas.upgrade,
      null,
      ['db', 'execute', '--file', insertSql],
      true,
    );
    runPrisma(
      schemas.upgrade,
      null,
      ['db', 'execute', '--file', guardSql],
      true,
    );
    runPrisma(
      schemas.upgrade,
      null,
      ['db', 'execute', '--file', repairSql],
      true,
    );
    const normalNoRewrite =
      JSON.stringify(beforeNormal) ===
        JSON.stringify(await baselineObjects(schemas.upgrade)) &&
      JSON.stringify(beforeCase) ===
        JSON.stringify(
          (
            await client.query(
              `SELECT xmin::text AS row_version,version,current_judgment_id
        FROM "${schemas.upgrade}".cases WHERE id=$1`,
              [caseId],
            )
          ).rows[0],
        );
    if (!normalNoRewrite)
      throw new Error(
        'Completed 260 changed existing schema objects or case data',
      );

    await use(schemas.badIndex);
    await apply([...previous, ...target]);
    await client.query(
      'DROP INDEX "case_judgment_facts_prior_fact_id_case_id_department_id_key"',
    );
    await client.query(
      'CREATE UNIQUE INDEX "case_judgment_facts_prior_fact_id_case_id_department_id_key" ON case_judgment_facts(prior_fact_id)',
    );
    const badIndexOutput = runPrisma(
      schemas.badIndex,
      null,
      ['db', 'execute', '--file', repairSql],
      false,
    );
    if (!badIndexOutput.includes('unknown or invalid judgment migration index'))
      throw new Error('260 did not fail closed on an incompatible named index');

    await use(schemas.badFunction);
    await apply([...previous, ...target]);
    await client.query(
      'CREATE OR REPLACE FUNCTION check_case_judgment_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$',
    );
    const badFunctionOutput = runPrisma(
      schemas.badFunction,
      null,
      ['db', 'execute', '--file', repairSql],
      false,
    );
    if (
      !badFunctionOutput.includes('unknown judgment version guard definition')
    )
      throw new Error(
        '260 did not fail closed on an incompatible guard function',
      );

    await use(schemas.badTrigger);
    await apply([...previous, ...target]);
    await client.query(
      'DROP TRIGGER case_judgment_versions_guard ON case_judgment_versions',
    );
    await client.query(
      'CREATE TRIGGER case_judgment_versions_guard AFTER UPDATE ON case_judgment_versions FOR EACH ROW EXECUTE FUNCTION check_case_judgment_version()',
    );
    runPrisma(
      schemas.badTrigger,
      null,
      ['db', 'execute', '--file', repairSql],
      true,
    );
    let badTriggerPreResolveRejected = false;
    try {
      await assertJudgmentVersionTrigger(schemas.badTrigger);
    } catch (error) {
      if (!String(error.message).includes('definition mismatch before resolve'))
        throw error;
      badTriggerPreResolveRejected = true;
    }
    const badTriggerOutput = runPrisma(
      schemas.badTrigger,
      null,
      ['db', 'execute', '--file', guardSql],
      false,
    );
    const badTriggerRejected = badTriggerOutput.includes(
      'unknown judgment version trigger definition',
    );

    await use(schemas.guardFailure);
    await apply([...previous, ...target.slice(0, 7)]);
    const brokenGuard = join(temporaryRoot, 'guard-fault-before-commit.sql');
    writeFileSync(
      brokenGuard,
      readFileSync(guardSql, 'utf8').replace(
        /\nCOMMIT;\s*$/u,
        '\nCREATE TABLE "ca008_guard_rollback_probe" (id integer);\nSELECT 1 / 0;\nCOMMIT;\n',
      ),
    );
    const guardFailureOutput = runPrisma(
      schemas.guardFailure,
      null,
      ['db', 'execute', '--file', brokenGuard],
      false,
    );
    const guardTransactionAtomic =
      guardFailureOutput.includes('division by zero') &&
      (await regclass(schemas.guardFailure, 'ca008_guard_rollback_probe')) ===
        null &&
      (await count(
        `SELECT COUNT(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=$1 AND p.proname='check_case_judgment_reference_immutable'`,
        [schemas.guardFailure],
      )) === 0 &&
      (await count(
        `SELECT COUNT(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
          AND c.relname='material_references' AND t.tgname='material_references_judgment_immutable_guard'`,
        [schemas.guardFailure],
      )) === 0;
    if (!guardTransactionAtomic)
      throw new Error('270 left partial DDL after injected failure');
    runPrisma(
      schemas.guardFailure,
      null,
      ['db', 'execute', '--file', guardSql],
      true,
    );
    runPrisma(
      schemas.guardFailure,
      null,
      ['db', 'execute', '--file', guardSql],
      true,
    );

    await use(schemas.insertFailure);
    await apply([...previous, ...target.slice(0, 8)]);
    const brokenInsert = join(temporaryRoot, 'insert-fault-before-commit.sql');
    writeFileSync(
      brokenInsert,
      readFileSync(insertSql, 'utf8').replace(
        /\nCOMMIT;\s*$/u,
        '\nCREATE TABLE "ca008_insert_rollback_probe" (id integer);\nSELECT 1 / 0;\nCOMMIT;\n',
      ),
    );
    const insertFailureOutput = runPrisma(
      schemas.insertFailure,
      null,
      ['db', 'execute', '--file', brokenInsert],
      false,
    );
    const insertTransactionAtomic =
      insertFailureOutput.includes('division by zero') &&
      (await regclass(schemas.insertFailure, 'ca008_insert_rollback_probe')) ===
        null &&
      (await count(
        `SELECT COUNT(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=$1 AND p.proname='check_case_judgment_reference_insert'`,
        [schemas.insertFailure],
      )) === 0 &&
      (await count(
        `SELECT COUNT(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
          AND c.relname='material_references' AND t.tgname='material_references_judgment_insert_guard'`,
        [schemas.insertFailure],
      )) === 0;
    if (!insertTransactionAtomic)
      throw new Error('280 left partial DDL after injected failure');
    runPrisma(
      schemas.insertFailure,
      null,
      ['db', 'execute', '--file', insertSql],
      true,
    );
    runPrisma(
      schemas.insertFailure,
      null,
      ['db', 'execute', '--file', insertSql],
      true,
    );

    await use(schemas.badData);
    await apply([...previous, ...target.slice(0, 5)]);
    await client.query(
      'ALTER TABLE material_references DROP CONSTRAINT material_references_resource_purpose_version_key',
    );
    const duplicate = [
      departmentId,
      'case',
      caseId,
      'ACCEPTANCE_NOTICE',
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await client.query('SET session_replication_role = replica');
    try {
      for (let index = 0; index < 2; index++)
        await client.query(
          'INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [randomUUID(), ...duplicate],
        );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    const badDataOutput = runPrisma(
      schemas.badData,
      null,
      ['db', 'execute', '--file', repairSql],
      false,
    );
    const duplicatePreserved = await count(
      `SELECT COUNT(*) AS n FROM "${schemas.badData}".material_references WHERE resource_id=$1`,
      [caseId],
    );
    if (
      !badDataOutput.includes(
        'material reference data violates target uniqueness',
      ) ||
      duplicatePreserved !== 2
    )
      throw new Error(
        '260 did not fail closed without rewriting duplicate material rows',
      );
    return {
      previous: previous.length,
      total: previous.length + target.length,
      emptyFacts,
      emptyReceipts,
      oldHearing,
      oldCaseStage: oldCaseStage.stage,
      oldCaseVersion: oldCaseStage.version,
      oldJudgmentNull: oldCaseStage.current_judgment_id === null,
      registerGrant,
      correctGrant,
      failedCode,
      noPartialColumn,
      retryTable,
      prismaRecoveryCases,
      normalNoRewrite,
      badIndexRejected: true,
      badFunctionRejected: true,
      badTriggerRejected,
      badTriggerPreResolveRejected,
      guardTransactionAtomic,
      insertTransactionAtomic,
      duplicatePreserved,
    };
  } finally {
    await client
      .query('SET session_replication_role = origin')
      .catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of Object.values(schemas))
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end();
    if (
      resolve(temporaryRoot).startsWith(`${resolve(tmpdir())}${sep}`) &&
      basename(temporaryRoot).startsWith('dev-cor-ca008-migration-')
    )
      rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
