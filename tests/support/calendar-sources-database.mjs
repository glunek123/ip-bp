import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { verifyCaseJudgmentDatabase } from './case-judgment-database.mjs';

const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Calendar source fixture requires an isolated test database');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { hashPassword } = requireBackend('./dist/auth/password.js');
const { AccessControlService } = requireBackend(
  './dist/access-control/access-control.service.js',
);
const { PrismaAccessControlStore } = requireBackend(
  './dist/access-control/prisma-access-control.store.js',
);
const { CaseJudgmentNextStepService } = requireBackend(
  './dist/modules/cases/case-judgment-next-step.service.js',
);
const { CaseSecondInstanceService } = requireBackend(
  './dist/modules/cases/case-second-instance.service.js',
);

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
});
const departmentA = '10000000-0000-4000-8000-000000000001';
const roleA = '30000000-0000-4000-8000-000000000001';
const operatorId = '20000000-0000-4000-8000-000000000001';

async function isolated() {
  const rows = await database.$queryRawUnsafe(
    'SELECT current_database() AS db, current_schema() AS schema',
  );
  if (rows[0]?.db !== 'dev_cor_test' || rows[0]?.schema !== 'public')
    throw new Error(
      'Calendar source fixture requires the isolated public test schema',
    );
}

export async function calendarCaseSourceIds(caseId) {
  await isolated();
  const source = await database.case.findFirst({
    where: { id: caseId, departmentId: departmentA },
    select: {
      currentHearingArrangementId: true,
      currentSecondInstanceProgressId: true,
    },
  });
  if (!source)
    throw new Error('Calendar source case is outside the test department');
  return {
    first: source.currentHearingArrangementId,
    second: source.currentSecondInstanceProgressId,
  };
}

// Revoke the live case.read grant, then restore the fixed test role's baseline.
// The caller's afterEach resets the whole isolated fixture even on failure.
export async function setCalendarCaseReadGrant(enabled) {
  await isolated();
  await database.roleGrant.deleteMany({
    where: { roleTemplateId: roleA, action: 'CASE_READ' },
  });
  if (enabled)
    await database.roleGrant.create({
      data: { roleTemplateId: roleA, action: 'CASE_READ', scope: 'DEPARTMENT' },
    });
}

export async function setCalendarUserActive(userId, active) {
  if (userId !== operatorId)
    throw new Error('Only the fixed test operator may be changed');
  await isolated();
  await database.userAccount.update({
    where: { id: userId },
    data: { active },
  });
}

export async function disconnectCalendarSourcesDatabase() {
  await database.$disconnect();
}

export async function replaceCalendarPrimaryLawyer(
  caseId,
  oldProfileId,
  newProfileId,
) {
  await isolated();
  await database.$transaction(async (transaction) => {
    const item = await transaction.case.findFirst({
      where: { id: caseId, departmentId: departmentA },
      select: { id: true },
    });
    const replacement = await transaction.lawyerProfile.findFirst({
      where: {
        id: newProfileId,
        departmentId: departmentA,
        accountBinding: { is: { active: true } },
      },
      select: { id: true },
    });
    if (!item || !replacement)
      throw new Error('Lawyer replacement is outside the test scope');
    const endedAt = new Date();
    const ended = await transaction.caseLawyerAssignment.updateMany({
      where: {
        caseId,
        departmentId: departmentA,
        lawyerId: oldProfileId,
        role: 'PRIMARY',
        endedAt: null,
      },
      data: { endedAt },
    });
    if (ended.count !== 1)
      throw new Error('Expected one current PRIMARY lawyer');
    await transaction.caseLawyerAssignment.create({
      data: {
        caseId,
        departmentId: departmentA,
        lawyerId: newProfileId,
        role: 'PRIMARY',
        startedAt: endedAt,
      },
    });
  });
}

// CA-008's existing isolated fixture synthesizes only the legacy ancestors
// through an accepted, heard case. Judgment, appeal choice, and both second-
// instance progress versions below use their real services and database guards.
// The callback's HTTP reads execute before that fixture's canonical cleanup.
export async function probeSecondCalendarSource(
  request,
  firstDate,
  revisedDate,
) {
  return verifyCaseJudgmentDatabase({
    afterRegistration: async ({
      actor,
      roleId,
      caseId,
      judgmentId,
      materials,
      database: sourceDatabase,
      client,
    }) => {
      for (const action of [
        'case.judgment.next_step',
        'case.second_instance.save',
      ])
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,'DEPARTMENT')",
          [randomUUID(), roleId, action],
        );
      const access = new AccessControlService(
        new PrismaAccessControlStore(sourceDatabase),
      );
      const choice = new CaseJudgmentNextStepService(sourceDatabase, access);
      const second = new CaseSecondInstanceService(
        sourceDatabase,
        access,
        materials,
      );
      const selected = await choice.choose(actor, caseId, {
        expectedVersion: 10,
        idempotencyKey: randomUUID(),
        judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      });
      if (selected.stage !== 'SECOND_INSTANCE' || selected.version !== 11)
        throw new Error('Appeal choice did not produce second-instance stage');
      const anchor = await sourceDatabase.case.findUniqueOrThrow({
        where: { id: caseId },
        select: { currentTrialRoundId: true, currentJudgmentNextStepId: true },
      });
      if (!anchor.currentTrialRoundId || !anchor.currentJudgmentNextStepId)
        throw new Error('Second-instance current anchors are absent');
      const username = `calendar-second-${randomUUID()}`;
      const password = `calendar-second-password-${randomUUID()}`;
      await sourceDatabase.localCredential.create({
        data: {
          userId: actor.userId,
          username,
          passwordHash: await hashPassword(password),
        },
      });
      const auth = await request.post('/api/v1/auth/login', {
        headers: { Origin: 'http://127.0.0.1:5174' },
        data: { username, password },
      });
      if (auth.status() !== 200)
        throw new Error(
          `Calendar source test login failed: ${auth.status()} ${await auth.text()}`,
        );
      const headers = {
        Origin: 'http://127.0.0.1:5174',
        'X-CSRF-Token': (await auth.json()).csrfToken,
      };
      const read = async (month) => {
        const response = await request.get(`/api/v1/calendar?month=${month}`, {
          headers,
        });
        if (response.status() !== 200)
          throw new Error(
            `Calendar source HTTP failed: ${response.status()} ${await response.text()}`,
          );
        return response.json();
      };
      const before = await read(firstDate.slice(0, 7));
      const progress = {
        hearingAt: firstDate,
        hearingPlace: '第二审第一法庭',
        judgeName: '测试法官',
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      };
      const first = await second.save(actor, caseId, {
        expectedVersion: 11,
        idempotencyKey: randomUUID(),
        trialRoundId: anchor.currentTrialRoundId,
        choiceId: anchor.currentJudgmentNextStepId,
        expectedProgressId: null,
        progress,
      });
      const firstView = await read(firstDate.slice(0, 7));
      const revised = await second.save(actor, caseId, {
        expectedVersion: first.version,
        idempotencyKey: randomUUID(),
        trialRoundId: anchor.currentTrialRoundId,
        choiceId: anchor.currentJudgmentNextStepId,
        expectedProgressId: first.progressId,
        progress: { ...progress, hearingAt: revisedDate },
      });
      const currentView = await read(revisedDate.slice(0, 7));
      const summaryResponse = await request.get('/api/v1/calendar/summary', {
        headers,
      });
      if (summaryResponse.status() !== 200)
        throw new Error(
          `Calendar summary HTTP failed: ${summaryResponse.status()}`,
        );
      return {
        caseId,
        firstProgressId: first.progressId,
        currentProgressId: revised.progressId,
        before,
        firstView,
        currentView,
        summary: await summaryResponse.json(),
      };
    },
  });
}
