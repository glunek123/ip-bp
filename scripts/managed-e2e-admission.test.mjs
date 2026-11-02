import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  validateManagedE2eTuple,
  validateManagedE2eParentCandidate,
  validateManagedE2eResources,
  validateManagedE2eIdentityManifest,
  admitManagedE2e,
  validateManagedE2eLedger,
} from './managed-e2e-admission.mjs';
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    throw Error('Offline test must not inspect Docker or execute a process');
  }),
}));
const hash = (x) => createHash('sha256').update(x).digest('hex');
function fixture() {
  const project = 'dev-cor-closure-flow-20261030',
    runId = '11111111-1111-4111-8111-111111111111',
    parentRunId = '1f9e329d-ca0e-40f0-afd4-45bc1c1e0665',
    parentPrivateRoot = join(tmpdir(), `${project}-${parentRunId}`),
    directory = join(parentPrivateRoot, 'managed-gates', runId);
  const candidate = {
    migrations: Array.from({ length: 266 }, (_, i) => ({
      name: `migration-${i}`,
      sha256: 'f'.repeat(64),
    })),
  };
  const m = {
    schemaVersion: 1,
    purpose: 'controlled-synthetic-managed-e2e',
    project,
    runId,
    parentRunId,
    parentContainerId: 'a'.repeat(64),
    containerId: 'b'.repeat(64),
    networkId: 'c'.repeat(64),
    image:
      'postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0',
    host: '127.0.0.1',
    port: 15446,
    database: 'dev_cor_test',
    username: 'dev_cor_test',
    name: `${project}-postgres-test-1`,
    volume: `${project}-test-11111111-pgdata`,
    parentPrivateRoot,
    directory,
    planPath: join(directory, 'managed-gate-plan.json'),
    receiptPath: join(directory, 'managed-gate-receipt.json'),
    rolePath: join(directory, 'managed-e2e-identities.json'),
    candidate,
    candidateSha256: hash(JSON.stringify(candidate)),
  };
  for (const k of [
    'parentManifestSha256',
    'planSha256',
    'receiptSha256',
    'roleSha256',
    'admissionModuleSha256',
  ])
    m[k] = 'd'.repeat(64);
  const labels = (run) => ({
    'com.docker.compose.project': project,
    'dev-cor.acceptance.run': run,
  });
  const container = (id, run, port) => ({
    Id: id,
    Image: m.image.split('@')[1],
    Config: { Image: m.image, Labels: labels(run), Env: [] },
    HostConfig: {
      NetworkMode: m.networkId,
      PortBindings: {
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }],
      },
    },
    NetworkSettings: {
      Networks: { owned: { NetworkID: m.networkId } },
      Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
    },
    State: { Running: true, Health: { Status: 'healthy' } },
    Mounts: [],
  });
  const parent = container(m.parentContainerId, parentRunId, 15445),
    child = container(m.containerId, runId, 15446);
  child.Name = `/${m.name}`;
  Object.assign(child.Config.Labels, {
    'dev-cor.acceptance.parent': parentRunId,
    'com.docker.compose.service': 'postgres-test',
    'com.docker.compose.container-number': '1',
  });
  child.Config.Env = [
    'POSTGRES_DB=dev_cor_test',
    'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-test-password',
    'POSTGRES_USER=dev_cor_test',
  ];
  child.Mounts = [
    { Type: 'volume', Name: m.volume, Destination: '/var/lib/postgresql/data' },
    {
      Type: 'bind',
      Source:
        '/run/desktop/mnt/host/' +
        directory[0].toLowerCase() +
        directory.slice(2).replaceAll('\\', '/') +
        '/postgres-test-password',
      Destination: '/run/secrets/postgres-test-password',
      RW: false,
    },
  ];
  const network = {
      Id: m.networkId,
      Name: `${project}_default`,
      Labels: labels(parentRunId),
      Containers: { [m.parentContainerId]: {}, [m.containerId]: {} },
    },
    volume = {
      Name: m.volume,
      Labels: { ...labels(runId), 'dev-cor.acceptance.parent': parentRunId },
    };
  const plan = {
    parentProject: project,
    image: m.image,
    port: m.port,
    name: m.name,
    volume: m.volume,
    parentPrivateRoot: m.parentPrivateRoot,
    parentRunId,
    runId,
    parentContainerId: m.parentContainerId,
    parentNetworkId: m.networkId,
    directory,
    frozen: candidate,
    parentInvariant: {
      id: parent.Id,
      image: parent.Image,
      labels: parent.Config.Labels,
      environment: parent.Config.Env,
      bindings: parent.HostConfig.PortBindings,
      mounts: parent.Mounts,
      networkMode: parent.HostConfig.NetworkMode,
    },
  };
  const receipt = {
    runId,
    parentRunId,
    planSha256: m.planSha256,
    containerId: m.containerId,
    state: 'REAL_MANAGED_TEST_CONTAINER_HEALTHY',
    parentContainerId: m.parentContainerId,
    port: m.port,
    name: m.name,
    volume: m.volume,
  };
  return { m, parent, child, network, volume, plan, receipt };
}
const check = (f) =>
  validateManagedE2eResources(
    f.m,
    f.parent,
    f.child,
    f.network,
    f.volume,
    f.plan,
    f.receipt,
  );
test('strict controlled tuple and resource snapshot are internally consistent, not live admission', () => {
  const f = fixture();
  validateManagedE2eTuple(f.m);
  check(f);
  assert.equal(execFileSync.mock.calls.length, 0);
});
for (const [field, value] of [
  ['project', 'legacy'],
  ['parentRunId', '22222222-2222-4222-8222-222222222222'],
  ['containerId', 'short'],
  ['port', 15433],
  ['port', 15445],
  ['database', 'dev_cor_closure_flow'],
  ['username', 'postgres'],
  ['host', 'localhost'],
  ['image', 'postgres:latest'],
  ['candidateSha256', 'a'.repeat(64)],
])
  test(`reject wrong ${field}=${value} before external work`, () => {
    const f = fixture();
    f.m[field] = value;
    assert.throws(() => validateManagedE2eTuple(f.m));
  });
for (const [label, mutate] of [
  [
    'extra actual network',
    (f) => {
      f.child.NetworkSettings.Networks.extra = { NetworkID: 'e'.repeat(64) };
    },
  ],
  [
    'foreign network participant',
    (f) => {
      f.network.Containers['e'.repeat(64)] = {};
    },
  ],
  [
    'wrong child run label',
    (f) => {
      f.child.Config.Labels['dev-cor.acceptance.run'] = 'foreign';
    },
  ],
  [
    'wrong parent identity',
    (f) => {
      f.parent.Id = 'e'.repeat(64);
    },
  ],
  [
    'wrong image id',
    (f) => {
      f.child.Image = 'sha256:foreign';
    },
  ],
  [
    'wrong service',
    (f) => {
      f.child.Config.Labels['com.docker.compose.service'] = 'postgres';
    },
  ],
  [
    'public bind',
    (f) => {
      f.child.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0';
    },
  ],
  [
    'unhealthy',
    (f) => {
      f.child.State.Health.Status = 'starting';
    },
  ],
  [
    'wrong volume',
    (f) => {
      f.volume.Name = 'foreign';
    },
  ],
  [
    'writable secret',
    (f) => {
      f.child.Mounts[1].RW = true;
    },
  ],
  [
    'legacy postgres database',
    (f) => {
      f.child.Config.Env[0] = 'POSTGRES_DB=dev_cor';
    },
  ],
  [
    'unbound receipt',
    (f) => {
      f.receipt.planSha256 = 'e'.repeat(64);
    },
  ],
])
  test(`reject ${label}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => check(f));
  });
test('synthetic actor manifest rejects legacy external subject and absent row evidence', () => {
  const { m } = fixture();
  const role = {
    runId: m.runId,
    departmentId: '22222222-2222-4222-8222-222222222222',
    actors: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        roleId: '44444444-4444-4444-8444-444444444444',
        externalSubject: 'legacy-actor',
        username: 'old',
        authorizationRevision: 1,
        grants: [{ action: 'case.read', scope: 'DEPARTMENT' }],
      },
    ],
    tables: {},
  };
  assert.throws(() => validateManagedE2eIdentityManifest(role, m));
  role.actors[0].externalSubject = `managed-e2e:${m.runId}:${role.actors[0].id}`;
  role.actors[0].username = 'managed.e2e.11111111.actor';
  assert.throws(() => validateManagedE2eIdentityManifest(role, m));
});
test('public admission rejects a raw-SHA-bound wrong tuple without Docker or SQL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-admission-offline-'));
  try {
    const { m } = fixture();
    m.port = 15445;
    const bytes = JSON.stringify(m),
      path = join(directory, 'manifest.json');
    writeFileSync(path, bytes);
    await assert.rejects(
      admitManagedE2e({
        root: directory,
        manifestPath: path,
        manifestSha256: hash(bytes),
        databaseUrl: 'postgresql://never-connect',
      }),
    );
    assert.equal(execFileSync.mock.calls.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('complete ledger rejects missing, checksum drift, unfinished and rolled-back rows', () => {
  const migrations = [
    { name: '001', sha256: 'a'.repeat(64) },
    { name: '002', sha256: 'b'.repeat(64) },
  ];
  const rows = migrations.map((x) => ({
    migration_name: x.name,
    checksum: x.sha256,
    finished_at: '2026-10-31',
    rolled_back_at: null,
  }));
  validateManagedE2eLedger(rows, migrations);
  for (const mutate of [
    (r) => r.pop(),
    (r) => {
      r[0].checksum = 'wrong';
    },
    (r) => {
      r[0].finished_at = null;
    },
    (r) => {
      r[0].rolled_back_at = 'today';
    },
    (r) => r.reverse(),
  ]) {
    const wrong = JSON.parse(JSON.stringify(rows));
    mutate(wrong);
    assert.throws(() => validateManagedE2eLedger(wrong, migrations));
  }
});

function parentMountFixture() {
  const f = fixture();
  f.parent.Mounts = [
    {
      Type: 'volume',
      Source: 'data-source',
      Destination: '/var/lib/postgresql/data',
      RW: true,
      Mode: 'z',
      Propagation: '',
    },
    {
      Type: 'bind',
      Source: 'secret-source',
      Destination: '/run/secrets/password',
      RW: false,
      Mode: 'ro',
      Propagation: 'rprivate',
    },
  ];
  f.plan.parentInvariant.mounts = globalThis.structuredClone(f.parent.Mounts);
  return f;
}
test('parent full Mounts order is not identity; immutable baseline remains unchanged', () => {
  const f = parentMountFixture();
  const before = globalThis.structuredClone(f.plan.parentInvariant);
  f.parent.Mounts.reverse();
  check(f);
  assert.deepEqual(f.plan.parentInvariant, before);
});
for (const [label, mutate] of [
  [
    'Source',
    (f) => {
      f.parent.Mounts[0].Source = 'foreign';
    },
  ],
  [
    'RW',
    (f) => {
      f.parent.Mounts[0].RW = false;
    },
  ],
  [
    'Mode',
    (f) => {
      f.parent.Mounts[0].Mode = 'foreign';
    },
  ],
  [
    'Propagation',
    (f) => {
      f.parent.Mounts[0].Propagation = 'foreign';
    },
  ],
  [
    'extra field',
    (f) => {
      f.parent.Mounts[0].unexpected = true;
    },
  ],
  [
    'missing field',
    (f) => {
      delete f.parent.Mounts[0].Mode;
    },
  ],
  [
    'extra mount',
    (f) => {
      f.parent.Mounts.push({ ...f.parent.Mounts[0], Destination: '/extra' });
    },
  ],
  [
    'duplicate actual destination',
    (f) => {
      f.parent.Mounts.push({ ...f.parent.Mounts[0] });
    },
  ],
  [
    'duplicate stored destination',
    (f) => {
      f.plan.parentInvariant.mounts.push({
        ...f.plan.parentInvariant.mounts[0],
      });
    },
  ],
])
  test(`parent mount rejects ${label}`, () => {
    const f = parentMountFixture();
    mutate(f);
    assert.throws(() => check(f));
  });

// Synthetic protocol fixtures only: no workstation manifest or private evidence.
function parentCandidateFixture() {
  const { m, plan } = fixture();
  const current = {
    ...globalThis.structuredClone(m.candidate),
    gitHead: '1'.repeat(40),
    migrations: Array.from({ length: 269 }, (_, i) => ({
      name: `migration-${i}`,
      sha256: 'f'.repeat(64),
    })),
  };
  const schema = {
    ...globalThis.structuredClone(current),
    gitHead: '2'.repeat(40),
  };
  const candidateHash = (value) => hash(JSON.stringify(value));
  const parent = {
    purpose: 'CODE_CANDIDATE_ONLY',
    codeOnly: true,
    state: 'CODE_EXPECTATION_NOT_INSTALLED_DATABASE',
    candidate: schema,
    artifactCandidateSha256: candidateHash(schema),
    currentCodeCandidate: current,
    currentCodeCandidateSha256: candidateHash(current),
    parentInstalledManifestPath: join(m.parentPrivateRoot, 'installed.json'),
    parentInstalledManifestSha256: 'b'.repeat(64),
  };
  Object.assign(plan, {
    frozen: globalThis.structuredClone(current),
    currentCodeCandidateSha256: candidateHash(current),
    schemaCandidateSha256: candidateHash(schema),
    codeResourceView: {
      manifestPath: join(m.directory, 'view.json'),
      manifestSha256: 'c'.repeat(64),
    },
    parentInstalledManifestPath: parent.parentInstalledManifestPath,
    parentInstalledManifestSha256: parent.parentInstalledManifestSha256,
  });
  Object.assign(m, {
    candidate: globalThis.structuredClone(current),
    candidateSha256: candidateHash(current),
    parentManifestPath: plan.codeResourceView.manifestPath,
    parentManifestSha256: plan.codeResourceView.manifestSha256,
  });
  return { parent, plan, m };
}
test('strict CODE_ONLY parent binds current code while retaining historical schema', () => {
  const { parent, plan, m } = parentCandidateFixture();
  validateManagedE2eParentCandidate(parent, plan, m);
});
test('legacy parent still requires the original candidate', () => {
  const { m } = parentCandidateFixture();
  validateManagedE2eParentCandidate(
    { candidate: globalThis.structuredClone(m.candidate) },
    {},
    m,
  );
  assert.throws(() =>
    validateManagedE2eParentCandidate({ candidate: { wrong: true } }, {}, m),
  );
});
for (const [name, mutate] of Object.entries({
  wrongCurrent: ({ parent }) => (parent.currentCodeCandidate.gitHead = 'wrong'),
  wrongCurrentHash: ({ parent }) =>
    (parent.currentCodeCandidateSha256 = 'd'.repeat(64)),
  wrongPlanCurrent: ({ plan }) => (plan.frozen.gitHead = 'wrong'),
  wrongManifestCurrent: ({ m }) => (m.candidate.gitHead = 'wrong'),
  wrongSchema: ({ parent }) => (parent.candidate.gitHead = 'wrong'),
  wrongSchemaHash: ({ plan }) => (plan.schemaCandidateSha256 = 'd'.repeat(64)),
  wrongArtifactHash: ({ parent }) =>
    (parent.artifactCandidateSha256 = 'd'.repeat(64)),
  wrongSchemaCount: ({ parent }) => parent.candidate.migrations.pop(),
  wrongPurpose: ({ parent }) => (parent.purpose = 'legacy'),
  wrongState: ({ parent }) => (parent.state = 'INSTALLED'),
  wrongCodeOnly: ({ parent }) => (parent.codeOnly = false),
  wrongViewPath: ({ m }) => (m.parentManifestPath = 'other.json'),
  wrongViewHash: ({ m }) => (m.parentManifestSha256 = 'd'.repeat(64)),
  wrongInstalledPath: ({ parent }) =>
    (parent.parentInstalledManifestPath = 'other.json'),
  wrongInstalledHash: ({ parent }) =>
    (parent.parentInstalledManifestSha256 = 'd'.repeat(64)),
  downgrade: ({ parent, m }) => {
    parent.purpose = 'legacy';
    parent.codeOnly = false;
    parent.candidate = globalThis.structuredClone(m.candidate);
  },
}))
  test(`CODE_ONLY rejects ${name}`, () => {
    const f = parentCandidateFixture();
    mutate(f);
    assert.throws(() =>
      validateManagedE2eParentCandidate(f.parent, f.plan, f.m),
    );
  });

for (const field of [
  'codeOnly',
  'currentCodeCandidate',
  'currentCodeCandidateSha256',
]) {
  for (const value of [undefined, false, 'partial'])
    test(`own parent marker ${field}=${String(value)} rejects legacy downgrade`, () => {
      const candidate = { gitHead: 'same' };
      assert.throws(() =>
        validateManagedE2eParentCandidate(
          { candidate, [field]: value },
          {},
          { candidate },
        ),
      );
    });
}
for (const field of ['codeResourceView', 'currentCodeCandidateSha256']) {
  for (const value of [undefined, {}, 'partial'])
    test(`own plan marker ${field}=${String(value)} rejects legacy downgrade`, () => {
      const candidate = { gitHead: 'same' };
      assert.throws(() =>
        validateManagedE2eParentCandidate(
          { candidate },
          { [field]: value },
          { candidate },
        ),
      );
    });
}
test('legacy plan shape retains original candidate comparison', () => {
  const candidate = { gitHead: 'same' },
    plan = {
      state: 'PREPARED_NOT_EXECUTED',
      frozen: candidate,
      parentRunId: 'legacy',
      parentContainerId: 'legacy',
    };
  validateManagedE2eParentCandidate({ candidate }, plan, { candidate });
  assert.throws(() =>
    validateManagedE2eParentCandidate(
      { candidate: { gitHead: 'other' } },
      plan,
      { candidate },
    ),
  );
});

test('partial current hash cannot downgrade to legacy equality', () => {
  const candidate = { gitHead: 'same' };
  assert.throws(() =>
    validateManagedE2eParentCandidate(
      { candidate, currentCodeCandidateSha256: 'a'.repeat(64) },
      {},
      { candidate },
    ),
  );
});
