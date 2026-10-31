import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (name: string) =>
  readFileSync(
    resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`),
    'utf8',
  );
const draft = read('20261029180000_early_closure_parent_guard_draft');
const old = read('20261026120000_v6_early_archive');

function inventory(sql: string): string[] {
  const list = sql.match(/p\.proname <> ALL\(ARRAY\[([\s\S]*?)\]\)/u)?.[1];
  if (list === undefined) throw new Error('parent guard inventory missing');
  return [...list.matchAll(/'([^']+)'/gu)].map((match) => match[1]).sort();
}

describe('early closure parent guard preparation', () => {
  it('retains the exact old deferred parent guard inventory', () => {
    expect(inventory(draft)).toEqual(inventory(old));
    expect(inventory(draft)).toHaveLength(15);
    expect(draft).toContain(
      "IF p.proname = 'check_execution_followup_case_final' THEN",
    );
    expect(draft).toContain('followup_count <> 1');
    expect(draft).toContain('wrapped_count <> 14');
  });

  it('aborts on changed function bodies and preserves the source insert gate', () => {
    expect(draft).toContain('position(old_prefix IN definition) = 0');
    expect(draft).toContain('unreviewed case parent guard');
    expect(draft).toContain('case_early_archive_transition(OLD, NEW)');
    expect(draft).toContain('case_early_closure_transition(OLD, NEW)');
    expect(draft).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|CREATE OR REPLACE FUNCTION "case_early_closure_structure_guard"/iu,
    );
    expect(read('20261029120000_early_closure_source_structure')).toContain(
      "RAISE EXCEPTION 'early closure source is not enabled'",
    );
  });
});
