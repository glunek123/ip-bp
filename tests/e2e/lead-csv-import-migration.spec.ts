import { test } from '@playwright/test';
import { verifyLeadCsvOwnedMigration } from '../support/lead-csv-import-migration-database.mjs';

test('checks three retained CSV owned-schema migration risk scenarios', async () => {
  // The helper enforces six minutes including preparation and database work.
  // Allow its socket termination and error propagation to finish before Playwright interrupts it.
  test.setTimeout(365_000);
  const evidence = await verifyLeadCsvOwnedMigration();
  if (
    evidence.schemas.length !== 3 ||
    evidence.sourceCount !== 166 ||
    evidence.groupCount !== 176 ||
    evidence.retainedRows !== 17 ||
    evidence.schemas.map((item) => item.rows).join(',') !== '0,17,0' ||
    evidence.schemas.some((item) => item.stage !== 'passed-retained') ||
    !/^[a-f0-9]{64}$/u.test(evidence.publicDigest)
  )
    throw new Error('CSV owned-schema evidence is incomplete');
  await test.info().attach('lead-csv-owned-migration-evidence.json', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
});
