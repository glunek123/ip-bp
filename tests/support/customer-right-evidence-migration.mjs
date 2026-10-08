import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !databaseUrl)
  throw new Error('Isolated test environment required');
validateIsolatedTestDatabaseUrl(databaseUrl);

const migrationRoot = resolve(root, 'backend/prisma/migrations');
const enumName = '20261008034000_add_customer_right_evidence_enum';
const evidenceName = '20261008035000_freeze_customer_right_evidence';
const sql = async (name) =>
  readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8');

async function expectRejected(client, statement, params, codes) {
  await client.query('SAVEPOINT bad_input');
  let rejected = false;
  try {
    await client.query(statement, params);
  } catch (error) {
    rejected = codes.includes(error.code);
  }
  await client.query('ROLLBACK TO SAVEPOINT bad_input');
  await client.query('RELEASE SAVEPOINT bad_input');
  if (!rejected) throw new Error('Expected database guard rejection');
}

async function seedPreviousSchema(client) {
  const ids = Array.from({ length: 11 }, () => randomUUID());
  const [
    departmentId,
    userId,
    membershipId,
    customerId,
    holderId,
    linkId,
    assetId,
    versionId,
    auditId,
    receiptId,
    materialId,
  ] = ids;
  const contentVersionId = randomUUID();
  const legacyFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        action: 'CREATE',
        customerId,
        assetId: null,
        expectedCustomerVersion: 1,
        fields: {
          type: 'TRADEMARK',
          name: 'CU003 legacy',
          number: null,
          category: '商标权',
          holderId,
          ownerText: null,
          trademarkClass: null,
          validFrom: null,
          validTo: null,
          validityMode: 'UNKNOWN',
        },
      }),
    )
    .digest('hex');
  await client.query('BEGIN');
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
    [departmentId, 'CU003 migration'],
  );
  await client.query(
    'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
    [userId, `cu003-${userId}`, 'CU003 migration'],
  );
  await client.query(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [membershipId, userId, departmentId],
  );
  await client.query(
    'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,version,updated_at) VALUES ($1,$2,$3,$4,$5,2,now())',
    [
      customerId,
      'CU003 migration',
      `cu003-${customerId}`,
      departmentId,
      userId,
    ],
  );
  await client.query(
    'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [holderId, 'CU003 holder', departmentId],
  );
  await client.query(
    'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
    [linkId, customerId, holderId, departmentId],
  );
  await client.query(
    "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,'right-asset',$4,'right-asset.created',$5)",
    [
      auditId,
      departmentId,
      userId,
      assetId,
      { customerId, assetId, version: 1 },
    ],
  );
  await client.query(
    'INSERT INTO customer_right_assets(id,customer_id,department_id,holder_id,version) VALUES ($1,$2,$3,$4,1)',
    [assetId, customerId, departmentId, holderId],
  );
  await client.query(
    "INSERT INTO customer_right_asset_versions(id,asset_id,customer_id,department_id,version,action,type,name,category,holder_id,validity_mode,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,1,'CREATE','TRADEMARK','CU003 legacy','商标权',$5,'UNKNOWN',$6,$7)",
    [versionId, assetId, customerId, departmentId, holderId, userId, auditId],
  );
  await client.query(
    'UPDATE customer_right_assets SET current_version_id=$2 WHERE id=$1',
    [assetId, versionId],
  );
  await client.query(
    "INSERT INTO customer_right_asset_receipts(id,department_id,actor_user_id,customer_id,asset_id,result_version_id,action,idempotency_key,request_fingerprint,result_customer_version) VALUES ($1,$2,$3,$4,$5,$6,'CREATE','legacy-key',$7,2)",
    [
      receiptId,
      departmentId,
      userId,
      customerId,
      assetId,
      versionId,
      legacyFingerprint,
    ],
  );
  await client.query(
    "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_IDENTITY','IDENTITY_FULL',now())",
    [materialId, departmentId, customerId],
  );
  await client.query(
    "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,'legacy.pdf','application/pdf',5,$4,$5)",
    [
      contentVersionId,
      materialId,
      `${departmentId}/${materialId}/${contentVersionId}`,
      'a'.repeat(64),
      userId,
    ],
  );
  await client.query('UPDATE materials SET current_version_id=$2 WHERE id=$1', [
    materialId,
    contentVersionId,
  ]);
  await client.query(
    "INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id) VALUES ($1,$2,'customer',$3,'IDENTITY_FULL',$4,$5)",
    [randomUUID(), departmentId, customerId, materialId, contentVersionId],
  );
  await client.query('COMMIT');
  return {
    departmentId,
    userId,
    customerId,
    holderId,
    assetId,
    versionId,
    receiptId,
    materialId,
    contentVersionId,
    legacyFingerprint,
  };
}

export async function verifyCustomerRightEvidenceMigration() {
  const oldNames = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name < enumName)
    .sort();
  if (oldNames.length !== 95)
    throw new Error(
      `Expected accepted Task2 chain of 95, found ${oldNames.length}`,
    );
  const emptySchema = `cu003_empty_${randomUUID().replaceAll('-', '')}`;
  const upgradeSchema = `cu003_upgrade_${randomUUID().replaceAll('-', '')}`;
  if (
    ![emptySchema, upgradeSchema].every((name) =>
      /^cu003_(empty|upgrade)_[a-f0-9]{32}$/u.test(name),
    )
  )
    throw new Error('Unsafe temporary schema name');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const database = (await client.query('SELECT current_database() AS name'))
      .rows[0]?.name;
    if (database !== 'dev_cor_test') throw new Error('Unexpected database');
    const enumSql = await sql(enumName);
    const evidenceSql = await sql(evidenceName);
    for (const schema of [emptySchema, upgradeSchema]) {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      for (const name of oldNames) await client.query(await sql(name));
      const legacy =
        schema === upgradeSchema ? await seedPreviousSchema(client) : null;
      await client.query(enumSql);
      if (schema === upgradeSchema) {
        try {
          await client.query(
            evidenceSql.replace(/COMMIT;\s*$/u, 'SELECT 1 / 0; COMMIT;'),
          );
          throw new Error('Injected DDL failure unexpectedly passed');
        } catch (error) {
          if (!String(error.message).includes('division by zero')) throw error;
          await client.query('ROLLBACK');
        }
        const absent =
          (
            await client.query(
              "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='customer_right_asset_versions' AND column_name='evidence_content_version_ids'",
            )
          ).rowCount === 0;
        if (!absent) throw new Error('Failed migration left evidence column');
      }
      await client.query(evidenceSql);
      if (!legacy) continue;
      const preserved = (
        await client.query(
          'SELECT v.id, v.evidence_content_version_ids, r.id AS receipt_id, r.request_fingerprint FROM customer_right_asset_versions v JOIN customer_right_asset_receipts r ON r.result_version_id=v.id WHERE v.id=$1',
          [legacy.versionId],
        )
      ).rows[0];
      if (
        preserved?.id !== legacy.versionId ||
        preserved.receipt_id !== legacy.receiptId ||
        preserved.request_fingerprint !== legacy.legacyFingerprint ||
        preserved.evidence_content_version_ids.length !== 0
      )
        throw new Error('Legacy asset/receipt not preserved');
      const legacyReference = (
        await client.query(
          'SELECT content_version_id FROM material_references WHERE material_id=$1',
          [legacy.materialId],
        )
      ).rows[0];
      if (legacyReference?.content_version_id !== legacy.contentVersionId)
        throw new Error('Legacy exact reference lost');

      await client.query('BEGIN');
      await expectRejected(
        client,
        "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_RIGHT_EVIDENCE','CUSTOMER_RIGHT_EVIDENCE',now())",
        [randomUUID(), legacy.departmentId, randomUUID()],
        ['23514'],
      );
      await expectRejected(
        client,
        "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_RIGHT_EVIDENCE','IDENTITY_FULL',now())",
        [randomUUID(), legacy.departmentId, legacy.customerId],
        ['23514'],
      );
      const proofMaterialId = randomUUID();
      const proofVersionId = randomUUID();
      await client.query(
        "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_RIGHT_EVIDENCE','CUSTOMER_RIGHT_EVIDENCE',now())",
        [proofMaterialId, legacy.departmentId, legacy.customerId],
      );
      await client.query(
        "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,'proof.pdf','application/pdf',5,$4,$5)",
        [
          proofVersionId,
          proofMaterialId,
          `${legacy.departmentId}/${proofMaterialId}/${proofVersionId}`,
          'b'.repeat(64),
          legacy.userId,
        ],
      );
      await client.query(
        'UPDATE materials SET current_version_id=$2 WHERE id=$1',
        [proofMaterialId, proofVersionId],
      );
      const nextAssetVersionId = randomUUID();
      const nextAuditId = randomUUID();
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,'right-asset',$4,'right-asset.revised',$5)",
        [
          nextAuditId,
          legacy.departmentId,
          legacy.userId,
          legacy.assetId,
          {
            customerId: legacy.customerId,
            assetId: legacy.assetId,
            version: 2,
          },
        ],
      );
      await client.query(
        "INSERT INTO customer_right_asset_versions(id,asset_id,customer_id,department_id,version,action,type,name,category,holder_id,validity_mode,recorded_by_user_id,audit_event_id,evidence_content_version_ids) VALUES ($1,$2,$3,$4,2,'REVISE','TRADEMARK','CU003 with proof','商标权',$5,'UNKNOWN',$6,$7,ARRAY[$8]::uuid[])",
        [
          nextAssetVersionId,
          legacy.assetId,
          legacy.customerId,
          legacy.departmentId,
          legacy.holderId,
          legacy.userId,
          nextAuditId,
          proofVersionId,
        ],
      );
      await expectRejected(
        client,
        "INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id,asset_version_id) VALUES ($1,$2,'right_asset_version',$3,'CUSTOMER_RIGHT_EVIDENCE',$4,$5,$6,$7)",
        [
          randomUUID(),
          legacy.departmentId,
          nextAssetVersionId,
          legacy.materialId,
          legacy.contentVersionId,
          nextAuditId,
          nextAssetVersionId,
        ],
        ['23514'],
      );
      await expectRejected(
        client,
        "INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id,asset_version_id) VALUES ($1,$2,'right_asset_version',$3,'CUSTOMER_RIGHT_EVIDENCE',$4,$5,$6,$7)",
        [
          randomUUID(),
          legacy.departmentId,
          nextAssetVersionId,
          proofMaterialId,
          proofVersionId,
          nextAuditId,
          randomUUID(),
        ],
        ['23503', '23514'],
      );
      const referenceId = randomUUID();
      await client.query(
        "INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id,asset_version_id) VALUES ($1,$2,'right_asset_version',$3,'CUSTOMER_RIGHT_EVIDENCE',$4,$5,$6,$7)",
        [
          referenceId,
          legacy.departmentId,
          nextAssetVersionId,
          proofMaterialId,
          proofVersionId,
          nextAuditId,
          nextAssetVersionId,
        ],
      );
      await client.query(
        'UPDATE customer_right_assets SET current_version_id=$2,version=2 WHERE id=$1',
        [legacy.assetId, nextAssetVersionId],
      );
      await client.query(
        "INSERT INTO customer_right_asset_receipts(id,department_id,actor_user_id,customer_id,asset_id,result_version_id,action,idempotency_key,request_fingerprint,result_customer_version) VALUES ($1,$2,$3,$4,$5,$6,'REVISE','proof-key',$7,3)",
        [
          randomUUID(),
          legacy.departmentId,
          legacy.userId,
          legacy.customerId,
          legacy.assetId,
          nextAssetVersionId,
          'b'.repeat(64),
        ],
      );
      await client.query('COMMIT');
      const pendingCount = async () =>
        Number(
          (
            await client.query(
              `SELECT COUNT(*)::int AS count FROM materials m
        JOIN content_versions cv ON cv.id = m.current_version_id
        WHERE m.id = $1 AND m.status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM material_references r WHERE r.content_version_id = cv.id
            AND r.asset_version_id IS NOT NULL)`,
              [proofMaterialId],
            )
          ).rows[0].count,
        );
      const proofVersionV2 = randomUUID();
      await client.query(
        "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,'proof-v2.pdf','application/pdf',6,$4,$5)",
        [
          proofVersionV2,
          proofMaterialId,
          `${legacy.departmentId}/${proofMaterialId}/${proofVersionV2}`,
          'c'.repeat(64),
          legacy.userId,
        ],
      );
      await client.query(
        'UPDATE materials SET current_version_id=$2 WHERE id=$1',
        [proofMaterialId, proofVersionV2],
      );
      if ((await pendingCount()) !== 1)
        throw new Error('V1 frozen but current V2 must remain pending');
      await client.query('BEGIN');
      const thirdVersionId = randomUUID();
      const thirdAuditId = randomUUID();
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,'right-asset',$4,'right-asset.revised',$5)",
        [
          thirdAuditId,
          legacy.departmentId,
          legacy.userId,
          legacy.assetId,
          {
            customerId: legacy.customerId,
            assetId: legacy.assetId,
            version: 3,
          },
        ],
      );
      await client.query(
        "INSERT INTO customer_right_asset_versions(id,asset_id,customer_id,department_id,version,action,type,name,category,holder_id,validity_mode,recorded_by_user_id,audit_event_id,evidence_content_version_ids) VALUES ($1,$2,$3,$4,3,'REVISE','TRADEMARK','CU003 V2 proof','商标权',$5,'UNKNOWN',$6,$7,ARRAY[$8]::uuid[])",
        [
          thirdVersionId,
          legacy.assetId,
          legacy.customerId,
          legacy.departmentId,
          legacy.holderId,
          legacy.userId,
          thirdAuditId,
          proofVersionV2,
        ],
      );
      await client.query(
        "INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id,asset_version_id) VALUES ($1,$2,'right_asset_version',$3,'CUSTOMER_RIGHT_EVIDENCE',$4,$5,$6,$7)",
        [
          randomUUID(),
          legacy.departmentId,
          thirdVersionId,
          proofMaterialId,
          proofVersionV2,
          thirdAuditId,
          thirdVersionId,
        ],
      );
      await client.query(
        'UPDATE customer_right_assets SET current_version_id=$2,version=3 WHERE id=$1',
        [legacy.assetId, thirdVersionId],
      );
      await client.query(
        "INSERT INTO customer_right_asset_receipts(id,department_id,actor_user_id,customer_id,asset_id,result_version_id,action,idempotency_key,request_fingerprint,result_customer_version) VALUES ($1,$2,$3,$4,$5,$6,'REVISE','proof-v2-key',$7,4)",
        [
          randomUUID(),
          legacy.departmentId,
          legacy.userId,
          legacy.customerId,
          legacy.assetId,
          thirdVersionId,
          'c'.repeat(64),
        ],
      );
      await client.query('COMMIT');
      if ((await pendingCount()) !== 0)
        throw new Error(
          'Current V2 must leave pending pool only after V2 freeze',
        );
      await client.query('BEGIN');
      await expectRejected(
        client,
        'UPDATE material_references SET content_version_id=$2 WHERE id=$1',
        [referenceId, legacy.contentVersionId],
        ['23514'],
      );
      await expectRejected(
        client,
        'DELETE FROM material_references WHERE id=$1',
        [referenceId],
        ['23514'],
      );
      await expectRejected(
        client,
        "UPDATE content_versions SET status='DELETED' WHERE id=$1",
        [proofVersionId],
        ['23514'],
      );
      await expectRejected(
        client,
        'UPDATE materials SET owner_id=$2 WHERE id=$1',
        [proofMaterialId, randomUUID()],
        ['23514'],
      );
      await client.query('ROLLBACK');
    }
    return {
      oldMigrations: oldNames.length,
      emptyChain: true,
      upgradePreserved: true,
      rollbackRetry: true,
      sqlGuards: true,
      versionAwareQuota: true,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('RESET search_path').catch(() => undefined);
    for (const schema of [emptySchema, upgradeSchema])
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
