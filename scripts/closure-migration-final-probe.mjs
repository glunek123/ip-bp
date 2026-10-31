import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { migrationManifest } from './closure-acceptance-preflight.mjs';
import { acquireE2eResourceLock } from './run-e2e.mjs';
import {
  seedSynthetic196ExternalCase,
  snapshotSynthetic196ExternalCase,
} from './closure-synthetic-196-fixture.mjs';

export const target = Object.freeze({
  project: 'dev-cor-closure-final-20261030',
  host: '127.0.0.1',
  port: 15443,
  database: 'dev_cor_test',
  username: 'dev_cor_test',
  image:
    'postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0',
});
const repoDigest = `postgres@${target.image.split('@')[1]}`;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const stableJson = (value) =>
  JSON.stringify(value, function (_key, item) {
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    return item;
  });
const fail = () => {
  throw new Error('Closed migration probe rejected');
};
const uuid = (value) =>
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value ?? '');
const fullId = (value) => /^[a-f0-9]{64}$/u.test(value ?? '');
const q = (value) => {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) fail();
  return `"${value}"`;
};

// Docker Desktop exposes a drive bind under this single host-mount prefix.
// Do not decode, normalize, ignore case or accept alternate Linux aliases.
export function dockerDesktopSecretSource(secretPath) {
  if (typeof secretPath !== 'string') fail();
  const match = /^([A-Za-z]):\\(.+)$/u.exec(secretPath);
  if (!match) fail();
  const segments = match[2].split('\\');
  if (
    segments.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[<>:"/|?*]/u.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/u.test(part),
    )
  )
    fail();
  return `/run/desktop/mnt/host/${match[1].toLowerCase()}/${segments.join('/')}`;
}

// Original historical migration pairs are permitted. No SQL is rewritten or
// appended to disable a trigger. Any other bypass source is rejected.
export function assertOriginalMigration(name, sql) {
  if (/session_replication_role/iu.test(sql)) fail();
  const allowed = {
    '20260928030000_add_notary_accounts_and_opening_actor': [
      'ALTER TABLE "notary_matter_opening" DISABLE TRIGGER reject_notary_opening_update_delete;',
    ],
    '20261010040000_add_case_trial_round_foundation': [
      'case_acceptances',
      'case_hearing_arrangements',
      'case_hearing_advances',
      'case_judgment_facts',
      'case_judgment_next_steps',
    ].map((table) => `ALTER TABLE "${table}" DISABLE TRIGGER USER;`),
  };
  const statements =
    sql.match(/ALTER\s+TABLE[^;]*DISABLE\s+TRIGGER[^;]*;/giu) ?? [];
  if (/DISABLE\s+TRIGGER/iu.test(sql) && !statements.length) fail();
  if (statements.length !== (allowed[name]?.length ?? 0)) fail();
  for (const statement of statements) {
    if (
      !allowed[name].includes(statement) ||
      sql.indexOf(statement.replace('DISABLE TRIGGER', 'ENABLE TRIGGER')) <
        sql.indexOf(statement)
    )
      fail();
  }
}

export function prepareProbePlan(root) {
  const manifest = migrationManifest(root);
  if (
    manifest.migrations.length !== 249 ||
    manifest.migrations[195].name !==
      '20261029110000_guard_case_archive_note_audit'
  )
    fail();
  for (const item of manifest.migrations)
    assertOriginalMigration(
      item.name,
      readFileSync(
        resolve(root, 'backend/prisma/migrations', item.name, 'migration.sql'),
        'utf8',
      ),
    );
  return {
    version: 1,
    target,
    manifest,
    inputs: Object.fromEntries(
      [
        'backend/prisma/schema.prisma',
        'backend/src/modules/cases/case-early-closure-upload-source.spec.ts',
        'backend/src/modules/cases/case-payment-proof-supplement-reference-draft.spec.ts',
        'backend/src/modules/cases/case-closure-payment-receipt-persistence.spec.ts',
        'backend/src/modules/cases/case-settlement-assessment-draft.spec.ts',
        'pnpm-lock.yaml',
        'scripts/closure-migration-final-probe.mjs',
        'scripts/closure-migration-followup-probe.test.mjs',
        'scripts/closure-migration-final-orchestrator.mjs',
        '.local/closure-final-20261030/resource-runner.ps1',
        'scripts/closure-synthetic-196-fixture.mjs',
        'scripts/closure-synthetic-196-fixture.test.mjs',
        'scripts/closure-acceptance-preflight.mjs',
        'scripts/test-environment.mjs',
        'scripts/run-e2e.mjs',
        'scripts/local-lock.mjs',
      ].map((name) => [name, sha(readFileSync(resolve(root, name)))]),
    ),
    historicalRows:
      'PLANNED_SYNTHETIC_EXTERNAL_PENDING_MATCH_SELECTED_FIELDS_ONLY',
    positiveBusiness: 'BLOCKED',
  };
}

export function assertBinding(binding, container, volume, network, image) {
  if (
    !fullId(binding?.containerId) ||
    !fullId(binding?.networkId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding?.imageId ?? '') ||
    binding?.repoDigest !== repoDigest ||
    !uuid(binding?.runId) ||
    binding?.volumeName !== `${target.project}-pgdata` ||
    typeof binding?.secretPath !== 'string' ||
    binding?.secretDockerSource !==
      dockerDesktopSecretSource(binding?.secretPath) ||
    !binding?.before ||
    !['containerIds', 'volumeNames', 'networkIds', 'projects'].every((key) =>
      Array.isArray(binding.before[key]),
    )
  )
    fail();
  if (
    binding.before.containerIds.includes(binding.containerId) ||
    binding.before.volumeNames.includes(binding.volumeName) ||
    binding.before.networkIds.includes(binding.networkId) ||
    binding.before.projects.includes(target.project)
  )
    fail();
  const labels = container?.Config?.Labels;
  const ports = container?.HostConfig?.PortBindings;
  const mounts = container?.Mounts ?? [];
  const nets = Object.values(container?.NetworkSettings?.Networks ?? {});
  const env = container?.Config?.Env ?? [];
  if (
    container?.Id !== binding.containerId ||
    container?.Image !== binding.imageId ||
    image?.Id !== binding.imageId ||
    !Array.isArray(image?.RepoDigests) ||
    !image.RepoDigests.includes(repoDigest) ||
    container?.Config?.Image !== target.image ||
    container?.State?.Running !== true ||
    container?.State?.Health?.Status !== 'healthy' ||
    Object.keys(ports ?? {}).length !== 1 ||
    ports['5432/tcp']?.length !== 1 ||
    ports['5432/tcp'][0].HostIp !== target.host ||
    ports['5432/tcp'][0].HostPort !== String(target.port) ||
    nets.length !== 1 ||
    nets[0].NetworkID !== binding.networkId ||
    mounts.length !== 2 ||
    !mounts.some(
      (m) =>
        m.Type === 'volume' &&
        m.Name === binding.volumeName &&
        m.Destination === '/var/lib/postgresql/data' &&
        m.RW === true,
    ) ||
    !mounts.some(
      (m) =>
        m.Type === 'bind' &&
        (m.Source === binding.secretPath ||
          m.Source === binding.secretDockerSource) &&
        m.Destination === '/run/secrets/postgres-password' &&
        m.RW === false,
    ) ||
    env.some((value) => /^POSTGRES_PASSWORD=/u.test(value)) ||
    !env.includes('POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password') ||
    !env.includes('POSTGRES_USER=dev_cor_test') ||
    !env.includes('POSTGRES_DB=dev_cor_test') ||
    container?.HostConfig?.Privileged === true ||
    Object.keys(container?.HostConfig?.Tmpfs ?? {}).length ||
    volume?.Name !== binding.volumeName ||
    network?.Id !== binding.networkId ||
    network?.Name !== `${target.project}_default`
  )
    fail();
  for (const item of [labels, volume.Labels, network.Labels])
    if (
      item?.['com.docker.compose.project'] !== target.project ||
      item?.['dev-cor.closure-acceptance.run'] !== binding.runId
    )
      fail();
}

// Only a separate temporary candidate's backend/.env.test is read. The probe
// does not call captureTestEnvironment or any existing database runner.
export function readIsolatedConfiguration(
  root,
  candidateRoot,
  verifyPermissions,
) {
  const base = realpathSync(candidateRoot);
  const original = realpathSync(root);
  const temporary = realpathSync(tmpdir());
  if (
    base === original ||
    !base.toLowerCase().startsWith(`${temporary.toLowerCase()}${sep}`)
  )
    fail();
  const path = realpathSync(join(base, 'backend/.env.test'));
  if (!path.toLowerCase().startsWith(`${base.toLowerCase()}${sep}`)) fail();
  verifyPermissions(path);
  const values = parseEnv(readFileSync(path, 'utf8'));
  if (
    Object.keys(values).some(
      (key) => !['DATABASE_URL', 'NODE_ENV'].includes(key),
    )
  )
    fail();
  const url = new URL(values.DATABASE_URL);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== target.host ||
    url.port !== String(target.port) ||
    url.username !== target.username ||
    url.pathname !== `/${target.database}` ||
    url.search ||
    url.hash ||
    !/^[A-Za-z0-9_-]{43}$/u.test(url.password)
  )
    fail();
  return { connectionString: url.href };
}

export function verifyPrivateFile(path) {
  if (process.platform !== 'win32') {
    if ((statSync(path).mode & 0o077) !== 0) fail();
    return;
  }
  // Inspect access rules only; never print a path, ACL or credential.
  // A desktop parent may supply PowerShell 7's PSModulePath to Windows
  // PowerShell 5.1. Pin the child runtime's own security module rather than
  // autoloading an incompatible or shadowed Get-Acl from inherited paths.
  const escaped = path.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; Import-Module -Name "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Microsoft.PowerShell.Security\\Get-Acl -LiteralPath '${escaped}'; $rules=@($acl.Access); if($rules.Count -eq 0){exit 1}; foreach($r in $rules){ $s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($r.AccessControlType -eq 'Allow' -and $s -notin @($sid,'S-1-5-18','S-1-5-32-544')){exit 1} }; exit 0`;
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { stdio: 'pipe', windowsHide: true },
  );
}

export const catalogSql = `SELECT c.relname AS table_name,t.tgname AS name,
 t.tgenabled AS enabled,t.tgdeferrable AS deferrable,t.tginitdeferred AS initially_deferred,
 t.tgtype::int AS trigger_type,p.pronamespace=n.oid AS function_in_schema,
 p.prorettype='trigger'::regtype AS returns_trigger,
 pg_get_triggerdef(t.oid,false) AS definition,p.proname AS function_name,
 pg_get_functiondef(p.oid) AS function_definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE NOT t.tgisinternal AND n.nspname=current_schema() ORDER BY c.relname,t.tgname`;

function requireEnabled(rows) {
  if (!rows.length || rows.some((row) => !['O', 'A'].includes(row.enabled)))
    fail();
}

function requirePaymentGates(rows) {
  for (const [table, name, functionName] of [
    [
      'case_closure_payment_versions',
      'case_closure_payment_draft_guard',
      'guard_case_closure_payment_draft',
    ],
    [
      'case_closure_payment_documents',
      'case_closure_payment_document_draft_guard',
      'guard_case_closure_payment_draft',
    ],
    [
      'case_closure_payment_versions',
      'case_closure_payment_actor_draft_guard',
      'guard_case_financial_actor_draft',
    ],
  ]) {
    const matches = rows.filter(
      (row) => row.table_name === table && row.name === name,
    );
    if (matches.length !== 1) fail();
    const row = matches[0];
    if (
      !['O', 'A'].includes(row.enabled) ||
      row.function_name !== functionName ||
      row.function_in_schema !== true ||
      row.returns_trigger !== true ||
      row.trigger_type !== 31 ||
      row.deferrable !== false
    )
      fail();
  }
}

const fixedStages = new Set([
  'LOCK_ACQUIRE',
  'PLAN_CAPTURE',
  'PLAN_COMPARE',
  'BINDING_VALIDATE',
  'DOCKER_INSPECT',
  'DOCKER_CONTAINER_INSPECT',
  'DOCKER_VOLUME_INSPECT',
  'DOCKER_NETWORK_INSPECT',
  'DOCKER_IMAGE_INSPECT',
  'DOCKER_IDENTITY_VALIDATE',
  'CONFIGURATION',
  'CONFIG_IDENTITY',
  'CONFIG_LOCATION',
  'CONFIG_ACL',
  'CONFIG_CONTENT',
  'SECRET_ACL',
  'SECRET_MATCH',
  'DATABASE_CONNECT',
  'DATABASE_IDENTITY_AND_EMPTY',
  'SCHEMA_SEARCH_PATH',
  'MIGRATION_READ',
  'MIGRATION_EXECUTE',
  'MIGRATION_GUARDS',
  'GUARD_CATALOG',
  'PAYMENT_GATE_PROBE',
  'PAYMENT_GUARD_CATALOG',
  'EMPTY_CHAIN',
  'UPGRADE_SCHEMA_CREATE',
  'SYNTHETIC_196_SEED',
  'SYNTHETIC_196_COMPARE',
  'GUARD_CATALOG_COMPARE',
  'COMPLETE',
  'CONNECTION_CLEANUP',
  'LOCK_CLEANUP',
]);

export async function runProbe({ root, plan, binding, candidateRoot }, io) {
  const report = {
    status: 'STOPPED',
    phase: 'LOCK_ACQUIRE',
    applied: { public: [], upgrade: [] },
    historicalRows: 'NOT_STARTED',
    positiveBusiness: 'BLOCKED',
    resources: {
      containerId: binding.containerId,
      volumeName: binding.volumeName,
      networkId: binding.networkId,
    },
    cleanup: 'RETAINED_FOR_PARENT_EXACT_ID_CLEANUP',
    schemas: [],
    paymentProbes: [],
  };
  let lock;
  let client;
  const stage = (value) => {
    if (!fixedStages.has(value)) fail();
    report.phase = value;
  };
  try {
    lock = await io.acquireLock();
    if (typeof lock?.release !== 'function') fail();
    const recheck = async () => {
      const previousStage = report.phase;
      stage('PLAN_CAPTURE');
      const currentPlan = await io.capturePlan(root);
      stage('PLAN_COMPARE');
      if (JSON.stringify(plan) !== JSON.stringify(currentPlan)) fail();
      stage('BINDING_VALIDATE');
      if (
        !fullId(binding?.containerId) ||
        !fullId(binding?.networkId) ||
        !/^sha256:[a-f0-9]{64}$/u.test(binding?.imageId ?? '') ||
        binding?.repoDigest !== repoDigest ||
        binding?.volumeName !== `${target.project}-pgdata` ||
        !uuid(binding?.runId)
      )
        fail();
      stage('DOCKER_INSPECT');
      const [container, volume, network, image] = await io.inspect(
        binding,
        stage,
      );
      stage('DOCKER_IDENTITY_VALIDATE');
      assertBinding(binding, container, volume, network, image);
      stage(previousStage);
    };
    await recheck();
    stage('CONFIGURATION');
    const config = await io.readConfiguration(
      root,
      candidateRoot,
      binding,
      stage,
    );
    stage('DATABASE_CONNECT');
    client = await io.connect(config);
    stage('DATABASE_IDENTITY_AND_EMPTY');
    const identity = (
      await client.query(`SELECT current_database() AS database,current_user AS username,
      current_setting('session_replication_role') AS replication_role,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
       AND c.relkind IN ('r','p','v','m','S','f')) AS objects`)
    ).rows[0];
    if (
      identity.database !== target.database ||
      identity.username !== target.username ||
      identity.replication_role !== 'origin' ||
      identity.objects !== 0
    )
      fail();
    report.emptyDatabaseConfirmed = true;
    const apply = async (schema, list, destination) => {
      stage('SCHEMA_SEARCH_PATH');
      await client.query(`SET search_path TO ${q(schema)}`);
      for (const migration of list) {
        await recheck();
        stage('MIGRATION_READ');
        const bytes = await io.readMigration(root, migration.name);
        if (sha(bytes) !== migration.sha256) fail();
        assertOriginalMigration(migration.name, bytes.toString('utf8'));
        // One original file per query, preserving its own BEGIN/COMMIT and enum
        // transaction boundaries. No public fallback and no rewriting.
        stage('MIGRATION_EXECUTE');
        report.currentMigration = migration.name;
        await client.query(bytes.toString('utf8'));
        destination.push(migration.name);
        stage('MIGRATION_GUARDS');
        const role = (
          await client.query(
            "SELECT current_setting('session_replication_role') AS role",
          )
        ).rows[0];
        if (role.role !== 'origin') fail();
        const disabled = await client.query(`SELECT t.tgname FROM pg_trigger t
          JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname=current_schema() AND t.tgenabled NOT IN ('O','A')`);
        if (disabled.rows.length) fail();
        await recheck();
      }
    };
    const inspectGuards = async () => {
      stage('GUARD_CATALOG');
      const rows = (await client.query(catalogSql)).rows;
      requireEnabled(rows);
      return rows;
    };
    const negative = async (schema) => {
      stage('SCHEMA_SEARCH_PATH');
      await client.query(`SET search_path TO ${q(schema)}`);
      await recheck();
      stage('PAYMENT_GUARD_CATALOG');
      requirePaymentGates((await client.query(catalogSql)).rows);
      for (const [table, expectedMessage, rejectingGuard] of [
        [
          'case_closure_payment_versions',
          'financial authorization requires serializable transaction',
          'FINANCIAL_ACTOR_GUARD',
        ],
        [
          'case_closure_payment_documents',
          'case closure payment persistence is draft and not enabled',
          'PAYMENT_DRAFT_GATE',
        ],
      ]) {
        await recheck();
        stage('PAYMENT_GATE_PROBE');
        await client.query('BEGIN');
        let rejected = false;
        try {
          await client.query(`INSERT INTO ${q(table)} DEFAULT VALUES`);
        } catch (error) {
          rejected =
            error.code === '23514' && error.message === expectedMessage;
        } finally {
          await client.query('ROLLBACK');
        }
        if (!rejected) fail();
        report.paymentProbes.push({
          schemaRole: schema === 'public' ? 'PUBLIC' : 'UPGRADE',
          table,
          draftGateCatalog: 'EXISTS_ENABLED_EXPECTED_FUNCTION',
          emptyInsertRejectedBy: rejectingGuard,
          draftGateBehaviorDirectlyVerified:
            table === 'case_closure_payment_documents',
        });
      }
    };
    stage('EMPTY_CHAIN');
    await apply('public', plan.manifest.migrations, report.applied.public);
    const publicGuards = await inspectGuards();
    await negative('public');
    const schema = `closure_upgrade_${randomUUID().replaceAll('-', '')}`;
    report.schemas.push(schema);
    await recheck();
    stage('UPGRADE_SCHEMA_CREATE');
    await client.query(`CREATE SCHEMA ${q(schema)}`);
    await apply(
      schema,
      plan.manifest.migrations.slice(0, 196),
      report.applied.upgrade,
    );
    const previous = await inspectGuards();
    stage('SYNTHETIC_196_SEED');
    await recheck();
    const seeded = await io.seedHistoricalFixture(client, schema);
    const beforeSnapshot = stableJson(seeded.snapshot);
    report.historicalRows = 'SEEDED_NOT_YET_COMPARED';
    report.historicalScope =
      'SYNTHETIC_EXTERNAL_PENDING_MATCH_SELECTED_FIELDS_ONLY';
    report.historicalNotCovered = [
      'ARCHIVE',
      'PAYMENT',
      'CONSOLIDATION',
      'ALL_COLUMNS',
    ];
    report.historicalEvidence = {
      tableCount: Object.keys(seeded.snapshot).length,
      rowCount: Object.values(seeded.snapshot).reduce(
        (total, rows) => total + rows.length,
        0,
      ),
      idsSha256: sha(stableJson(seeded.ids)),
      beforeSha256: sha(beforeSnapshot),
    };
    await recheck();
    await apply(
      schema,
      plan.manifest.migrations.slice(196),
      report.applied.upgrade,
    );
    stage('SYNTHETIC_196_COMPARE');
    const afterSnapshot = stableJson(
      await io.snapshotHistoricalFixture(client, schema, seeded.ids),
    );
    report.historicalEvidence.afterSha256 = sha(afterSnapshot);
    report.historicalEvidence.matches = beforeSnapshot === afterSnapshot;
    if (!report.historicalEvidence.matches) {
      report.historicalRows = 'SELECTED_FIELDS_DIFFER_AFTER_UPGRADE';
      fail();
    }
    report.historicalRows =
      'SYNTHETIC_EXTERNAL_PENDING_MATCH_SELECTED_FIELDS_PRESERVED';
    const upgraded = await inspectGuards();
    stage('GUARD_CATALOG_COMPARE');
    if (
      previous.some(
        (old) =>
          !upgraded.some(
            (row) => row.name === old.name && row.table_name === old.table_name,
          ),
      )
    )
      fail();
    // Separate full-chain replay must converge to the same trigger/function
    // catalog. This is a parity check, not an independently approved baseline.
    const normalize = (rows, source) =>
      JSON.stringify(rows)
        .replaceAll(`\\"${source}\\".`, '')
        .replaceAll(`${source}.`, '');
    if (normalize(publicGuards, 'public') !== normalize(upgraded, schema))
      fail();
    await negative(schema);
    await recheck();
    report.status =
      'EMPTY_249_AND_SYNTHETIC_196_TO_249_AND_PAYMENT_GATE_PROBES_PASSED';
    stage('COMPLETE');
    report.guardCounts = {
      baseline196: previous.length,
      final249: upgraded.length,
    };
    report.guardCatalogParityHash = sha(normalize(upgraded, schema));
    report.guardBehaviorScope =
      'VERSION_ACTOR_REJECTION_AND_DOCUMENT_DRAFT_GATE_REJECTION_WITH_BOTH_DRAFT_GATES_ENABLED';
    report.newnessEvidence =
      'PARENT_CAPTURED_BEFORE_INVENTORY_PLUS_REAL_EMPTY_DATABASE';
  } catch (error) {
    if (/^[0-9A-Z]{5}$/u.test(error?.code ?? '')) report.sqlstate = error.code;
  } finally {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* failed transaction may already be closed */
      }
      try {
        await client.end();
      } catch {
        report.status = 'STOPPED';
        stage('CONNECTION_CLEANUP');
        report.connectionCleanup = 'REQUIRES_REVIEW';
      }
    }
    if (lock)
      try {
        await lock.release();
      } catch {
        report.status = 'STOPPED';
        stage('LOCK_CLEANUP');
        report.lockCleanup = 'REQUIRES_REVIEW';
      }
  }
  return report;
}

export function realIo(root) {
  const docker = (args) =>
    JSON.parse(
      execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      }),
    );
  return {
    seedHistoricalFixture: seedSynthetic196ExternalCase,
    snapshotHistoricalFixture: snapshotSynthetic196ExternalCase,
    acquireLock: acquireE2eResourceLock,
    capturePlan: prepareProbePlan,
    inspect: async (binding, stage) => {
      const inspect = (code, args) => {
        stage(code);
        return docker(args)[0];
      };
      return [
        inspect('DOCKER_CONTAINER_INSPECT', ['inspect', binding.containerId]),
        inspect('DOCKER_VOLUME_INSPECT', [
          'volume',
          'inspect',
          binding.volumeName,
        ]),
        inspect('DOCKER_NETWORK_INSPECT', [
          'network',
          'inspect',
          binding.networkId,
        ]),
        inspect('DOCKER_IMAGE_INSPECT', ['image', 'inspect', target.image]),
      ];
    },
    readConfiguration: (source, candidate, binding, stage) => {
      stage('CONFIG_IDENTITY');
      const base = realpathSync(candidate);
      if (
        base !==
          join(realpathSync(tmpdir()), `dev-cor-closure-${binding.runId}`) ||
        realpathSync(binding.secretPath) !== join(base, 'postgres-password')
      )
        fail();
      stage('CONFIG_LOCATION');
      const config = readIsolatedConfiguration(source, candidate, (path) => {
        stage('CONFIG_ACL');
        verifyPrivateFile(path);
        stage('CONFIG_CONTENT');
      });
      stage('SECRET_ACL');
      verifyPrivateFile(binding.secretPath);
      stage('SECRET_MATCH');
      if (
        readFileSync(binding.secretPath, 'utf8').trim() !==
        new URL(config.connectionString).password
      )
        fail();
      return config;
    },
    connect: async (config) => {
      const require = createRequire(resolve(root, 'backend/package.json'));
      const { Client } = require('pg');
      const client = new Client({
        ...config,
        ssl: false,
        options: '-c statement_timeout=60000 -c lock_timeout=10000',
        connectionTimeoutMillis: 5000,
        statement_timeout: 60000,
        query_timeout: 70000,
        application_name: 'closure-migration-probe',
      });
      // Socket failures must stop/report through the caller, without pg's
      // unhandled error event printing connection details to the terminal.
      client.on('error', () => {});
      try {
        await client.connect();
      } catch (error) {
        try {
          await client.end();
        } catch {
          /* report remains stopped */
        }
        throw error;
      }
      return client;
    },
    readMigration: (source, name) =>
      readFileSync(
        resolve(source, 'backend/prisma/migrations', name, 'migration.sql'),
      ),
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const root = resolve(import.meta.dirname, '..');
  try {
    const [mode, planPath, bindingPath, candidateRoot, reportPath] =
      process.argv.slice(2);
    if (mode === '--prepare' && process.argv.length === 4) {
      writeFileSync(
        planPath,
        `${JSON.stringify(prepareProbePlan(root), null, 2)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      console.log('Offline plan written; no services accessed');
    } else if (mode === '--run' && process.argv.length === 7) {
      const plan = JSON.parse(readFileSync(planPath, 'utf8'));
      const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
      // Refuse overwriting earlier evidence before doing any service work.
      writeFileSync(reportPath, '{"status":"RUNNING_OR_INTERRUPTED"}\n', {
        flag: 'wx',
        mode: 0o600,
      });
      const report = await runProbe(
        { root, plan, binding, candidateRoot },
        realIo(root),
      );
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(report.status);
      if (report.status === 'STOPPED') process.exitCode = 1;
    } else fail();
  } catch {
    console.error(
      'Closed probe stopped; no raw service errors or credentials are logged',
    );
    process.exitCode = 1;
  }
}
