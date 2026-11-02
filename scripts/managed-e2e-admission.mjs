/** Explicit read-only admission. Importing does not inspect Docker, connect, or seed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  readFileSync,
  lstatSync,
  realpathSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { getCallSites } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const moduleScriptName = getCallSites(1, { sourceMap: false })[0]?.scriptName;
assert.ok(
  typeof moduleScriptName === 'string' &&
    (moduleScriptName.startsWith('file:') || isAbsolute(moduleScriptName)),
  'Actual module location required',
);
const modulePath = moduleScriptName.startsWith('file:')
  ? fileURLToPath(moduleScriptName)
  : moduleScriptName;
const project = 'dev-cor-closure-flow-20261030';
const imageId =
  'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0';
const image = `postgres:17.11-bookworm@${imageId}`;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (value) =>
  assert.match(
    value,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
const digest = (value) => assert.match(value, /^[a-f0-9]{64}$/u);
function regular(path) {
  const full = resolve(path);
  for (let p = full; ; p = dirname(p)) {
    assert.ok(!lstatSync(p).isSymbolicLink(), 'Reparse path rejected');
    if (dirname(p) === p) break;
  }
  assert.ok(lstatSync(full).isFile());
  assert.equal(realpathSync.native(full), full);
  return readFileSync(full);
}
function boundJson(path, hash) {
  digest(hash);
  const bytes = regular(path);
  assert.equal(sha(bytes), hash, 'Bound file changed');
  return JSON.parse(bytes);
}
/** Pure tuple validator, also used by offline negative tests; never grants admission alone. */
export function validateManagedE2eTuple(m) {
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.purpose, 'controlled-synthetic-managed-e2e');
  assert.equal(m.project, project);
  uuid(m.runId);
  uuid(m.parentRunId);
  assert.notEqual(m.runId, m.parentRunId);
  assert.equal(m.parentRunId, '1f9e329d-ca0e-40f0-afd4-45bc1c1e0665');
  for (const id of [m.parentContainerId, m.containerId, m.networkId])
    digest(id);
  assert.notEqual(m.parentContainerId, m.containerId);
  assert.equal(m.image, image);
  assert.equal(m.host, '127.0.0.1');
  assert.equal(m.port, 15446);
  assert.equal(m.database, 'dev_cor_test');
  assert.equal(m.username, 'dev_cor_test');
  assert.equal(m.name, `${project}-postgres-test-1`);
  assert.equal(m.volume, `${project}-test-${m.runId.slice(0, 8)}-pgdata`);
  assert.equal(
    resolve(m.parentPrivateRoot),
    join(tmpdir(), `${project}-${m.parentRunId}`),
  );
  assert.equal(
    resolve(m.directory),
    join(m.parentPrivateRoot, 'managed-gates', m.runId),
  );
  for (const field of [
    'parentManifestSha256',
    'planSha256',
    'receiptSha256',
    'roleSha256',
    'admissionModuleSha256',
    'candidateSha256',
  ])
    digest(m[field]);
  assert.equal(
    resolve(m.planPath),
    join(m.directory, 'managed-gate-plan.json'),
  );
  assert.equal(
    resolve(m.receiptPath),
    join(m.directory, 'managed-gate-receipt.json'),
  );
  assert.equal(
    resolve(m.rolePath),
    join(m.directory, 'managed-e2e-identities.json'),
  );
  assert.ok(
    Array.isArray(m.candidate?.migrations) &&
      m.candidate.migrations.length >= 266,
  );
  assert.equal(sha(JSON.stringify(m.candidate)), m.candidateSha256);
  return m;
}
const docker = (kind, id) =>
  JSON.parse(
    execFileSync(
      process.platform === 'win32' ? 'docker.exe' : 'docker',
      kind === 'container' ? ['inspect', id] : [kind, 'inspect', id],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
      },
    ),
  )[0];
function networkAttachment(c, networkId) {
  assert.equal(c.HostConfig.NetworkMode, networkId);
  const attachments = Object.values(c.NetworkSettings.Networks ?? {});
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].NetworkID, networkId);
  assert.equal(c.State.Running, true);
  assert.equal(c.State.Health?.Status, 'healthy');
}
function port(c, number) {
  assert.deepEqual(c.HostConfig.PortBindings, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(number) }],
  });
  assert.deepEqual(c.NetworkSettings.Ports, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(number) }],
  });
}
function labels(actual, runId) {
  assert.equal(actual['com.docker.compose.project'], project);
  assert.equal(actual['dev-cor.acceptance.run'], runId);
}
function tree(root) {
  const rows = [];
  function visit(path, name) {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory())
      for (const child of readdirSync(path).sort())
        visit(join(path, child), name ? `${name}/${child}` : child);
    else {
      assert.ok(stat.isFile());
      rows.push([name, sha(readFileSync(path))]);
    }
  }
  visit(root, '');
  return sha(JSON.stringify(rows));
}
function candidate(root) {
  return {
    node: process.version,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    trees: Object.fromEntries(
      ['backend/src', 'backend/dist', 'backend/prisma', 'frontend/src'].map(
        (p) => [p, tree(join(root, p))],
      ),
    ),
    files: Object.fromEntries(
      [
        'pnpm-lock.yaml',
        'package.json',
        'backend/package.json',
        'frontend/package.json',
        'backend/prisma.config.ts',
      ].map((p) => [p, sha(regular(join(root, p)))]),
    ),
    migrations: readdirSync(join(root, 'backend/prisma/migrations'))
      .sort()
      .filter((n) =>
        existsSync(join(root, 'backend/prisma/migrations', n, 'migration.sql')),
      )
      .map((name) => ({
        name,
        sha256: sha(
          regular(
            join(root, 'backend/prisma/migrations', name, 'migration.sql'),
          ),
        ),
      })),
  };
}
/** Validates actual inspect results; supplied snapshots are not an admission receipt. */
export function validateManagedE2eResources(
  m,
  parent,
  child,
  network,
  volume,
  plan,
  receipt,
) {
  validateManagedE2eTuple(m);
  assert.equal(plan.parentProject, project);
  assert.equal(plan.parentRunId, m.parentRunId);
  assert.equal(plan.runId, m.runId);
  assert.equal(plan.parentContainerId, m.parentContainerId);
  assert.equal(plan.parentNetworkId, m.networkId);
  assert.equal(plan.directory, m.directory);
  for (const field of ['image', 'port', 'name', 'volume'])
    assert.equal(plan[field], m[field]);
  assert.equal(plan.parentPrivateRoot, m.parentPrivateRoot);
  assert.deepEqual(plan.frozen, m.candidate);
  assert.equal(receipt.runId, m.runId);
  assert.equal(receipt.parentRunId, m.parentRunId);
  assert.equal(receipt.planSha256, m.planSha256);
  assert.equal(receipt.containerId, m.containerId);
  assert.equal(receipt.parentContainerId, m.parentContainerId);
  for (const field of ['port', 'name', 'volume'])
    assert.equal(receipt[field], m[field]);
  assert.equal(receipt.state, 'REAL_MANAGED_TEST_CONTAINER_HEALTHY');
  assert.equal(parent.Id, m.parentContainerId);
  assert.equal(child.Id, m.containerId);
  assert.equal(parent.Config.Image, image);
  assert.equal(parent.Image, imageId);
  assert.equal(child.Image, imageId);
  assert.equal(child.Config.Image, image);
  labels(parent.Config.Labels, m.parentRunId);
  labels(child.Config.Labels, m.runId);
  assert.equal(child.Config.Labels['dev-cor.acceptance.parent'], m.parentRunId);
  assert.equal(
    child.Config.Labels['com.docker.compose.service'],
    'postgres-test',
  );
  assert.equal(child.Config.Labels['com.docker.compose.container-number'], '1');
  assert.equal(child.Name, `/${m.name}`);
  networkAttachment(parent, m.networkId);
  networkAttachment(child, m.networkId);
  port(parent, 15445);
  port(child, 15446);
  assert.equal(network.Id, m.networkId);
  assert.equal(network.Name, `${project}_default`);
  labels(network.Labels, m.parentRunId);
  assert.deepEqual(
    Object.keys(network.Containers ?? {}).sort(),
    [m.parentContainerId, m.containerId].sort(),
  );
  assert.equal(volume.Name, m.volume);
  labels(volume.Labels, m.runId);
  assert.equal(volume.Labels['dev-cor.acceptance.parent'], m.parentRunId);
  const expectedEnv = [
    'POSTGRES_DB=dev_cor_test',
    'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-test-password',
    'POSTGRES_USER=dev_cor_test',
  ].sort();
  assert.deepEqual(
    child.Config.Env.filter((x) => x.startsWith('POSTGRES_')).sort(),
    expectedEnv,
  );
  assert.equal(child.Mounts.length, 2);
  assert.equal(
    child.Mounts.filter(
      (x) =>
        x.Type === 'volume' &&
        x.Name === m.volume &&
        x.Destination === '/var/lib/postgresql/data',
    ).length,
    1,
  );
  const secretSource =
    '/run/desktop/mnt/host/' +
    m.directory[0].toLowerCase() +
    m.directory.slice(2).replaceAll('\\', '/') +
    '/postgres-test-password';
  assert.equal(
    child.Mounts.filter(
      (x) =>
        x.Type === 'bind' &&
        x.Source === secretSource &&
        x.Destination === '/run/secrets/postgres-test-password' &&
        x.RW === false,
    ).length,
    1,
  );
  const invariant = (c) => ({
    id: c.Id,
    image: c.Image,
    labels: c.Config.Labels,
    environment: c.Config.Env,
    bindings: c.HostConfig.PortBindings,
    mounts: c.Mounts,
    networkMode: c.HostConfig.NetworkMode,
  });
  assert.deepEqual(
    normalizeManagedParentMounts(invariant(parent)),
    normalizeManagedParentMounts(plan.parentInvariant),
  );
}
/** Docker may reorder Mounts; retain every field and reject duplicate destinations. */
export function normalizeManagedParentMounts(invariant) {
  assert.ok(Array.isArray(invariant.mounts));
  const destinations = new Set();
  for (const mount of invariant.mounts) {
    assert.ok(mount && typeof mount === 'object' && !Array.isArray(mount));
    assert.ok(
      typeof mount.Destination === 'string' && mount.Destination.length > 0,
    );
    assert.ok(
      !destinations.has(mount.Destination),
      'Duplicate parent mount destination',
    );
    destinations.add(mount.Destination);
  }
  return {
    ...invariant,
    mounts: [...invariant.mounts].sort((a, b) =>
      a.Destination < b.Destination
        ? -1
        : a.Destination > b.Destination
          ? 1
          : 0,
    ),
  };
}
/** Full row snapshots supplied by separately reviewed identity-only provisioning. No credentials. */
export function validateManagedE2eIdentityManifest(role, m) {
  assert.equal(role.runId, m.runId);
  uuid(role.departmentId);
  assert.ok(Array.isArray(role.actors) && role.actors.length > 0);
  assert.equal(new Set(role.actors.map((a) => a.id)).size, role.actors.length);
  assert.equal(
    new Set(role.actors.map((a) => a.roleId)).size,
    role.actors.length,
  );
  for (const actor of role.actors) {
    uuid(actor.id);
    uuid(actor.roleId);
    assert.equal(actor.externalSubject, `managed-e2e:${m.runId}:${actor.id}`);
    assert.ok(actor.username.startsWith(`managed.e2e.${m.runId.slice(0, 8)}.`));
    assert.equal(actor.authorizationRevision, 1);
    assert.ok(Array.isArray(actor.grants) && actor.grants.length > 0);
    for (const g of actor.grants) {
      assert.match(g.action, /^[a-z][a-z0-9.-]+$/u);
      assert.ok(['SELF', 'TEAM', 'DEPARTMENT'].includes(g.scope));
    }
  }
  for (const name of [
    'user_accounts',
    'local_credentials',
    'department_memberships',
    'role_assignments',
    'role_templates',
    'role_grants',
  ])
    assert.ok(
      Array.isArray(role.tables?.[name]) && role.tables[name].length > 0,
    );
}
export function validateManagedE2eLedger(ledger, migrations) {
  assert.equal(ledger.length, migrations.length);
  for (const [i, row] of ledger.entries()) {
    assert.ok(row.finished_at && !row.rolled_back_at);
    assert.equal(row.migration_name, migrations[i].name);
    assert.equal(row.checksum, migrations[i].sha256);
  }
}
/** Pure parent binding validator; physical and database admission remain mandatory. */
export function validateManagedE2eParentCandidate(parent, plan, m) {
  const codeOnly =
    parent.purpose === 'CODE_CANDIDATE_ONLY' ||
    parent.state === 'CODE_EXPECTATION_NOT_INSTALLED_DATABASE' ||
    ['codeOnly', 'currentCodeCandidate', 'currentCodeCandidateSha256'].some(
      (field) => Object.hasOwn(parent, field),
    ) ||
    ['codeResourceView', 'currentCodeCandidateSha256'].some((field) =>
      Object.hasOwn(plan, field),
    );
  if (!codeOnly) {
    assert.deepEqual(parent.candidate, m.candidate);
    return;
  }
  assert.equal(parent.purpose, 'CODE_CANDIDATE_ONLY');
  assert.equal(parent.codeOnly, true);
  assert.equal(parent.state, 'CODE_EXPECTATION_NOT_INSTALLED_DATABASE');
  assert.equal(
    resolve(m.parentManifestPath),
    resolve(plan.codeResourceView.manifestPath),
  );
  assert.equal(m.parentManifestSha256, plan.codeResourceView.manifestSha256);
  digest(parent.currentCodeCandidateSha256);
  assert.equal(
    sha(JSON.stringify(parent.currentCodeCandidate)),
    parent.currentCodeCandidateSha256,
  );
  assert.equal(
    parent.currentCodeCandidateSha256,
    plan.currentCodeCandidateSha256,
  );
  assert.deepEqual(parent.currentCodeCandidate, plan.frozen);
  assert.deepEqual(parent.currentCodeCandidate, m.candidate);
  assert.equal(parent.candidate.migrations.length, 269);
  digest(plan.schemaCandidateSha256);
  assert.equal(parent.artifactCandidateSha256, plan.schemaCandidateSha256);
  assert.equal(
    sha(JSON.stringify(parent.candidate)),
    plan.schemaCandidateSha256,
  );
  digest(parent.parentInstalledManifestSha256);
  assert.equal(
    parent.parentInstalledManifestPath,
    plan.parentInstalledManifestPath,
  );
  assert.equal(
    parent.parentInstalledManifestSha256,
    plan.parentInstalledManifestSha256,
  );
}
/** Reads and closes its own connection. No callbacks or write-capable client are exposed. */
export async function admitManagedE2e({
  root,
  manifestPath,
  manifestSha256,
  databaseUrl,
}) {
  digest(manifestSha256);
  const m = validateManagedE2eTuple(boundJson(manifestPath, manifestSha256));
  assert.equal(
    resolve(manifestPath),
    join(m.directory, 'managed-e2e-admission.json'),
  );
  assert.equal(sha(regular(modulePath)), m.admissionModuleSha256);
  const parentManifest = boundJson(
      m.parentManifestPath,
      m.parentManifestSha256,
    ),
    plan = boundJson(m.planPath, m.planSha256),
    receipt = boundJson(m.receiptPath, m.receiptSha256),
    role = boundJson(m.rolePath, m.roleSha256);
  assert.equal(parentManifest.runId, m.parentRunId);
  assert.equal(parentManifest.containerId, m.parentContainerId);
  assert.equal(parentManifest.networkId, m.networkId);
  assert.equal(parentManifest.privateRoot, m.parentPrivateRoot);
  validateManagedE2eParentCandidate(parentManifest, plan, m);
  validateManagedE2eIdentityManifest(role, m);
  const verifyResources = () =>
    validateManagedE2eResources(
      m,
      docker('container', m.parentContainerId),
      docker('container', m.containerId),
      docker('network', m.networkId),
      docker('volume', m.volume),
      plan,
      receipt,
    );
  verifyResources();
  assert.deepEqual(candidate(root), m.candidate);
  const url = new URL(databaseUrl);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, m.host);
  assert.equal(url.port, String(m.port));
  assert.equal(url.pathname, '/dev_cor_test');
  assert.equal(decodeURIComponent(url.username), 'dev_cor_test');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  const secret = regular(join(m.directory, 'postgres-test-password'));
  assert.equal(sha(secret), receipt.secretSha256);
  assert.ok(
    decodeURIComponent(url.password) === secret.toString('utf8'),
    'Database secret mismatch',
  );
  const require = createRequire(join(resolve(root), 'backend/package.json')),
    { Client } = require('pg');
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    application_name: `managed-e2e-admission-${m.runId}`,
  });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actual = (
      await client.query(
        "SELECT current_database() db,current_user usr,current_schema() schema,current_setting('transaction_read_only') readonly",
      )
    ).rows[0];
    assert.deepEqual(actual, {
      db: 'dev_cor_test',
      usr: 'dev_cor_test',
      schema: 'public',
      readonly: 'on',
    });
    const ledger = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    validateManagedE2eLedger(ledger, m.candidate.migrations);
    const ids = role.actors.map((a) => a.id),
      roleIds = role.actors.map((a) => a.roleId);
    const tables = {};
    for (const name of [
      'user_accounts',
      'department_memberships',
      'role_assignments',
      'role_templates',
      'role_grants',
    ]) {
      const column =
        name === 'user_accounts'
          ? 'id'
          : ['department_memberships', 'role_assignments'].includes(name)
            ? 'user_id'
            : name === 'role_templates'
              ? 'id'
              : 'role_template_id';
      tables[name] = (
        await client.query(
          `SELECT to_jsonb(x) row FROM ${name} x WHERE ${column}=ANY($1::uuid[]) ORDER BY id`,
          [['role_templates', 'role_grants'].includes(name) ? roleIds : ids],
        )
      ).rows;
    }
    tables.local_credentials = (
      await client.query(
        "SELECT to_jsonb(x)-'password_hash' row FROM local_credentials x WHERE user_id=ANY($1::uuid[]) ORDER BY id",
        [ids],
      )
    ).rows;
    assert.deepEqual(tables, role.tables, 'Synthetic foundation changed');
    const roleUsers = (
      await client.query(
        'SELECT user_id FROM role_assignments WHERE role_template_id=ANY($1::uuid[]) ORDER BY user_id',
        [roleIds],
      )
    ).rows;
    assert.deepEqual(
      roleUsers.map((x) => x.user_id).sort(),
      [...ids].sort(),
      'Role is shared outside admitted synthetic actors',
    );
    for (const actor of role.actors) {
      const user = tables.user_accounts.find((x) => x.row.id === actor.id)?.row;
      assert.ok(user && user.active && user.account_type === 'INTERNAL');
      assert.equal(user.external_subject, actor.externalSubject);
      assert.equal(user.authorization_revision, actor.authorizationRevision);
      const credentials = tables.local_credentials.filter(
        (x) => x.row.user_id === actor.id,
      );
      assert.equal(credentials.length, 1);
      assert.equal(credentials[0].row.username, actor.username);
      const memberships = tables.department_memberships.filter(
        (x) => x.row.user_id === actor.id,
      );
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0].row.department_id, role.departmentId);
      assert.equal(memberships[0].row.active, true);
      const assignments = tables.role_assignments.filter(
        (x) => x.row.user_id === actor.id,
      );
      assert.equal(assignments.length, 1);
      assert.equal(assignments[0].row.role_template_id, actor.roleId);
      assert.equal(assignments[0].row.department_id, role.departmentId);
      assert.equal(assignments[0].row.active, true);
      const template = tables.role_templates.find(
        (x) => x.row.id === actor.roleId,
      )?.row;
      assert.ok(template?.active);
      assert.equal(template.department_id, role.departmentId);
      assert.deepEqual(
        tables.role_grants
          .filter((x) => x.row.role_template_id === actor.roleId)
          .map((x) => ({ action: x.row.action, scope: x.row.scope }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        [...actor.grants].sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        ),
      );
    }
    await client.query('ROLLBACK');
    verifyResources();
    assert.deepEqual(candidate(root), m.candidate);
    assert.equal(sha(regular(manifestPath)), manifestSha256);
    boundJson(m.parentManifestPath, m.parentManifestSha256);
    boundJson(m.planPath, m.planSha256);
    boundJson(m.receiptPath, m.receiptSha256);
    boundJson(m.rolePath, m.roleSha256);
    assert.equal(
      sha(regular(join(m.directory, 'postgres-test-password'))),
      receipt.secretSha256,
    );
    return Object.freeze({
      kind: 'controlled-managed-e2e-readonly-admission',
      runId: m.runId,
      parentRunId: m.parentRunId,
      containerId: m.containerId,
      manifestSha256,
      candidateSha256: m.candidateSha256,
      migrationCount: ledger.length,
      actorIds: Object.freeze(ids),
      scope:
        'No fixture creation, legacy admission override, test execution or future write authorization',
    });
  } finally {
    await client.end();
  }
}
