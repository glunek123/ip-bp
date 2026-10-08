import { expect, test } from '@playwright/test';
import { verifyCaseJudgmentMigration } from '../support/case-judgment-migration.mjs';

test('CA-008 empty and 82-migration upgrade preserve hearing history and copied grants; failed migration retries', async () => {
  test.setTimeout(300_000);
  expect(await verifyCaseJudgmentMigration()).toEqual({
    previous: 82,
    total: 91,
    emptyFacts: 0,
    emptyReceipts: 0,
    oldHearing: 1,
    oldCaseStage: 'WAITING_JUDGMENT',
    oldCaseVersion: 9,
    oldJudgmentNull: true,
    registerGrant: 1,
    correctGrant: 1,
    failedCode: '42P07',
    noPartialColumn: 0,
    retryTable: 1,
    prismaRecoveryCases: [
      '20261008020000_add_case_judgment_enums:before-second-enum',
      '20261008020000_add_case_judgment_enums:before-third-enum',
      '20261008020000_add_case_judgment_enums:before-type',
      '20261008020000_add_case_judgment_enums:after-last',
      '20261008024000_align_case_judgment_constraints:before-second-index',
      '20261008024000_align_case_judgment_constraints:before-function',
      '20261008024000_align_case_judgment_constraints:after-last',
      '20261008025000_allow_judgment_version_reuse:before-check',
      '20261008025000_allow_judgment_version_reuse:before-partial-index',
      '20261008025000_allow_judgment_version_reuse:before-event-index',
      '20261008025000_allow_judgment_version_reuse:after-last',
    ],
    normalNoRewrite: true,
    badIndexRejected: true,
    badFunctionRejected: true,
    badTriggerRejected: true,
    badTriggerPreResolveRejected: true,
    guardTransactionAtomic: true,
    insertTransactionAtomic: true,
    duplicatePreserved: 2,
  });
});
