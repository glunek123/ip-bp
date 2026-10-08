import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Isolated test database required');
validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });

export async function verifyCustomerRightAssetMigration() {
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const enumTarget = '20261008030000_add_customer_right_asset_enums';
  const tableTarget = '20261008031000_add_customer_right_assets';
  const auditTarget = '20261008032000_guard_customer_right_asset_audit';
  const guardFixTarget = '20261008033000_fix_customer_right_asset_chain_guard';
  const oldNames = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name < enumTarget)
    .sort();
  if (oldNames.length !== 91)
    throw new Error(
      `Expected supported 91 migrations, found ${oldNames.length}`,
    );
  const enumSql = await readFile(
    resolve(migrationRoot, enumTarget, 'migration.sql'),
    'utf8',
  );
  const tableSql = await readFile(
    resolve(migrationRoot, tableTarget, 'migration.sql'),
    'utf8',
  );
  const auditSql = await readFile(
    resolve(migrationRoot, auditTarget, 'migration.sql'),
    'utf8',
  );
  const guardFixSql = await readFile(
    resolve(migrationRoot, guardFixTarget, 'migration.sql'),
    'utf8',
  );
  const schemaA = `cu002_empty_${randomUUID().replaceAll('-', '')}`;
  const schemaB = `cu002_upgrade_${randomUUID().replaceAll('-', '')}`;
  if (
    ![schemaA, schemaB].every((schema) =>
      /^cu002_(empty|upgrade)_[a-f0-9]{32}$/u.test(schema),
    )
  )
    throw new Error('Unsafe cleanup schema');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const context = (await client.query('SELECT current_database() AS db'))
      .rows[0];
    if (context.db !== 'dev_cor_test')
      throw new Error('Migration probe requires dev_cor_test');
    for (const schema of [schemaA, schemaB]) {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      for (const name of oldNames)
        await client.query(
          await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
        );
      if (schema === schemaB) {
        const [
          departmentA,
          departmentB,
          user,
          membershipA,
          membershipB,
          customerA,
          customerB,
          customerSameDepartment,
          holderA,
          holderB,
          holderOtherCustomer,
          linkA,
          linkOtherCustomer,
        ] = Array.from({ length: 13 }, () => randomUUID());
        await client.query(
          "INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU002 A',now()),($2,'CU002 B',now())",
          [departmentA, departmentB],
        );
        await client.query(
          "INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,'cu002-migration-user','CU002',now())",
          [user],
        );
        await client.query(
          'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$3,$4,now()),($2,$3,$5,now())',
          [membershipA, membershipB, user, departmentA, departmentB],
        );
        await client.query(
          "INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,'CU002 A','cu002 a',$3,$5,now()),($2,'CU002 B','cu002 b',$4,$5,now())",
          [customerA, customerB, departmentA, departmentB, user],
        );
        await client.query(
          "INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,'CU002 Same Dept','cu002 same dept',$2,$3,now())",
          [customerSameDepartment, departmentA, user],
        );
        await client.query(
          "INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,'Holder A',$3,now()),($2,'Holder B',$4,now())",
          [holderA, holderB, departmentA, departmentB],
        );
        await client.query(
          "INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,'Holder Other Customer',$2,now())",
          [holderOtherCustomer, departmentA],
        );
        await client.query(
          'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
          [linkA, customerA, holderA, departmentA],
        );
        await client.query(
          'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
          [
            linkOtherCustomer,
            customerSameDepartment,
            holderOtherCustomer,
            departmentA,
          ],
        );
        const before = (
          await client.query('SELECT id,version FROM customers WHERE id=$1', [
            customerA,
          ])
        ).rows[0];
        await client.query(enumSql);
        try {
          await client.query(
            tableSql.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;'),
          );
          throw new Error('Injected migration fault unexpectedly passed');
        } catch (error) {
          if (!String(error.message).includes('division by zero')) throw error;
          await client.query('ROLLBACK');
        }
        const rolledBack =
          (
            await client.query(
              "SELECT to_regclass('customer_right_assets') AS table_name",
            )
          ).rows[0].table_name === null;
        if (!rolledBack) throw new Error('Failed asset migration left a table');
        await client.query(tableSql);
        await client.query(auditSql);
        await client.query(guardFixSql);
        const after = (
          await client.query('SELECT id,version FROM customers WHERE id=$1', [
            customerA,
          ])
        ).rows[0];
        if (before.id !== after.id || before.version !== after.version)
          throw new Error('Existing customer changed during upgrade');
        const link = (
          await client.query(
            'SELECT id FROM customer_rights_holder_links WHERE id=$1',
            [linkA],
          )
        ).rows[0];
        if (link.id !== linkA)
          throw new Error('Existing holder link changed during upgrade');
        let crossDepartmentRejected = false;
        try {
          await client.query(
            'INSERT INTO customer_right_assets(id,customer_id,department_id,holder_id,version) VALUES ($1,$2,$3,$4,1)',
            [randomUUID(), customerA, departmentA, holderB],
          );
        } catch (error) {
          crossDepartmentRejected =
            error.code === '23503' &&
            error.constraint === 'customer_right_assets_holder_fkey';
        }
        if (!crossDepartmentRejected)
          throw new Error('Cross-department holder bypass accepted');
        const validOtherLink = (
          await client.query(
            'SELECT id FROM customer_rights_holder_links WHERE id=$1 AND customer_id=$2 AND rights_holder_id=$3 AND department_id=$4',
            [
              linkOtherCustomer,
              customerSameDepartment,
              holderOtherCustomer,
              departmentA,
            ],
          )
        ).rows[0];
        if (!validOtherLink)
          throw new Error(
            'Same-department negative lacks a valid other-customer link',
          );
        let sameCustomerMismatchRejected = false;
        try {
          await client.query(
            'INSERT INTO customer_right_assets(id,customer_id,department_id,holder_id,version) VALUES ($1,$2,$3,$4,1)',
            [randomUUID(), customerA, departmentA, holderOtherCustomer],
          );
        } catch (error) {
          sameCustomerMismatchRejected =
            error.code === '23503' &&
            error.constraint === 'customer_right_assets_holder_fkey';
        }
        if (!sameCustomerMismatchRejected)
          throw new Error('Other customer linked holder bypass accepted');
      } else {
        await client.query(enumSql);
        await client.query(tableSql);
        await client.query(auditSql);
        await client.query(guardFixSql);
      }
      const tables = (
        await client.query(
          "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('customer_right_assets','customer_right_asset_versions','customer_right_asset_receipts')",
          [schema],
        )
      ).rows[0].count;
      if (tables !== 3) throw new Error('Asset migration missing tables');
    }
    return {
      oldMigrations: oldNames.length,
      emptyChain: true,
      upgradePreserved: true,
      rollbackRetry: true,
      crossDepartmentRejected: true,
      sameCustomerMismatchRejected: true,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    for (const schema of [schemaA, schemaB]) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await client.end();
  }
}

function publicClient() {
  return new Client({ connectionString: databaseUrl });
}

async function assertPublic(client) {
  const row = (
    await client.query(
      'SELECT current_database() AS db, current_schema() AS schema',
    )
  ).rows[0];
  if (row.db !== 'dev_cor_test' || row.schema !== 'public')
    throw new Error('CU002 fixture requires isolated test public');
}

export async function setRightAssetWithdrawGrant(roleId, enabled) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    if (enabled)
      await client.query(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'customer.right-asset.withdraw','DEPARTMENT') ON CONFLICT DO NOTHING",
        [randomUUID(), roleId],
      );
    else
      await client.query(
        "DELETE FROM role_grants WHERE role_template_id=$1 AND action='customer.right-asset.withdraw'",
        [roleId],
      );
  } finally {
    await client.end();
  }
}

export async function setRightAssetRoutineGrant(roleId, enabled) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    await client.query(
      "DELETE FROM role_grants WHERE role_template_id=$1 AND action='customer.edit-routine'",
      [roleId],
    );
    if (enabled)
      await client.query(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'customer.edit-routine','TEAM')",
        [randomUUID(), roleId],
      );
  } finally {
    await client.end();
  }
}

export async function clearCustomerRightAssetFixture(customerId, departmentId) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    await client.query('BEGIN');
    const customer = (
      await client.query(
        'SELECT id,name FROM customers WHERE id=$1 AND department_id=$2 FOR UPDATE',
        [customerId, departmentId],
      )
    ).rows[0];
    if (!customer) {
      await client.query('ROLLBACK');
      return;
    }
    if (!customer.name.startsWith('CU002 '))
      throw new Error('Refusing to remove non-CU002 customer');
    const assetIds = (
      await client.query(
        'SELECT id FROM customer_right_assets WHERE customer_id=$1 AND department_id=$2',
        [customerId, departmentId],
      )
    ).rows.map((row) => row.id);
    const holderIds = (
      await client.query(
        'SELECT rights_holder_id FROM customer_rights_holder_links WHERE customer_id=$1 AND department_id=$2',
        [customerId, departmentId],
      )
    ).rows.map((row) => row.rights_holder_id);
    await client.query(
      'ALTER TABLE customer_right_asset_versions DISABLE TRIGGER customer_right_asset_versions_immutable',
    );
    await client.query(
      'ALTER TABLE customer_right_asset_receipts DISABLE TRIGGER customer_right_asset_receipts_immutable',
    );
    await client.query(
      'ALTER TABLE customer_right_assets DISABLE TRIGGER customer_right_asset_asset_guard',
    );
    await client.query(
      'ALTER TABLE audit_events DISABLE TRIGGER customer_right_asset_audit_immutable',
    );
    await client.query(
      'DELETE FROM customer_right_asset_receipts WHERE customer_id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    await client.query(
      'UPDATE customer_right_assets SET current_version_id=NULL WHERE customer_id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    await client.query(
      'DELETE FROM customer_right_asset_versions WHERE customer_id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    await client.query(
      'DELETE FROM customer_right_assets WHERE customer_id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    await client.query(
      'DELETE FROM rights_holder_command_receipts WHERE result_customer_id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    await client.query(
      'DELETE FROM customer_rights_holder_links WHERE customer_id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    if (holderIds.length > 0) {
      const foreignLinks = (
        await client.query(
          'SELECT COUNT(*)::int AS count FROM customer_rights_holder_links WHERE rights_holder_id=ANY($1::uuid[])',
          [holderIds],
        )
      ).rows[0].count;
      if (foreignLinks !== 0)
        throw new Error('CU002 holder has another customer link');
      const holders = (
        await client.query(
          'SELECT id,name FROM rights_holders WHERE id=ANY($1::uuid[])',
          [holderIds],
        )
      ).rows;
      if (holders.some((holder) => !holder.name.startsWith('CU002 ')))
        throw new Error('Refusing to remove non-CU002 holder');
      await client.query(
        'DELETE FROM rights_holders WHERE id=ANY($1::uuid[])',
        [holderIds],
      );
    }
    await client.query(
      'DELETE FROM audit_events WHERE department_id=$1 AND (resource_id=$2 OR resource_id=ANY($3::uuid[]) OR resource_id=ANY($4::uuid[]))',
      [departmentId, customerId, assetIds, holderIds],
    );
    await client.query(
      'DELETE FROM customers WHERE id=$1 AND department_id=$2',
      [customerId, departmentId],
    );
    await client.query(
      'ALTER TABLE customer_right_asset_versions ENABLE TRIGGER customer_right_asset_versions_immutable',
    );
    await client.query(
      'ALTER TABLE customer_right_asset_receipts ENABLE TRIGGER customer_right_asset_receipts_immutable',
    );
    await client.query(
      'ALTER TABLE customer_right_assets ENABLE TRIGGER customer_right_asset_asset_guard',
    );
    await client.query(
      'ALTER TABLE audit_events ENABLE TRIGGER customer_right_asset_audit_immutable',
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

export async function rightAssetDatabaseSnapshot(customerId) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    const customer = (
      await client.query('SELECT version FROM customers WHERE id=$1', [
        customerId,
      ])
    ).rows[0];
    const rows = (
      await client.query(
        'SELECT COUNT(*)::int AS count FROM customer_right_assets WHERE customer_id=$1',
        [customerId],
      )
    ).rows[0];
    return { customerVersion: customer.version, assets: rows.count };
  } finally {
    await client.end();
  }
}

export async function rightAssetEvidenceSnapshot(customerId) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    const row = (
      await client.query(
        `SELECT c.version AS customer_version,
          (SELECT COUNT(*)::int FROM customer_right_assets a WHERE a.customer_id=c.id) AS assets,
          (SELECT COUNT(*)::int FROM customer_right_asset_versions v WHERE v.customer_id=c.id) AS versions,
          (SELECT COUNT(*)::int FROM customer_right_asset_receipts r WHERE r.customer_id=c.id) AS receipts,
          (SELECT COUNT(*)::int FROM audit_events e WHERE e.resource_type='right-asset'
            AND e.details->>'customerId'=c.id::text) AS audits
         FROM customers c WHERE c.id=$1`,
        [customerId],
      )
    ).rows[0];
    if (!row) throw new Error('CU002 evidence customer missing');
    return {
      customerVersion: row.customer_version,
      assets: row.assets,
      versions: row.versions,
      receipts: row.receipts,
      audits: row.audits,
    };
  } finally {
    await client.end();
  }
}

export async function rejectRightAssetAuditWrites(enabled) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    if (enabled)
      await client.query(
        "ALTER TABLE audit_events ADD CONSTRAINT cu002_reject_asset_audit CHECK (action <> 'right-asset.created') NOT VALID",
      );
    else
      await client.query(
        'ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS cu002_reject_asset_audit',
      );
  } finally {
    await client.end();
  }
}

export async function verifyRightAssetDatabaseGuards(
  customerId,
  assetId,
  departmentId,
  otherAssetId,
) {
  const client = publicClient();
  await client.connect();
  try {
    await assertPublic(client);
    const asset = (
      await client.query(
        'SELECT current_version_id FROM customer_right_assets WHERE id=$1 AND customer_id=$2 AND department_id=$3',
        [assetId, customerId, departmentId],
      )
    ).rows[0];
    if (!asset) throw new Error('Fixture asset missing');
    let immutable = false;
    try {
      await client.query(
        'UPDATE customer_right_asset_versions SET name=$2 WHERE id=$1',
        [asset.current_version_id, 'tampered'],
      );
    } catch (error) {
      immutable = error.code === '23514';
    }
    let pointerRejected = false;
    const otherVersion = otherAssetId
      ? (
          await client.query(
            'SELECT current_version_id FROM customer_right_assets WHERE id=$1 AND customer_id=$2',
            [otherAssetId, customerId],
          )
        ).rows[0]?.current_version_id
      : randomUUID();
    try {
      await client.query(
        'UPDATE customer_right_assets SET current_version_id=$2 WHERE id=$1',
        [assetId, otherVersion],
      );
    } catch (error) {
      pointerRejected = error.code === '23503';
    }
    let missingPointerRejected = false;
    await client.query('BEGIN');
    try {
      await client.query(
        'UPDATE customer_right_assets SET current_version_id=NULL WHERE id=$1',
        [assetId],
      );
      await client.query('COMMIT');
    } catch (error) {
      missingPointerRejected = error.code === '23514';
      await client.query('ROLLBACK');
    }
    let badVersionRejected = false;
    try {
      await client.query(
        'UPDATE customer_right_assets SET version=0 WHERE id=$1',
        [assetId],
      );
    } catch (error) {
      badVersionRejected = error.code === '23514';
    }
    let auditImmutable = false;
    try {
      await client.query(
        "UPDATE audit_events SET action='right-asset.tampered' WHERE id=(SELECT audit_event_id FROM customer_right_asset_versions WHERE id=$1)",
        [asset.current_version_id],
      );
    } catch (error) {
      auditImmutable = error.code === '23514';
    }
    let dateRejected = false;
    try {
      await client.query(
        `INSERT INTO customer_right_asset_versions
      (id,asset_id,customer_id,department_id,version,action,type,name,number,category,holder_id,owner_text,trademark_class,valid_from,valid_to,validity_mode,withdraw_reason,recorded_by_user_id,audit_event_id)
      SELECT $2,asset_id,customer_id,department_id,999,'REVISE',type,name,number,category,holder_id,owner_text,trademark_class,valid_from,'2026-02-30'::date,'FIXED',NULL,recorded_by_user_id,audit_event_id
      FROM customer_right_asset_versions WHERE id=$1`,
        [asset.current_version_id, randomUUID()],
      );
    } catch (error) {
      dateRejected = error.code === '22008';
    }
    if (
      !immutable ||
      !pointerRejected ||
      !missingPointerRejected ||
      !badVersionRejected ||
      !auditImmutable ||
      !dateRejected
    )
      throw new Error('Right asset database guard probe failed');
    return {
      immutable,
      pointerRejected,
      missingPointerRejected,
      badVersionRejected,
      auditImmutable,
      dateRejected,
    };
  } finally {
    await client.end();
  }
}
