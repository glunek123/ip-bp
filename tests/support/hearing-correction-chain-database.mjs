import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
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
const { CaseJudgmentService } = load('modules/cases/case-judgment.service');
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

function capture() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(
    process.env.DEV_COR_TEST_DATABASE_URL,
    'Runner must supply the isolated URL',
  );
  assert.match(
    process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID ?? '',
    /^[a-f0-9]{64}$/u,
  );
  assert.ok(
    process.env.DEV_COR_TEST_DATABASE_PROJECT,
    'Runner must bind the compose project',
  );
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
  assert.ok(
    ![15433, 15436, 3206, 5186].includes(target.port),
    'A dedicated random-port instance is required',
  );
  return environment;
}

async function assertCurrentMigrations(database) {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 155);
  assert.equal(names.at(-1), '20261015130000_guard_direct_second_remand_child');
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

// Restrict a scan to this new synthetic case, retaining the production due-date
// predicate and transaction. No other test's cases can be advanced by this helper.
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

async function expectCode(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.response?.code, expected);
    return true;
  });
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
      'case.judgment.register',
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

async function history(database, caseId) {
  return {
    arrangements: await database.caseHearingArrangement.findMany({
      where: { caseId },
      orderBy: { toVersion: 'asc' },
    }),
    advances: await database.caseHearingAdvance.findMany({
      where: { caseId },
      orderBy: { toVersion: 'asc' },
    }),
    corrections: await database.caseHearingCorrection.findMany({
      where: { caseId },
      orderBy: { toVersion: 'asc' },
    }),
    receipts: await database.caseHearingReceipt.findMany({
      where: { caseId },
      orderBy: { id: 'asc' },
    }),
    audits: await database.auditEvent.findMany({
      where: { resourceId: caseId, action: { startsWith: 'case.hearing.' } },
      orderBy: { id: 'asc' },
    }),
  };
}

export async function verifyHearingCorrectionChain() {
  const before = capture(),
    source = candidate();
  const database = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: before.childEnvironment.DATABASE_URL,
    }),
  });
  const caseIds = [];
  try {
    await assertCurrentMigrations(database);
    const owner = await seedOwner(database),
      actor = owner.actor;
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const entries = new CaseExternalEntryService(
      database,
      access,
      new CustomerCaseEntrySourceService(database, access),
    );
    const now = new Date('2026-10-08T10:00:00.000Z');
    const hearing = (db, at = now) =>
      new CaseHearingService(db, access, new CaseHearingSignal(), {
        now: () => at,
      });
    const head = (caseId) =>
      database.case.findUniqueOrThrow({ where: { id: caseId } });
    const createCase = async () => {
      const entry = await entries.create(actor, {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'WAITING_HEARING',
        stageReachedOn: '2026-10-01',
        source: `Hearing chain acceptance ${randomUUID()}`,
        reason: 'Synthetic current-source fixture',
        customerId: owner.customerId,
        rightsHolderId: owner.rightsHolderId,
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: '2026-10-01',
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      });
      caseIds.push(entry.id);
      assert.equal((await head(entry.id)).currentAcceptanceId, null);
      return entry.id;
    };
    const schedule = async (service, caseId, hearingAt) =>
      service.schedule(actor, caseId, {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt,
      });
    const correct = async (service, caseId, hearingAt) =>
      service.correct(actor, caseId, {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt,
        reason: 'Synthetic court rescheduling',
      });
    const dueCase = async () => {
      const caseId = await createCase(),
        db = scopedDatabase(database, caseId),
        service = hearing(db);
      await schedule(service, caseId, '2026-10-03');
      assert.equal((await service.advanceDue(now)).advanced, 1);
      return { caseId, db, service };
    };
    const branches = [];
    let replayCase, replayInput, replayResult;
    for (const date of ['2026-10-08', '2026-10-10', null]) {
      const { caseId, db, service } = await dueCase();
      const original = await history(database, caseId);
      const advanceId = original.advances[0].id;
      for (const past of ['2026-10-04', '2026-10-05']) {
        const result = await correct(service, caseId, past);
        assert.equal(result.stage, 'WAITING_JUDGMENT');
        assert.equal((await head(caseId)).currentHearingAdvanceId, advanceId);
        assert.equal((await service.advanceDue(now)).advanced, 0);
      }
      const prior = await history(database, caseId);
      assert.equal(prior.advances.length, 1);
      assert.equal(prior.corrections.length, 2);
      await expectCode(
        () =>
          service.correct(actor, caseId, {
            expectedVersion: prior.corrections.at(-1).toVersion - 1,
            idempotencyKey: randomUUID(),
            hearingAt: date,
            reason: 'Synthetic stale request',
          }),
        'VERSION_CONFLICT',
      );
      await expectCode(
        () =>
          service.correct({ ...actor, departmentId: randomUUID() }, caseId, {
            expectedVersion: prior.corrections.at(-1).toVersion,
            idempotencyKey: randomUUID(),
            hearingAt: date,
            reason: 'Synthetic foreign department',
          }),
        'RESOURCE_NOT_FOUND',
      );
      replayInput = {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt: date,
        reason: 'Synthetic final rescheduling',
      };
      // Simulate losing the transaction response after a real successful commit.
      // The next client request must recover from the persisted receipt.
      let committedResult;
      const lostResponseDatabase = new Proxy(database, {
        get(target, key) {
          if (key === '$transaction')
            return async (callback, options) => {
              committedResult = await target.$transaction(callback, options);
              throw new Error('Synthetic response lost after commit');
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        hearing(lostResponseDatabase).correct(actor, caseId, replayInput),
        /Synthetic response lost after commit/u,
      );
      replayResult = await service.correct(actor, caseId, replayInput);
      assert.deepEqual(replayResult, committedResult);
      replayCase = caseId;
      assert.equal(replayResult.stage, 'WAITING_HEARING');
      assert.equal((await head(caseId)).currentHearingAdvanceId, null);
      assert.deepEqual(
        await service.correct(actor, caseId, replayInput),
        replayResult,
      );
      await expectCode(
        () =>
          service.correct(actor, caseId, {
            ...replayInput,
            hearingAt: '2026-10-11',
          }),
        'IDEMPOTENCY_CONFLICT',
      );
      await expectCode(
        () =>
          service.correct(actor, caseId, {
            ...replayInput,
            idempotencyKey: randomUUID(),
          }),
        'INVALID_STATE',
      );
      const changed = await history(database, caseId);
      assert.deepEqual(changed.arrangements.slice(0, 3), prior.arrangements);
      assert.deepEqual(changed.advances, original.advances);
      assert.deepEqual(changed.corrections.slice(0, 2), prior.corrections);
      assert.ok(
        prior.audits.every((audit) =>
          changed.audits.some(
            (current) =>
              current.id === audit.id &&
              JSON.stringify(current) === JSON.stringify(audit),
          ),
        ),
      );
      assert.ok(
        prior.receipts.every((receipt) =>
          changed.receipts.some(
            (current) =>
              current.id === receipt.id &&
              JSON.stringify(current) === JSON.stringify(receipt),
          ),
        ),
      );
      assert.equal(
        (await service.advanceDue(now)).advanced,
        0,
        'The old due arrangement must be inactive',
      );
      if (date !== null) {
        const later = hearing(db, new Date('2026-10-11T10:00:00.000Z'));
        assert.equal(
          (await later.advanceDue(new Date('2026-10-11T10:00:00.000Z')))
            .advanced,
          1,
        );
        assert.equal(
          (await later.advanceDue(new Date('2026-10-11T10:00:00.000Z')))
            .advanced,
          0,
        );
        const final = await history(database, caseId);
        assert.equal(final.advances.length, 2);
        assert.equal(
          final.advances[1].arrangementId,
          replayResult.arrangementId,
        );
      } else {
        assert.equal(
          (await service.advanceDue(new Date('2026-12-01T10:00:00.000Z')))
            .advanced,
          0,
        );
      }
      branches.push(date);
    }

    // These four races require both commands to reach the real case lock.
    const races = [],
      lockProofs = [];
    for (const first of ['schedule', 'advance']) {
      const caseId = await createCase(),
        service = hearing(scopedDatabase(database, caseId));
      await schedule(service, caseId, '2026-10-03');
      const input = {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt: null,
      };
      const save = (db) => hearing(db).schedule(actor, caseId, input);
      const advance = (db) => hearing(db).advanceDue(now);
      const { outcomes, lockEvents } = await orderedRace(
        database,
        caseId,
        first === 'schedule' ? save : advance,
        first === 'schedule' ? advance : save,
      );
      assert.equal(outcomes[0].status, 'fulfilled');
      if (first === 'schedule') {
        assert.equal(outcomes[1].status, 'fulfilled');
        assert.equal(outcomes[1].value.advanced, 0);
        assert.equal((await head(caseId)).stage, 'WAITING_HEARING');
      } else {
        assert.equal(outcomes[0].value.advanced, 1);
        assert.equal(outcomes[1].status, 'rejected');
        assert.equal(outcomes[1].reason.response.code, 'INVALID_STATE');
        assert.equal((await head(caseId)).stage, 'WAITING_JUDGMENT');
      }
      races.push(`${first}-first`);
      lockProofs.push({ race: `${first}-first`, events: lockEvents });
    }

    // WAITING_JUDGMENT is not a scan candidate. These sequential state checks
    // prove the task remains a no-op around correction, not lock competition.
    const scanStateChecks = [];
    for (const first of ['correction', 'advance']) {
      const { caseId, service } = await dueCase();
      const input = {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt: '2026-10-04',
        reason: 'Synthetic correction around a non-candidate scan',
      };
      assert.equal((await head(caseId)).stage, 'WAITING_JUDGMENT');
      if (first === 'advance') {
        assert.deepEqual(await service.advanceDue(now), {
          advanced: 0,
          failed: 0,
        });
      }
      assert.equal(
        (await service.correct(actor, caseId, input)).stage,
        'WAITING_JUDGMENT',
      );
      if (first === 'correction') {
        assert.deepEqual(await service.advanceDue(now), {
          advanced: 0,
          failed: 0,
        });
      }
      assert.equal((await history(database, caseId)).advances.length, 1);
      scanStateChecks.push(`non-candidate-${first}-first`);
    }

    const materials = new MaterialService(
      database,
      access,
      new LocalPrivateBlobStorage(before.childEnvironment.PRIVATE_FILE_ROOT),
      new MaterialStorageKeyCoordinator(),
    );
    const judgmentInput = async (caseId) => {
      const draft = await materials.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        originalFilename: 'synthetic-judgment.pdf',
        declaredMimeType: 'application/pdf',
      });
      const uploaded = await materials.finalizeUpload(
        actor,
        draft.id,
        Readable.from(
          Buffer.from('%PDF-1.7\nSynthetic hearing judgment\n%%EOF\n'),
        ),
      );
      return {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: '2026-10-08',
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [uploaded.contentVersionId],
      };
    };
    for (const first of ['judgment', 'correction']) {
      const { caseId, service } = await dueCase();
      const successInput = {
        expectedVersion: (await head(caseId)).version,
        idempotencyKey: randomUUID(),
        hearingAt: '2026-10-04',
        reason: 'Synthetic successful old receipt',
      };
      await service.correct(actor, caseId, successInput);
      const input = await judgmentInput(caseId);
      const correctionInput = {
        expectedVersion: input.expectedVersion,
        idempotencyKey: randomUUID(),
        hearingAt: '2026-10-10',
        reason: 'Synthetic judgment race',
      };
      const register = (db) =>
        new CaseJudgmentService(db, access, materials).register(
          actor,
          caseId,
          input,
        );
      const correction = (db) =>
        hearing(db).correct(actor, caseId, correctionInput);
      const { outcomes, lockEvents } = await orderedRace(
        database,
        caseId,
        first === 'judgment' ? register : correction,
        first === 'judgment' ? correction : register,
      );
      assert.equal(outcomes[0].status, 'fulfilled');
      assert.equal(outcomes[1].status, 'rejected');
      assert.ok(
        ['INVALID_STATE', 'VERSION_CONFLICT'].includes(
          outcomes[1].reason.response.code,
        ),
      );
      if (first === 'judgment') {
        assert.ok((await head(caseId)).currentJudgmentId);
        await expectCode(
          () => service.correct(actor, caseId, successInput),
          'INVALID_STATE',
        );
      } else {
        assert.equal((await head(caseId)).currentJudgmentId, null);
        assert.equal((await head(caseId)).stage, 'WAITING_HEARING');
      }
      const race = `${first}-before-${first === 'judgment' ? 'correction' : 'judgment'}`;
      races.push(race);
      lockProofs.push({ race, events: lockEvents });
    }

    // Only this run's unique actor is deactivated, with all hearing facts kept.
    await database.userAccount.update({
      where: { id: actor.userId },
      data: { active: false },
    });
    await expectCode(
      () => hearing(database).correct(actor, replayCase, replayInput),
      'ACTION_FORBIDDEN',
    );
    assert.deepEqual(candidate(), source);
    const after = capture();
    assert.equal(after.fingerprint, before.fingerprint);
    await assertCurrentMigrations(database);
    return {
      ...source,
      fingerprint: before.fingerprint,
      migrationCount: 155,
      branches,
      races,
      lockProofs,
      scanStateChecks,
      caseIds,
      revokedReplayDenied: true,
    };
  } finally {
    // Keep evidence and all immutable history. Instance disposal belongs to runner.
    await database.$disconnect();
  }
}
