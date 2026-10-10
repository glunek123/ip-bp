import { test, expect } from '@playwright/test';
import { verifyCaseJudgmentNextStepMigration } from '../support/case-judgment-next-step-migration.mjs';

test('CA-009 empty schema replays the supported 112 migrations and appends guarded choices', async () => {
  const result = await verifyCaseJudgmentNextStepMigration();
  expect(result).toEqual({ migrationCount: 117, priorMigrationCount: 112, guards: 4,
    legacyPreserved: true, legacyCorrectionPreserved: true, correctedHeadSelectable: true });
});
