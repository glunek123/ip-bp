import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertBatch2ImportTarget } from '../support/batch2-lead-import-target.mjs';

// A new owned synthetic PG target must be approved and migrated first. Do not
// inherit the historic UI003 tuple or reset its database.
test.beforeAll(() => {
  assertBatch2ImportTarget();
});

test('migration 189 exists on the owned database with scoped task constraints', async () => {
  const url = assertBatch2ImportTarget();
  const requireBackend = createRequire(
    resolve(process.cwd(), 'backend/package.json'),
  );
  const { Client } = requireBackend('pg') as {
    Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>;
      query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
      end(): Promise<void>;
    };
  };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const migration =
      await client.query(`SELECT finished_at, rolled_back_at FROM _prisma_migrations
      WHERE migration_name = '20261027150000_batch2_lead_import_images'`);
    expect(migration.rows).toHaveLength(1);
    expect(migration.rows[0].finished_at).not.toBeNull();
    expect(migration.rows[0].rolled_back_at).toBeNull();
    const constraints = await client.query(`SELECT conname FROM pg_constraint
      WHERE conrelid = 'lead_image_import_tasks'::regclass`);
    const names = constraints.rows.map(
      (row: Record<string, unknown>) => row.conname,
    );
    expect(names).toContain('lead_image_import_tasks_lead_fk');
    expect(names).toContain('lead_image_import_tasks_product_fk');
    expect(names).toContain('lead_image_import_tasks_actor_fk');
    expect(names).toContain('lead_image_import_tasks_upload_draft_fk');
    expect(names).toContain('lead_image_import_tasks_unique_url');
    const wrongProduct =
      await client.query(`SELECT count(*)::int AS count FROM lead_image_import_tasks t
      LEFT JOIN lead_products p ON p.id=t.product_id AND p.lead_id=t.lead_id WHERE p.id IS NULL`);
    expect(wrongProduct.rows[0].count).toBe(0);
  } finally {
    await client.end();
  }
});
