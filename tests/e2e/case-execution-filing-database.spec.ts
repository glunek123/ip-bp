import { expect, test } from '@playwright/test';
import { verifyCaseExecutionMailingAndFilingDatabase } from '../support/case-execution-mailing-database.mjs';

test('CA-013 and CA-014 PostgreSQL commands freeze exact evidence and transition atomically', async () => {
  expect(await verifyCaseExecutionMailingAndFilingDatabase()).toEqual({
    source: true,
    wrongConfirmation: 'INVALID_STATE',
    wrongMaterial: 'MATERIAL_VERSION_INVALID',
    missingMail: 'VALIDATION_ERROR',
    futureMail: 'VALIDATION_ERROR',
    mailFault: true,
    mailingRace: true,
    mailReplay: true,
    mailConflict: 'IDEMPOTENCY_CONFLICT',
    mailFrozen: true,
    clientDenied: 'ACTION_FORBIDDEN',
    notaryDenied: 'ACTION_FORBIDDEN',
    wrongMailing: 'INVALID_STATE',
    wrongProof: 'MATERIAL_VERSION_INVALID',
    missingProof: 'VALIDATION_ERROR',
    futureFiling: 'VALIDATION_ERROR',
    filingFault: true,
    filingRace: true,
    filingReplay: true,
    filingConflict: 'IDEMPOTENCY_CONFLICT',
    filingFrozen: true,
    finalStage: true,
    auditFacts: true,
    sqlReversal: '23514',
    disabledMailReplay: 'ACTION_FORBIDDEN',
    disabledFilingReplay: 'ACTION_FORBIDDEN',
    disabledReplayUnchanged: true,
    restoredReplay: true,
  });
});
