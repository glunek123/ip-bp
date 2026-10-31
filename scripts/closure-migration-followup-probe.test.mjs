import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runProbe,
  target,
  assertBinding,
  assertOriginalMigration,
  readIsolatedConfiguration,
  dockerDesktopSecretSource,
  verifyPrivateFile,
} from './closure-migration-followup-probe.mjs';

test(
  'Windows private ACL verification survives incompatible inherited module autoload and rejects a public read grant',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'closure-private-acl-compat-'),
    );
    const file = join(directory, 'compatibility-only.txt');
    const oldModulePath = process.env.PSModulePath;
    const quoted = (value) => value.replaceAll("'", "''");
    const shell = (script) => {
      try {
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
      } catch {
        throw new Error('Windows ACL compatibility setup failed');
      }
    };
    try {
      // Establish a private directory before writing the non-secret test file.
      shell(
        `$ErrorActionPreference='Stop';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'));[IO.Directory]::SetAccessControl('${quoted(directory)}',$acl)`,
      );
      writeFileSync(file, 'non-secret compatibility fixture');
      const moduleRoot = join(directory, 'modules');
      const shadowModule = join(moduleRoot, 'Microsoft.PowerShell.Security');
      mkdirSync(shadowModule, { recursive: true });
      writeFileSync(
        join(shadowModule, 'Microsoft.PowerShell.Security.psd1'),
        "@{RootModule='shadow.psm1';ModuleVersion='99.0';GUID='00000000-0000-4000-8000-000000000099';FunctionsToExport=@('Get-Acl');CmdletsToExport=@();AliasesToExport=@()}",
      );
      writeFileSync(
        join(shadowModule, 'shadow.psm1'),
        "function Get-Acl { throw 'Incompatible inherited module' }; Export-ModuleMember -Function Get-Acl",
      );
      process.env.PSModulePath = moduleRoot;
      let privateAccepted = false;
      try {
        verifyPrivateFile(file);
        privateAccepted = true;
      } catch {
        /* fixed assertion below omits raw errors */
      }
      assert.equal(
        privateAccepted,
        true,
        'The private ACL must pass despite an incompatible inherited module',
      );
      shell(
        `$ErrorActionPreference='Stop';$acl=[IO.File]::GetAccessControl('${quoted(file)}');$sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'Read','Allow'));[IO.File]::SetAccessControl('${quoted(file)}',$acl)`,
      );
      let publicRejected = false;
      try {
        verifyPrivateFile(file);
      } catch {
        publicRejected = true;
      }
      assert.equal(
        publicRejected,
        true,
        'A public read grant must still be rejected',
      );
    } finally {
      if (oldModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = oldModulePath;
      rmSync(directory, { recursive: true });
    }
  },
);

const hash = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const binding = {
    containerId: 'a'.repeat(64),
    networkId: 'b'.repeat(64),
    volumeName: `${target.project}-pgdata`,
    secretPath: 'C:\\temporary\\secret',
    secretDockerSource: '/run/desktop/mnt/host/c/temporary/secret',
    runId: '00000000-0000-4000-8000-000000000001',
    imageId: `sha256:${'c'.repeat(64)}`,
    repoDigest: `postgres@${target.image.split('@')[1]}`,
    before: { projects: [], containerIds: [], volumeNames: [], networkIds: [] },
  };
  const labels = {
    'com.docker.compose.project': target.project,
    'dev-cor.closure-acceptance.run': binding.runId,
  };
  const container = {
    Id: binding.containerId,
    Image: binding.imageId,
    State: { Running: true, Health: { Status: 'healthy' } },
    Config: {
      Image: target.image,
      Labels: labels,
      Env: [
        'POSTGRES_USER=dev_cor_test',
        'POSTGRES_DB=dev_cor_test',
        'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
      ],
    },
    HostConfig: {
      PortBindings: {
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15442' }],
      },
    },
    Mounts: [
      {
        Type: 'volume',
        Name: binding.volumeName,
        Destination: '/var/lib/postgresql/data',
        RW: true,
      },
      {
        Type: 'bind',
        Source: binding.secretPath,
        Destination: '/run/secrets/postgres-password',
        RW: false,
      },
    ],
    NetworkSettings: {
      Networks: { dedicated: { NetworkID: binding.networkId } },
    },
  };
  const volume = { Name: binding.volumeName, Labels: labels };
  const network = {
    Id: binding.networkId,
    Name: `${target.project}_default`,
    Labels: labels,
  };
  const image = { Id: binding.imageId, RepoDigests: [binding.repoDigest] };
  const sql = '-- synthetic migration only\nSELECT 1;';
  const plan = {
    manifest: {
      migrations: Array.from({ length: 245 }, (_, index) => ({
        name: `${20260000000000 + index}_synthetic`,
        sha256: hash(sql),
      })),
    },
  };
  const calls = [];
  const guards = [
    {
      table_name: 'synthetic',
      name: 'original_guard',
      enabled: 'O',
      definition: 'synthetic',
      function_definition: 'synthetic',
    },
    ...[
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
    ].map(([table_name, name, function_name]) => ({
      table_name,
      name,
      function_name,
      enabled: 'O',
      deferrable: false,
      trigger_type: 31,
      function_in_schema: true,
      returns_trigger: true,
      definition: 'synthetic',
      function_definition: 'synthetic',
    })),
  ];
  const client = {
    query: async (query) => {
      calls.push(query);
      if (query.startsWith('SELECT current_database()'))
        return {
          rows: [
            {
              database: 'dev_cor_test',
              username: 'dev_cor_test',
              replication_role: 'origin',
              objects: 0,
            },
          ],
        };
      if (query.startsWith('SELECT current_setting'))
        return { rows: [{ role: 'origin' }] };
      if (query.startsWith('SELECT c.relname')) return { rows: clone(guards) };
      if (query.startsWith('INSERT INTO'))
        throw Object.assign(
          new Error(
            query.includes('"case_closure_payment_versions"')
              ? 'financial authorization requires serializable transaction'
              : 'case closure payment persistence is draft and not enabled',
          ),
          { code: '23514' },
        );
      return { rows: [] };
    },
    end: async () => {
      calls.push('END_CONNECTION');
    },
  };
  const historical = {
    ids: { caseId: '00000000-0000-4000-8000-000000000002' },
    snapshot: {
      cases: [
        {
          id: 'synthetic-id',
          stage: 'PENDING_MATCH',
          internal: 'must-not-appear-in-report',
        },
      ],
    },
  };
  const io = {
    seedHistoricalFixture: async (value, schema) => {
      assert.equal(value, client);
      assert.match(schema, /^closure_upgrade_[a-f0-9]{32}$/u);
      calls.push('SEED_196');
      return clone(historical);
    },
    snapshotHistoricalFixture: async (value, schema, ids) => {
      assert.equal(value, client);
      assert.match(schema, /^closure_upgrade_[a-f0-9]{32}$/u);
      assert.deepEqual(ids, historical.ids);
      calls.push('SNAPSHOT_245');
      return clone(historical.snapshot);
    },
    acquireLock: async () => ({
      release: async () => {
        calls.push('RELEASE_LOCK');
      },
    }),
    capturePlan: async () => clone(plan),
    inspect: async () => [container, volume, network, image],
    readConfiguration: async () => {
      calls.push('READ_ISOLATED_CONFIG');
      return {};
    },
    connect: async () => {
      calls.push('CONNECT');
      return client;
    },
    readMigration: async () => Buffer.from(sql),
  };
  return {
    args: { root: 'mock', plan, binding, candidateRoot: 'mock-temp' },
    io,
    calls,
    container,
    volume,
    network,
    image,
    guards,
    client,
  };
}

test('mock 245 replay and synthetic196→245 preserve selected fields, gates and report limits', async () => {
  const f = fixture();
  const result = await runProbe(f.args, f.io);
  assert.equal(
    result.status,
    'EMPTY_245_AND_SYNTHETIC_196_TO_245_AND_PAYMENT_GATE_PROBES_PASSED',
  );
  assert.equal(result.applied.public.length, 245);
  assert.equal(result.applied.upgrade.length, 245);
  assert.match(result.schemas[0], /^closure_upgrade_[a-f0-9]{32}$/u);
  assert.equal(
    result.historicalRows,
    'SYNTHETIC_EXTERNAL_PENDING_MATCH_SELECTED_FIELDS_PRESERVED',
  );
  assert.equal(
    f.calls
      .slice(0, f.calls.indexOf('SEED_196'))
      .filter((sql) => sql.startsWith('-- synthetic')).length,
    441,
  );
  assert.equal(
    f.calls
      .slice(0, f.calls.indexOf('SNAPSHOT_245'))
      .filter((sql) => sql.startsWith('-- synthetic')).length,
    490,
  );
  assert.equal(result.historicalEvidence.matches, true);
  assert.equal(result.historicalEvidence.rowCount, 1);
  assert.equal(result.historicalEvidence.tableCount, 1);
  assert.equal(
    result.historicalEvidence.beforeSha256,
    result.historicalEvidence.afterSha256,
  );
  assert.ok(!JSON.stringify(result).includes('must-not-appear-in-report'));
  assert.ok(!JSON.stringify(result).includes('synthetic-id'));
  assert.deepEqual(result.historicalNotCovered, [
    'ARCHIVE',
    'PAYMENT',
    'CONSOLIDATION',
    'ALL_COLUMNS',
  ]);
  assert.equal(result.positiveBusiness, 'BLOCKED');
  assert.equal(result.paymentProbes.length, 4);
  for (const row of result.paymentProbes) {
    assert.equal(row.draftGateCatalog, 'EXISTS_ENABLED_EXPECTED_FUNCTION');
    assert.equal(
      row.emptyInsertRejectedBy,
      row.table === 'case_closure_payment_versions'
        ? 'FINANCIAL_ACTOR_GUARD'
        : 'PAYMENT_DRAFT_GATE',
    );
    assert.equal(
      row.draftGateBehaviorDirectlyVerified,
      row.table === 'case_closure_payment_documents',
    );
  }
  assert.equal(
    f.calls.filter((sql) => sql.startsWith('INSERT INTO')).length,
    4,
  );
  assert.equal(f.calls.filter((sql) => sql.startsWith('BEGIN')).length, 4);
  assert.ok(f.calls.includes('END_CONNECTION'));
  assert.equal(f.calls.at(-1), 'RELEASE_LOCK');
  assert.equal(result.cleanup, 'RETAINED_FOR_PARENT_EXACT_ID_CLEANUP');
  assert.ok(
    !f.calls.some((sql) =>
      /DISABLE TRIGGER|DROP SCHEMA|DROP DATABASE|session_replication_role\s*=/iu.test(
        sql,
      ),
    ),
  );
});

test('synthetic row drift stops before upgraded gate probes without leaking selected field values', async () => {
  const f = fixture();
  f.io.snapshotHistoricalFixture = async () => ({
    cases: [{ internal: 'changed-secret-value' }],
  });
  const result = await runProbe(f.args, f.io);
  assert.equal(result.status, 'STOPPED');
  assert.equal(result.phase, 'SYNTHETIC_196_COMPARE');
  assert.equal(result.historicalEvidence.matches, false);
  assert.equal(result.historicalRows, 'SELECTED_FIELDS_DIFFER_AFTER_UPGRADE');
  assert.equal(
    f.calls.filter((sql) => sql.startsWith('INSERT INTO')).length,
    2,
  );
  assert.ok(!JSON.stringify(result).includes('changed-secret-value'));
});

test('synthetic fixture failure prevents remaining49 migrations and logs no arbitrary exception', async () => {
  const f = fixture();
  f.io.seedHistoricalFixture = async () => {
    throw new Error('private fixture contents');
  };
  const result = await runProbe(f.args, f.io);
  assert.equal(result.status, 'STOPPED');
  assert.equal(result.applied.upgrade.length, 196);
  assert.equal(result.historicalRows, 'NOT_STARTED');
  assert.ok(!JSON.stringify(result).includes('private fixture contents'));
});

test('rejects live identity/mount/port/label drift before reading credentials or connecting', async () => {
  const mutations = [
    (f) => {
      f.container.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0';
    },
    (f) => {
      f.container.Mounts[1].RW = true;
    },
    (f) => {
      f.container.Config.Labels['dev-cor.closure-acceptance.run'] = 'other';
    },
    (f) => {
      f.args.binding.before.containerIds.push(f.args.binding.containerId);
    },
    (f) => {
      f.container.Config.Env.push('POSTGRES_PASSWORD=do-not-log');
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    const result = await runProbe(f.args, f.io);
    assert.equal(result.status, 'STOPPED');
    assert.ok(!f.calls.includes('READ_ISOLATED_CONFIG'));
    assert.ok(!f.calls.includes('CONNECT'));
    assert.ok(!JSON.stringify(result).includes('do-not-log'));
  }
});

test('candidate drift and invalid full resource IDs stop before inspection/connect', async () => {
  for (const invalidId of [false, true]) {
    const f = fixture();
    let inspections = 0;
    f.io.inspect = async () => {
      inspections += 1;
      return [f.container, f.volume, f.network, f.image];
    };
    if (invalidId) f.args.binding.containerId = '--all';
    else f.io.capturePlan = async () => ({ drift: true });
    assert.equal((await runProbe(f.args, f.io)).status, 'STOPPED');
    assert.equal(inspections, 0);
    assert.ok(!f.calls.includes('CONNECT'));
  }
});

test('admission reports only fixed substage codes without raw error, path or credential details', async () => {
  const cases = [
    [
      'LOCK_ACQUIRE',
      (f) => {
        f.io.acquireLock = async () => {
          throw new Error('PRIVATE');
        };
      },
    ],
    [
      'PLAN_CAPTURE',
      (f) => {
        f.io.capturePlan = async () => {
          throw new Error('PRIVATE');
        };
      },
    ],
    [
      'PLAN_COMPARE',
      (f) => {
        f.io.capturePlan = async () => ({ changed: true });
      },
    ],
    [
      'BINDING_VALIDATE',
      (f) => {
        f.args.binding.containerId = '--all';
      },
    ],
    [
      'DOCKER_INSPECT',
      (f) => {
        f.io.inspect = async () => {
          throw new Error('PRIVATE');
        };
      },
    ],
    [
      'DOCKER_IDENTITY_VALIDATE',
      (f) => {
        f.container.State.Health.Status = 'starting';
      },
    ],
    [
      'CONFIGURATION',
      (f) => {
        f.io.readConfiguration = async () => {
          throw new Error('PRIVATE');
        };
      },
    ],
    [
      'DATABASE_CONNECT',
      (f) => {
        f.io.connect = async () => {
          throw new Error('PRIVATE');
        };
      },
    ],
    [
      'DATABASE_IDENTITY_AND_EMPTY',
      (f) => {
        f.client.query = async () => {
          throw new Error('PRIVATE');
        };
      },
    ],
  ];
  for (const [expected, mutate] of cases) {
    const f = fixture();
    mutate(f);
    const result = await runProbe(f.args, f.io);
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.phase, expected);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    assert.deepEqual(result.applied, { public: [], upgrade: [] });
  }
  for (const code of [
    'DOCKER_CONTAINER_INSPECT',
    'DOCKER_VOLUME_INSPECT',
    'DOCKER_NETWORK_INSPECT',
    'DOCKER_IMAGE_INSPECT',
    'CONFIG_IDENTITY',
    'CONFIG_LOCATION',
    'CONFIG_ACL',
    'CONFIG_CONTENT',
    'SECRET_ACL',
    'SECRET_MATCH',
  ]) {
    const f = fixture();
    const failAt = async (...args) => {
      args.at(-1)(code);
      throw new Error('PRIVATE');
    };
    if (code.startsWith('DOCKER')) f.io.inspect = failAt;
    else f.io.readConfiguration = failAt;
    const result = await runProbe(f.args, f.io);
    assert.equal(result.phase, code);
    assert.equal(result.status, 'STOPPED');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  const f = fixture();
  f.io.readConfiguration = async (...args) => {
    args.at(-1)('PRIVATE:credential-path');
  };
  const result = await runProbe(f.args, f.io);
  assert.equal(result.phase, 'CONFIGURATION');
  assert.ok(!JSON.stringify(result).includes('credential-path'));
});

test('repository manifest digest is not substituted for Docker image config ID', async () => {
  const mutations = [
    (f) => {
      f.container.Image = target.image.split('@')[1];
    },
    (f) => {
      f.args.binding.imageId = target.image.split('@')[1];
    },
    (f) => {
      f.image.Id = `sha256:${'d'.repeat(64)}`;
    },
    (f) => {
      f.image.RepoDigests = [`postgres@sha256:${'d'.repeat(64)}`];
    },
    (f) => {
      f.args.binding.repoDigest = `postgres@sha256:${'d'.repeat(64)}`;
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.equal((await runProbe(f.args, f.io)).status, 'STOPPED');
    assert.ok(!f.calls.includes('READ_ISOLATED_CONFIG'));
    assert.ok(!f.calls.includes('CONNECT'));
  }
});

test('only the exact Windows secret or its independently derived Docker Desktop source is admitted', async () => {
  const valid = fixture();
  valid.container.Mounts[1].Source = valid.args.binding.secretDockerSource;
  assert.equal(
    (await runProbe(valid.args, valid.io)).status,
    'EMPTY_245_AND_SYNTHETIC_196_TO_245_AND_PAYMENT_GATE_PROBES_PASSED',
  );
  const mutations = [
    (f) => {
      f.args.binding.secretDockerSource =
        '/run/desktop/mnt/host/c/other/secret';
      f.container.Mounts[1].Source = f.args.binding.secretDockerSource;
    },
    (f) => {
      f.container.Mounts[1].Source =
        '/run/desktop/mnt/host/c/temporary/../temporary/secret';
    },
    (f) => {
      f.container.Mounts[1].Source = '/host_mnt/c/temporary/secret';
    },
    (f) => {
      f.container.Mounts[1].Source = '/run/desktop/mnt/host/c/Temporary/secret';
    },
    (f) => {
      f.container.Mounts[1].Source = f.args.binding.secretDockerSource;
      f.container.Mounts[1].RW = true;
    },
    (f) => {
      f.container.NetworkSettings.Networks.dedicated.NetworkID = 'd'.repeat(64);
    },
    (f) => {
      f.container.State.Health.Status = 'starting';
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.equal((await runProbe(f.args, f.io)).status, 'STOPPED');
    assert.ok(!f.calls.includes('CONNECT'));
  }
  assert.equal(
    dockerDesktopSecretSource(
      'C:\\Users\\97830\\AppData\\Local\\Temp\\postgres-password',
    ),
    '/run/desktop/mnt/host/c/Users/97830/AppData/Local/Temp/postgres-password',
  );
  for (const path of [
    '\\\\host\\secret',
    '\\\\?\\C:\\secret',
    'C:\\foo\\..\\secret',
    'C:\\foo\\.\\secret',
    'C:\\foo\\\\secret',
    'C:\\foo\\secret:stream',
    'C:\\foo \\secret',
    'C:/foo/secret',
  ])
    assert.throws(() => dockerDesktopSecretSource(path));
});

test('a migration error stops without retrying and keeps exact resources for parent cleanup', async () => {
  const f = fixture();
  const original = f.client.query;
  f.client.query = async (sql) => {
    if (sql.startsWith('-- synthetic'))
      throw Object.assign(new Error('sensitive arbitrary message'), {
        code: '42601',
      });
    return original(sql);
  };
  const result = await runProbe(f.args, f.io);
  assert.equal(result.status, 'STOPPED');
  assert.equal(result.sqlstate, '42601');
  assert.equal(result.applied.public.length, 0);
  assert.equal(result.applied.upgrade.length, 0);
  assert.ok(!JSON.stringify(result).includes('sensitive'));
  assert.equal(f.calls.at(-1), 'RELEASE_LOCK');
});

test('only exact known gate error counts as rejection; successful illegal write also fails', async () => {
  for (const code of ['23502', '23514', 'SUCCESS']) {
    const f = fixture();
    const original = f.client.query;
    f.client.query = async (sql) => {
      if (sql.startsWith('INSERT INTO')) {
        if (code === 'SUCCESS') return { rows: [] };
        throw Object.assign(new Error('unrelated constraint'), { code });
      }
      return original(sql);
    };
    assert.equal((await runProbe(f.args, f.io)).status, 'STOPPED');
    assert.equal(f.calls.filter((sql) => sql === 'BEGIN').length, 1);
    assert.ok(f.calls.filter((sql) => sql === 'ROLLBACK').length >= 1);
  }
});

test('both draft gates and the earlier actor guard require exact enabled trigger identities before inserts', async () => {
  const mutations = [
    (f) => {
      f.guards.splice(1, 1);
    },
    (f) => {
      f.guards[2].function_name = 'other_function';
    },
    (f) => {
      f.guards[1].function_in_schema = false;
    },
    (f) => {
      f.guards[1].trigger_type = 7;
    },
    (f) => {
      f.guards[3].returns_trigger = false;
    },
    (f) => {
      f.guards.push(clone(f.guards[1]));
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    const result = await runProbe(f.args, f.io);
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.phase, 'PAYMENT_GUARD_CATALOG');
    assert.equal(
      f.calls.filter((sql) => sql.startsWith('INSERT INTO')).length,
      0,
    );
  }
});

test('actor/draft trigger order is table-specific and cannot accept the other known rejection', async () => {
  for (const wrongTable of [
    'case_closure_payment_versions',
    'case_closure_payment_documents',
  ]) {
    const f = fixture();
    const original = f.client.query;
    f.client.query = async (sql) => {
      if (sql.startsWith(`INSERT INTO "${wrongTable}"`))
        throw Object.assign(
          new Error(
            wrongTable === 'case_closure_payment_versions'
              ? 'case closure payment persistence is draft and not enabled'
              : 'financial authorization requires serializable transaction',
          ),
          { code: '23514' },
        );
      return original(sql);
    };
    const result = await runProbe(f.args, f.io);
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.phase, 'PAYMENT_GATE_PROBE');
    assert.equal(
      result.paymentProbes.length,
      wrongTable === 'case_closure_payment_versions' ? 0 : 1,
    );
  }
});

test('disabled original guard fails and the shared-lock conflict never accesses services', async () => {
  const f = fixture();
  f.guards[0].enabled = 'D';
  assert.equal((await runProbe(f.args, f.io)).status, 'STOPPED');
  const conflict = fixture();
  conflict.io.acquireLock = async () => {
    throw new Error('already held');
  };
  assert.equal((await runProbe(conflict.args, conflict.io)).status, 'STOPPED');
  assert.deepEqual(conflict.calls, []);
});

test('resource identity assertion and historic bypass whitelist are exact', () => {
  const f = fixture();
  assert.doesNotThrow(() =>
    assertBinding(f.args.binding, f.container, f.volume, f.network, f.image),
  );
  const name = '20260928030000_add_notary_accounts_and_opening_actor';
  const disable =
    'ALTER TABLE "notary_matter_opening" DISABLE TRIGGER reject_notary_opening_update_delete;';
  assert.doesNotThrow(() =>
    assertOriginalMigration(
      name,
      `${disable}\n${disable.replace('DISABLE', 'ENABLE')}`,
    ),
  );
  assert.throws(() => assertOriginalMigration(name, disable));
  assert.throws(() => assertOriginalMigration('synthetic', disable));
  assert.throws(() =>
    assertOriginalMigration(
      'synthetic',
      "SET session_replication_role='replica'",
    ),
  );
});

test('connection or lock cleanup failure cannot be reported as passing', async () => {
  for (const cleanup of ['connection', 'lock']) {
    const f = fixture();
    if (cleanup === 'connection')
      f.client.end = async () => {
        throw new Error('cleanup');
      };
    else
      f.io.acquireLock = async () => ({
        release: async () => {
          throw new Error('cleanup');
        },
      });
    assert.equal((await runProbe(f.args, f.io)).status, 'STOPPED');
  }
});

test('isolated config loader rejects original directory before touching its env and validates fixed URL', () => {
  const original = mkdtempSync(join(tmpdir(), 'closure-probe-test-original-'));
  const candidate = mkdtempSync(
    join(tmpdir(), 'closure-probe-test-candidate-'),
  );
  try {
    let permissionChecks = 0;
    const permissions = () => {
      permissionChecks += 1;
    };
    assert.throws(
      () => readIsolatedConfiguration(original, original, permissions),
      /Closed migration probe rejected/u,
    );
    assert.equal(permissionChecks, 0);
    mkdirSync(join(candidate, 'backend'));
    const path = join(candidate, 'backend/.env.test');
    const password = 'a'.repeat(43);
    writeFileSync(
      path,
      `NODE_ENV=test\nDATABASE_URL=postgresql://dev_cor_test:${password}@127.0.0.1:15442/dev_cor_test\n`,
    );
    assert.ok(
      readIsolatedConfiguration(original, candidate, permissions)
        .connectionString,
    );
    assert.equal(permissionChecks, 1);
    for (const suffix of [
      ':15440/dev_cor_test',
      ':15442/other_database',
      ':15442/dev_cor_test?options=bypass',
    ]) {
      writeFileSync(
        path,
        `DATABASE_URL=postgresql://dev_cor_test:${password}@127.0.0.1${suffix}`,
      );
      assert.throws(() =>
        readIsolatedConfiguration(original, candidate, permissions),
      );
    }
    assert.throws(
      () =>
        readIsolatedConfiguration(original, candidate, () => {
          throw new Error('ACL not private');
        }),
      /ACL not private/u,
    );
  } finally {
    // Both paths were created above solely for this mock config test.
    rmSync(original, { recursive: true });
    rmSync(candidate, { recursive: true });
  }
});
