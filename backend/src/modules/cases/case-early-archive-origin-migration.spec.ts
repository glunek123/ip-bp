import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('early archive source-state migration', () => {
  it('accepts a valid pending-match archive and rejects invalid source facts', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          resolve(
            process.cwd(),
            'src/modules/cases/case-early-archive-origin-probe.mjs',
          ),
        ],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
      ),
    ).not.toThrow();
  });
});
