import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  admitFreshClosureInstance,
  assertMigrationManifest,
} from './closure-acceptance-preflight.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const reject = () => {
  throw new Error('Closed acceptance stopped');
};
const id = (value) => /^[a-f0-9]{64}$/u.test(value ?? '');
const label = 'dev-cor.closure-acceptance.run';

// These are the only runtime probes. No caller-provided SQL is accepted.
export const emptyDatabaseProbe = `SELECT current_database() AS database,
 current_user AS username, current_setting('session_replication_role') AS replication_role,
 (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
  AND c.relkind IN ('r','p','v','m','S','f')) AS application_objects`;

export const guardCatalogProbe = `SELECT n.nspname AS schema, c.relname AS table,
 t.tgname AS trigger, t.tgenabled AS enabled, t.tgdeferrable AS deferrable,
 t.tginitdeferred AS initially_deferred, pg_get_triggerdef(t.oid,false) AS definition,
 pn.nspname AS function_schema, p.proname AS function, l.lanname AS language,
 p.prosecdef AS security_definer, pg_get_functiondef(p.oid) AS function_definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace pn ON pn.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE NOT t.tgisinternal AND n.nspname='public'
 ORDER BY n.nspname,c.relname,t.tgname`;

export const closedPaymentProbe = `BEGIN;
DO $probe$ BEGIN
 IF current_setting('session_replication_role') <> 'origin' THEN
  RAISE EXCEPTION 'guard probe requires origin replication role';
 END IF;
 BEGIN
  INSERT INTO public.case_closure_payment_versions DEFAULT VALUES;
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM = 'case closure payment persistence is draft and not enabled' THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'closed gate probe unexpectedly accepted';
END $probe$;
ROLLBACK;`;

const requiredMethods = [
  'acquireSharedLock',
  'captureCandidate',
  'inventory',
  'createSecretFile',
  'createVolume',
  'createNetwork',
  'createContainer',
  'waitHealthy',
  'inspectCreated',
  'query',
  'readMigration',
  'executeSql',
  'removeContainer',
  'removeVolume',
  'removeNetwork',
  'removeSecretFile',
];

function assertCandidate(expected, actual) {
  if (
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(expected?.treeHash ?? '') ||
    actual?.treeHash !== expected.treeHash ||
    !id(expected?.guardCatalogHash)
  )
    reject();
  assertMigrationManifest(expected.manifest, actual.manifest);
  if (
    digest(JSON.stringify(expected.manifest.migrations)) !==
      expected.manifest.sha256 ||
    expected.manifest.migrations.some(
      (migration) =>
        !/^\d{14}_[a-z0-9_]+$/u.test(migration.name) || !id(migration.sha256),
    )
  )
    reject();
}

function assertNewInventory(inventory, project, port) {
  for (const key of [
    'projects',
    'containerIds',
    'volumeNames',
    'networkIds',
    'ports',
  ])
    if (!Array.isArray(inventory?.[key])) reject();
  if (
    inventory.projects.includes(project) ||
    inventory.volumeNames.includes(`${project}-pgdata`) ||
    inventory.ports.includes(port)
  )
    reject();
}

function admitCreated(state, snapshot) {
  const { binding, before, secret, runId } = state;
  const container = snapshot.containers?.find(
    (item) => item.Id === binding.containerId,
  );
  const mounts = container?.Mounts ?? [];
  const secretMount = mounts.filter(
    (mount) =>
      mount.Type === 'bind' &&
      mount.Source === secret.path &&
      mount.Destination === '/run/secrets/postgres-password' &&
      mount.RW === false,
  );
  if (
    secretMount.length !== 1 ||
    mounts.length !== 2 ||
    !container.Config.Env.includes(
      'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
    ) ||
    container.Config.Env.some((value) => /^POSTGRES_PASSWORD=/u.test(value)) ||
    Object.values(container.HostConfig?.PortBindings ?? {}).flat().length !==
      1 ||
    container.HostConfig.PortBindings['5432/tcp']?.[0]?.HostIp !==
      '127.0.0.1' ||
    Number(container.HostConfig.PortBindings['5432/tcp'][0].HostPort) !==
      binding.port ||
    [
      container.Config.Labels,
      snapshot.volumes?.[0]?.Labels,
      snapshot.networks?.[0]?.Labels,
    ].some((labels) => labels?.[label] !== runId)
  )
    reject();
  // The previous preflight deliberately permits only the data volume. Admit
  // the exact read-only secret bind here, then reuse all its other checks.
  return admitFreshClosureInstance({
    binding,
    before,
    containers: snapshot.containers.map((item) =>
      item.Id === binding.containerId
        ? {
            ...item,
            Mounts: mounts.filter((mount) => mount !== secretMount[0]),
          }
        : item,
    ),
    volumes: snapshot.volumes,
    networks: snapshot.networks,
  });
}

/** Reviewable orchestration only. There is intentionally no CLI/default adapter.
 * The adapter must hold the existing E2E shared lock, collect live inventories,
 * create new resources (never compose up/reuse), and enforce Windows ACL/POSIX
 * secret-file permissions before writing. Raw Docker output/errors stay private.
 * No production adapter has been reviewed or supplied by this module.
 */
export async function runClosedAcceptance(
  { project, port, candidate },
  adapter,
) {
  const report = {
    status: 'BLOCKED_ADAPTER_NOT_REVIEWED',
    positiveWrites: 'BLOCKED',
    migrationsApplied: [],
    resources: {},
    cleanup: 'NOT_STARTED',
    unconfirmedCreations: [],
  };
  if (
    adapter?.reviewedSecretFileLifecycle !== true ||
    requiredMethods.some((name) => typeof adapter?.[name] !== 'function')
  )
    return report;
  let lock;
  let secret;
  let admitted = false;
  const state = { binding: { project, port }, runId: randomUUID() };
  try {
    if (
      !/^dev-cor-closure-acceptance-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
        project ?? '',
      ) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      [15433, 15436, 15438, 15440, 55432].includes(port)
    )
      reject();
    lock = await adapter.acquireSharedLock();
    if (typeof lock?.release !== 'function') reject();
    await adapter
      .captureCandidate()
      .then((actual) => assertCandidate(candidate, actual));
    state.before = await adapter.inventory();
    assertNewInventory(state.before, project, port);
    const password = Buffer.from(randomBytes(32).toString('base64url'));
    // The adapter may write the file and then throw before returning its
    // descriptor. Record that uncertainty before handing it any secret bytes.
    report.unconfirmedCreations.push('secret');
    try {
      secret = await adapter.createSecretFile({ password, runId: state.runId });
      report.unconfirmedCreations = [];
    } finally {
      password.fill(0);
    }
    if (secret?.permissionVerified !== true || !isAbsolute(secret?.path ?? ''))
      reject();
    state.secret = secret;
    report.unconfirmedCreations.push('volume');
    const volumeName = await adapter.createVolume({
      project,
      runId: state.runId,
    });
    if (volumeName !== `${project}-pgdata`) reject();
    report.resources.volumeName = volumeName;
    report.unconfirmedCreations = [];
    report.unconfirmedCreations.push('network');
    state.binding.networkId = await adapter.createNetwork({
      project,
      runId: state.runId,
    });
    if (!id(state.binding.networkId)) reject();
    report.resources.networkId = state.binding.networkId;
    report.unconfirmedCreations = [];
    report.unconfirmedCreations.push('container');
    state.binding.containerId = await adapter.createContainer({
      project,
      port,
      host: '127.0.0.1',
      volumeName,
      networkId: state.binding.networkId,
      passwordFile: secret.path,
      runId: state.runId,
    });
    if (!id(state.binding.containerId)) reject();
    report.resources.containerId = state.binding.containerId;
    report.unconfirmedCreations = [];
    await adapter.waitHealthy(state.binding.containerId);
    const recheck = async () => {
      assertCandidate(candidate, await adapter.captureCandidate());
      admitCreated(state, await adapter.inspectCreated({ ...state.binding }));
    };
    await recheck();
    admitted = true;
    const empty = await adapter.query(
      state.binding.containerId,
      emptyDatabaseProbe,
    );
    if (
      empty?.database !== 'dev_cor_test' ||
      empty.username !== 'dev_cor_test' ||
      empty.replication_role !== 'origin' ||
      empty.application_objects !== 0
    )
      reject();
    for (const migration of candidate.manifest.migrations) {
      await recheck();
      const bytes = await adapter.readMigration(migration.name);
      if (digest(bytes) !== migration.sha256) reject();
      // Conservative stop, including comments: this is not an SQL parser or
      // a replacement for reviewing the approved manifest's full source.
      if (
        /\bsession_replication_role\b|\bDISABLE\s+TRIGGER\b/iu.test(
          bytes.toString('utf8'),
        )
      )
        reject();
      await adapter.executeSql(state.binding.containerId, bytes);
      report.migrationsApplied.push(migration.name);
      await recheck();
    }
    const catalog = await adapter.query(
      state.binding.containerId,
      guardCatalogProbe,
    );
    if (
      !Array.isArray(catalog) ||
      catalog.length === 0 ||
      catalog.some((row) => !['O', 'A'].includes(row.enabled)) ||
      digest(JSON.stringify(catalog)) !== candidate.guardCatalogHash
    )
      reject();
    await recheck();
    await adapter.executeSql(state.binding.containerId, closedPaymentProbe);
    await recheck();
    report.status = 'CLOSED_MIGRATIONS_AND_GUARD_PROBES_PASSED';
    // Only a fully proven successful instance is cleaned automatically. Any
    // failure preserves known identities for diagnosis; never guess ownership.
    await adapter.removeContainer(report.resources.containerId);
    await adapter.removeVolume(report.resources.volumeName);
    await adapter.removeNetwork(report.resources.networkId);
    const after = await adapter.inventory();
    if (
      after.containerIds.includes(report.resources.containerId) ||
      after.volumeNames.includes(report.resources.volumeName) ||
      after.networkIds.includes(report.resources.networkId)
    )
      reject();
    report.cleanup = 'EXACT_CREATED_IDENTITIES_REMOVED';
  } catch {
    report.status = 'STOPPED';
    report.cleanup = report.unconfirmedCreations.length
      ? 'RETAINED_UNCONFIRMED_RESOURCES'
      : Object.keys(report.resources).length
        ? 'RETAINED_FOR_REVIEW'
        : 'NOT_CREATED';
  } finally {
    // Retain the protected password file with a retained container that still
    // mounts it. Never include its path/content or arbitrary adapter errors.
    if (
      secret &&
      ((!report.resources.containerId &&
        !report.unconfirmedCreations.includes('container')) ||
        report.cleanup === 'EXACT_CREATED_IDENTITIES_REMOVED')
    ) {
      try {
        await adapter.removeSecretFile(secret);
      } catch {
        report.status = 'STOPPED';
        report.cleanup = 'SECRET_CLEANUP_REQUIRES_REVIEW';
      }
    }
    if (lock) {
      try {
        await lock.release();
      } catch {
        report.status = 'STOPPED';
      }
    }
  }
  if (!admitted && report.status !== 'STOPPED') report.status = 'STOPPED';
  return report;
}
