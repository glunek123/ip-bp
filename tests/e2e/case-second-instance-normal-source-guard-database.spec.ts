import { expect, test } from '@playwright/test';
import { verifyCaseSecondInstanceNormalSourceMigration } from '../support/case-second-instance-normal-source-guard.mjs';

test('CA-008 owned PostgreSQL replays source guard and probes real source facts read-only', async () => {
  test.setTimeout(240_000);
  const probes = {
    normal: 'accepted',
    external: 'accepted',
    wrongChoice: '23514',
    crossCase: '23514',
    wrongDepartment: '23514',
  };
  expect(await verifyCaseSecondInstanceNormalSourceMigration()).toEqual({
    upgrade: {
      kind: 'upgrade',
      migrations: 177,
      finalGuard: true,
      rollback: true,
      predecessorProbes: { normal: '23514', external: 'accepted' },
      probes,
    },
    empty: { kind: 'empty', migrations: 177, finalGuard: true, probes },
    publicUnchanged: true,
  });
});
