import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('local account display-name hardening migration', () => {
  it('uses an eleventh forward migration covering every ECMAScript trim character', () => {
    const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
    const migrations = readdirSync(migrationRoot)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    const migration = readFileSync(
      resolve(
        migrationRoot,
        '20260918010000_enforce_user_display_name_whitespace/migration.sql',
      ),
      'utf8',
    );

    expect(migrations[9]).toBe('20260917150000_add_local_authentication');
    expect(migrations[10]).toBe(
      '20260918010000_enforce_user_display_name_whitespace',
    );
    expect(migration).toContain(
      `BTRIM("display_name", U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF')`,
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "user_accounts_display_name_nonblank_check"',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "user_accounts_display_name_nonblank_check"',
    );
  });
});
