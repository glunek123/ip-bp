import { expect, test } from '@playwright/test';
import { resetCoreLeadE2eData } from '../support/core-lead-database.mjs';
import {
  clearCaseClosureFixture,
  createFinishedCaseClosureSourceThroughApi,
} from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseAcceptanceFault,
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import { verifyCaseClosureMigration } from '../support/case-closure-migration.mjs';

test.beforeEach(async () => {
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
  await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});

test.afterEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
});

test.afterAll(async () => disconnectCustomerTestDatabase());

test('CA-016 replays 144 migrations, upgrades real 142 Finish source, rolls back second DDL step and rejects version-only bypass', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  expect(source.finished.stage).toBe('WAITING_ARCHIVE');
  const result = await verifyCaseClosureMigration(source.caseId);
  expect(result).toMatchObject({
    empty: true,
    enumCommitted: true,
    injectedFailure: true,
    ddlRolledBack: true,
    forwardRecovery: true,
    preserved: true,
    oldBytesPreserved: true,
    noGrantBackfill: true,
    stageOnlyRejected: true,
  });
  expect(result.oldForeignKeys).toBeGreaterThan(0);
});
