import { expect, test } from '@playwright/test';
import { resetCoreLeadE2eData } from '../support/core-lead-database.mjs';
import {
  clearCaseArchiveFixture,
  createClosedCaseArchiveSourceThroughApi,
} from '../support/case-archive-database.mjs';
import { clearCaseClosureFixture } from '../support/case-closure-database.mjs';
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
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import { verifyCaseArchiveMigration } from '../support/case-archive-migration.mjs';
async function clean() {
  await clearCaseArchiveFixture();
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
}
test.beforeEach(async () => {
  await clean();
  await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);
test('CA017 replays 146 migrations, upgrades real 144 Closure source and exact bytes, rolls back second DDL step and rejects stage-only bypass', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes: Buffer.from(
      '%PDF-1.7\nCA017 exact closure source for 144 upgrade\n%%EOF\n',
    ),
  });
  expect(source.closureResult.stage).toBe('WAITING_ARCHIVE');
  const result = await verifyCaseArchiveMigration(source.caseId);
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
