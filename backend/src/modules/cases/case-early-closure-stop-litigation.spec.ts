import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261029170000_early_closure_stop_litigation/migration.sql',
  ),
  'utf8',
);
const oldMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261026120000_v6_early_archive/migration.sql',
  ),
  'utf8',
);

function stopTables(sql: string): string[] {
  const list = sql.match(
    /FOREACH table_name IN ARRAY ARRAY\[([\s\S]*?)\]/u,
  )?.[1];
  if (list === undefined) throw new Error('missing stop table list');
  return [...list.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

describe('early closure litigation write stop', () => {
  it('covers every old litigation table while leaving closure and archive writes available', () => {
    const oldLitigation = stopTables(oldMigration).filter(
      (name) =>
        !name.startsWith('case_closure') && !name.startsWith('case_archive'),
    );
    expect(stopTables(migration).sort()).toEqual(oldLitigation.sort());
  });

  it('locks the case before checking the source and preserves historical reads', () => {
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain('"case_early_closures" WHERE');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE');
    expect(migration).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|UPDATE "cases"|DELETE FROM/iu,
    );
  });
});
