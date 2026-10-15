import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const load = (path) => requireBackend(`./dist/${path}.js`);
const { PrismaClient } = load('generated/prisma/client');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { AccessControlService } = load('access-control/access-control.service');
const { PrismaAccessControlStore } = load(
  'access-control/prisma-access-control.store',
);
const { CustomerCaseEntrySourceService } = load(
  'modules/customers/customer-case-entry-source.service',
);
const { CaseExternalEntryService } = load(
  'modules/cases/case-external-entry.service',
);
const { CaseHearingService } = load('modules/cases/case-hearing.service');
const { CaseHearingSignal } = load('modules/cases/case-hearing-signal');
const { CaseHistoricalRecordEditService } = load(
  'modules/cases/case-historical-record-edit.service',
);
const { MaterialService } = load('modules/materials/material.service');
const { LocalPrivateBlobStorage } = load(
  'modules/materials/local-private-blob-storage',
);
const { MaterialStorageKeyCoordinator } = load(
  'modules/materials/material-storage-key-coordinator',
);

function candidate() {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  assert.equal(
    git('status', '--porcelain', '--untracked-files=normal'),
    '',
    'Freeze the candidate before DB acceptance',
  );
  return {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
  };
}

export function assertHearingEffectiveDateBridgeR2Binding(environment) {
  assert.ok(
    environment.NODE_ENV === 'test' &&
      environment.DEV_COR_TEST_DATABASE_PROJECT === 'dev-cor-ui003-r2' &&
      environment.DEV_COR_TEST_DATABASE_CONTAINER_ID ===
        '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
    'Hearing acceptance requires the exact authorized R2 project and container',
  );
  const target = validateIsolatedTestDatabaseUrl(
    environment.DEV_COR_TEST_DATABASE_URL,
    { allowRandomPort: true },
  );
  const effective = validateIsolatedTestDatabaseUrl(environment.DATABASE_URL, {
    allowRandomPort: true,
  });
  assert.ok(
    target.hostname === '127.0.0.1' &&
      target.port === 15438 &&
      effective.connectionString === target.connectionString &&
      effective.connectionString === environment.DEV_COR_TEST_DATABASE_URL,
    'Hearing acceptance requires matching effective and authorized R2 URLs on loopback port 15438',
  );
}

function capture() {
  // Reject stale or conflicting input before Docker capture or any DB connection.
  assertHearingEffectiveDateBridgeR2Binding(process.env);
  const pnpmVersion = (process.env.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/u,
  )?.[1];
  assert.ok(pnpmVersion, 'Use the protected pnpm E2E runner');
  const environment = captureTestEnvironment(root, { pnpmVersion });
  const target = validateBrowserTestDatabaseUrl(process.env.DATABASE_URL, root);
  assert.equal(
    target.connectionString,
    environment.childEnvironment.DATABASE_URL,
  );
  assert.equal(target.connectionString, process.env.DEV_COR_TEST_DATABASE_URL);
  return environment;
}

async function assertCurrentMigrations(database) {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 156);
  assert.equal(names.at(-1), '20261015150000_case_section_record_edits');
  const identity = await database.$queryRawUnsafe(
    'SELECT current_database() AS db,current_schema() AS schema',
  );
  assert.deepEqual(identity, [{ db: 'dev_cor_test', schema: 'public' }]);
  const applied = await database.$queryRawUnsafe(
    'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
  );
  assert.deepEqual(
    applied.map((row) => row.migration_name),
    names,
  );
  for (const [index, name] of names.entries()) {
    assert.ok(applied[index].finished_at);
    assert.equal(applied[index].rolled_back_at, null);
    const bytes = await readFile(resolve(migrationRoot, name, 'migration.sql'));
    assert.equal(
      applied[index].checksum,
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
}

function scopedDatabase(database, caseId, lockHook) {
  return new Proxy(database, {
    get(target, key) {
      if (key === 'case')
        return new Proxy(target.case, {
          get(delegate, operation) {
            if (operation === 'findMany')
              return (args) =>
                delegate.findMany({
                  ...args,
                  where: { ...args.where, id: caseId },
                });
            const value = Reflect.get(delegate, operation);
            return typeof value === 'function' ? value.bind(delegate) : value;
          },
        });
      if (key === '$transaction' && lockHook)
        return (callback, options) =>
          target.$transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(client, operation) {
                    if (operation === '$queryRawUnsafe')
                      return async (sql, ...values) => {
                        // Start the Prisma query before reporting a lock attempt;
                        // merely constructing its lazy promise does not execute it.
                        const pending = client
                          .$queryRawUnsafe(sql, ...values)
                          .then(
                            (value) => ({ status: 'fulfilled', value }),
                            (reason) => ({ status: 'rejected', reason }),
                          );
                        if (sql.includes('FOR UPDATE'))
                          await lockHook('attempt');
                        const result = await pending;
                        if (result.status === 'rejected') throw result.reason;
                        if (sql.includes('FOR UPDATE'))
                          await lockHook('acquired');
                        return result.value;
                      };
                    const value = Reflect.get(client, operation);
                    return typeof value === 'function'
                      ? value.bind(client)
                      : value;
                  },
                }),
              ),
            options,
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: () => resolvePromise() };
}

async function orderedRace(database, caseId, first, second) {
  const acquired = deferred(),
    attempted = deferred(),
    release = deferred();
  const lockEvents = [];
  let held = false;
  const winner = scopedDatabase(database, caseId, async (event) => {
    lockEvents.push(`first:${event}`);
    if (event === 'acquired' && !held) {
      held = true;
      acquired.resolve();
      await release.promise;
      lockEvents.push('first:barrier-released');
    }
  });
  const follower = scopedDatabase(database, caseId, async (event) => {
    lockEvents.push(`second:${event}`);
    if (event === 'attempt') attempted.resolve();
  });
  const firstResult = first(winner);
  // Observe both outcomes immediately, including a failure before the lock.
  const firstSettled = firstResult.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  await Promise.race([
    acquired.promise,
    firstSettled.then(() => {
      throw new Error('First command settled without acquiring the case lock');
    }),
  ]);
  const secondResult = second(follower);
  const secondSettled = secondResult.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  let barrierError;
  try {
    await Promise.race([
      attempted.promise,
      secondSettled.then(() => {
        throw new Error(
          'Second command settled without attempting the case lock',
        );
      }),
    ]);
  } catch (error) {
    barrierError = error;
  } finally {
    release.resolve();
  }
  const outcomes = await Promise.all([firstSettled, secondSettled]);
  if (barrierError) throw barrierError;
  const requiredEvents = [
    'first:acquired',
    'second:attempt',
    'first:barrier-released',
    'second:acquired',
  ];
  let previous = -1;
  for (const event of requiredEvents) {
    const index = lockEvents.indexOf(event);
    assert.ok(
      index > previous,
      `Missing or out-of-order case lock event: ${event}`,
    );
    previous = index;
  }
  return { outcomes, lockEvents };
}

async function seedOwner(database) {
  const departmentId = randomUUID(),
    userId = randomUUID(),
    roleId = randomUUID();
  const customerId = randomUUID(),
    rightsHolderId = randomUUID();
  await database.$transaction(async (tx) => {
    await tx.department.create({
      data: { id: departmentId, name: `Hearing chain ${departmentId}` },
    });
    await tx.userAccount.create({
      data: {
        id: userId,
        externalSubject: `hearing-chain-${userId}`,
        displayName: 'Synthetic hearing operator',
      },
    });
    await tx.departmentMembership.create({ data: { userId, departmentId } });
    await tx.roleTemplate.create({
      data: { id: roleId, departmentId, name: `Hearing chain ${roleId}` },
    });
    for (const action of [
      'customer.read',
      'case.read',
      'case.external-entry.create',
      'case.hearing.schedule',
      'case.hearing.correct',
    ]) {
      await tx.$executeRawUnsafe(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1::uuid,$2::uuid,$3::permission_action,'DEPARTMENT')",
        randomUUID(),
        roleId,
        action,
      );
    }
    await tx.roleAssignment.create({
      data: { userId, departmentId, roleTemplateId: roleId },
    });
    await tx.customer.create({
      data: {
        id: customerId,
        name: `Hearing chain ${customerId}`,
        normalizedName: `Hearing chain ${customerId}`,
        departmentId,
        responsibleUserId: userId,
        profileStatus: 'ADMITTED',
        customerType: 'ENTERPRISE',
        identityType: 'BUSINESS_LICENSE',
        identityNumber: customerId,
        normalizedIdentityNumber: customerId,
        identityValidityMode: 'LONG_TERM',
        admittedAt: new Date(),
        admissionContactName: 'Synthetic contact',
        admissionContactPhone: '13800000000',
        admissionContactSnapshotName: 'Synthetic contact',
        admissionContactSnapshotPhone: '13800000000',
        admissionContactSnapshotSource: 'NEW_ADMISSION',
        admissionContactSnapshotFrozenAt: new Date(),
      },
    });
    await tx.rightsHolder.create({
      data: {
        id: rightsHolderId,
        name: `Hearing chain ${rightsHolderId}`,
        departmentId,
      },
    });
    await tx.customerRightsHolderLink.create({
      data: { customerId, rightsHolderId, departmentId },
    });
  });
  return {
    actor: { userId, departmentId, authorizationRevision: 1 },
    customerId,
    rightsHolderId,
  };
}

export async function verifyHearingEffectiveDateBridge() {
  const environment = capture(),
    source = candidate();
  const database = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: environment.childEnvironment.DATABASE_URL,
    }),
  });
  try {
    await assertCurrentMigrations(database);
    const owner = await seedOwner(database),
      { actor } = owner;
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const entries = new CaseExternalEntryService(
      database,
      access,
      new CustomerCaseEntrySourceService(database, access),
    );
    const materials = new MaterialService(
      database,
      access,
      new LocalPrivateBlobStorage(
        environment.childEnvironment.PRIVATE_FILE_ROOT,
      ),
      new MaterialStorageKeyCoordinator(),
    );
    const edit = (db) =>
      new CaseHistoricalRecordEditService(db, access, materials);
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const day = (offset) =>
      new Date(
        new Date(`${today}T00:00:00.000Z`).getTime() + offset * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
    const past = day(-2),
      future = day(2),
      floor = day(-10);
    const hearing = (db, at = now) =>
      new CaseHearingService(db, access, new CaseHearingSignal(), {
        now: () => at,
      });
    const head = (caseId) =>
      database.case.findUniqueOrThrow({ where: { id: caseId } });
    const caseIds = [];
    const createCase = async (hearingAt) => {
      const entry = await entries.create(actor, {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'WAITING_HEARING',
        stageReachedOn: floor,
        source: `Hearing effective bridge ${randomUUID()}`,
        reason: 'Synthetic current-source fixture',
        customerId: owner.customerId,
        rightsHolderId: owner.rightsHolderId,
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: floor,
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      });
      caseIds.push(entry.id);
      const db = scopedDatabase(database, entry.id),
        service = hearing(db);
      const scheduled = await service.schedule(actor, entry.id, {
        expectedVersion: entry.version,
        idempotencyKey: randomUUID(),
        hearingAt,
      });
      return {
        caseId: entry.id,
        db,
        service,
        arrangementId: scheduled.arrangementId,
      };
    };
    const correctionInput = async (caseId, arrangementId, hearingAt) => {
      const record = await head(caseId);
      const latest = await database.caseHearingRecordCorrection.findFirst({
        where: {
          caseId,
          departmentId: actor.departmentId,
          arrangementId,
          trialRoundId: record.currentTrialRoundId,
        },
        orderBy: { toRevision: 'desc' },
      });
      return {
        arrangementId,
        trialRoundId: record.currentTrialRoundId,
        expectedHearingRevision: latest?.toRevision ?? 0,
        idempotencyKey: randomUUID(),
        reason: 'Synthetic hearing date correction',
        hearingAt,
      };
    };
    const correct = async (fixture, hearingAt) => {
      const original = await database.caseHearingArrangement.findUniqueOrThrow({
        where: { id: fixture.arrangementId },
      });
      const before = await head(fixture.caseId);
      const result = await edit(database).correctHearing(
        actor,
        fixture.caseId,
        await correctionInput(fixture.caseId, fixture.arrangementId, hearingAt),
      );
      assert.deepEqual(
        await head(fixture.caseId),
        before,
        'Record correction must preserve workflow anchors',
      );
      assert.deepEqual(
        await database.caseHearingArrangement.findUniqueOrThrow({
          where: { id: fixture.arrangementId },
        }),
        original,
      );
      return result;
    };
    const assertNoAdvance = async (fixture) => {
      assert.deepEqual(await fixture.service.advanceDue(now), {
        advanced: 0,
        failed: 0,
      });
      assert.equal((await head(fixture.caseId)).stage, 'WAITING_HEARING');
      assert.equal(
        await database.caseHearingAdvance.count({
          where: { caseId: fixture.caseId },
        }),
        0,
      );
      assert.equal(
        await database.auditEvent.count({
          where: {
            resourceId: fixture.caseId,
            action: 'case.hearing.auto_advanced',
          },
        }),
        0,
      );
    };
    const cases = [];
    for (const original of [future, null]) {
      const fixture = await createCase(original);
      await correct(fixture, past);
      assert.deepEqual(await fixture.service.advanceDue(now), {
        advanced: 1,
        failed: 0,
      });
      assert.deepEqual(await fixture.service.advanceDue(now), {
        advanced: 0,
        failed: 0,
      });
      const advances = await database.caseHearingAdvance.findMany({
        where: { caseId: fixture.caseId },
      });
      assert.equal(advances.length, 1);
      assert.equal(advances[0].arrangementId, fixture.arrangementId);
      assert.equal(advances[0].dueAt.toISOString(), `${past}T16:00:00.000Z`);
      assert.equal((await head(fixture.caseId)).stage, 'WAITING_JUDGMENT');
      cases.push(original === null ? 'null-to-past' : 'future-to-past');
    }
    for (const corrected of [future, null]) {
      const fixture = await createCase(past);
      await correct(fixture, corrected);
      await assertNoAdvance(fixture);
      cases.push(corrected === null ? 'past-to-null' : 'past-to-future');
    }
    const latestOnly = await createCase(future);
    for (const date of [past, future, null]) await correct(latestOnly, date);
    await assertNoAdvance(latestOnly);
    assert.equal(
      await database.caseHearingRecordCorrection.count({
        where: { caseId: latestOnly.caseId },
      }),
      3,
    );
    cases.push('latest-null-over-older-past');

    const replaced = await createCase(future);
    await correct(replaced, past);
    const replacement = await replaced.service.schedule(
      actor,
      replaced.caseId,
      {
        expectedVersion: (await head(replaced.caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt: future,
      },
    );
    await assertNoAdvance(replaced);
    const later = new Date(`${future}T16:00:00.000Z`);
    const laterService = hearing(replaced.db, later);
    assert.deepEqual(await laterService.advanceDue(later), {
      advanced: 1,
      failed: 0,
    });
    assert.deepEqual(await laterService.advanceDue(later), {
      advanced: 0,
      failed: 0,
    });
    const newAdvances = await database.caseHearingAdvance.findMany({
      where: { caseId: replaced.caseId },
    });
    assert.equal(newAdvances.length, 1);
    assert.equal(newAdvances[0].arrangementId, replacement.arrangementId);
    assert.equal(
      await database.caseHearingAdvance.count({
        where: { arrangementId: replaced.arrangementId },
      }),
      0,
    );
    cases.push('replaced-arrangement-inactive');

    const races = [],
      lockProofs = [];
    for (const date of [future, null]) {
      for (const first of ['edit', 'advance']) {
        const fixture = await createCase(past);
        const input = await correctionInput(
          fixture.caseId,
          fixture.arrangementId,
          date,
        );
        const correctCommand = (db) =>
          edit(db).correctHearing(actor, fixture.caseId, input);
        const scan = (db) => hearing(db).advanceDue(now);
        const { outcomes, lockEvents } = await orderedRace(
          database,
          fixture.caseId,
          first === 'edit' ? correctCommand : scan,
          first === 'edit' ? scan : correctCommand,
        );
        assert.equal(outcomes[0].status, 'fulfilled');
        if (first === 'edit') {
          assert.equal(outcomes[1].status, 'fulfilled');
          assert.deepEqual(outcomes[1].value, { advanced: 0, failed: 0 });
          await assertNoAdvance(fixture);
          assert.equal(
            await database.caseHearingRecordCorrection.count({
              where: { caseId: fixture.caseId },
            }),
            1,
          );
        } else {
          assert.deepEqual(outcomes[0].value, { advanced: 1, failed: 0 });
          assert.equal(outcomes[1].status, 'rejected');
          assert.equal(outcomes[1].reason.response?.code, 'VALIDATION_ERROR');
          assert.equal((await head(fixture.caseId)).stage, 'WAITING_JUDGMENT');
          assert.equal(
            await database.caseHearingRecordCorrection.count({
              where: { caseId: fixture.caseId },
            }),
            0,
          );
          assert.equal(
            await database.caseHearingAdvance.count({
              where: { caseId: fixture.caseId },
            }),
            1,
          );
        }
        const race = `${date === null ? 'null' : 'future'}-${first}-first`;
        races.push(race);
        lockProofs.push({ race, events: lockEvents });
      }
    }
    assert.deepEqual(candidate(), source);
    assert.equal(capture().fingerprint, environment.fingerprint);
    await assertCurrentMigrations(database);
    return {
      ...source,
      fingerprint: environment.fingerprint,
      migrationCount: 156,
      cases,
      races,
      lockProofs,
      caseIds,
    };
  } finally {
    // Immutable facts remain inspectable; only the coordinated runner owns disposal.
    await database.$disconnect();
  }
}
