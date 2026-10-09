import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureTestEnvironment } from '../../scripts/test-environment.mjs';
import { acquireE2eResourceLock } from '../../scripts/run-e2e.mjs';

const root = resolve(import.meta.dirname, '../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20261009030000_customer_cooperation';
const previous = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/u.test(name) && name < target)
  .sort();
if (previous.length !== 100)
  throw new Error(
    `Expected 100 supported migrations, found ${previous.length}`,
  );
const schemas = [
  `cu005_empty_${randomBytes(8).toString('hex')}`,
  `cu005_upgrade_${randomBytes(8).toString('hex')}`,
];
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});

async function apply(names) {
  for (const name of names) {
    const sql = readFileSync(
      resolve(migrationRoot, name, 'migration.sql'),
      'utf8',
    );
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
  }
}

async function count(sql) {
  return (await client.query(sql)).rows[0].count;
}

async function rejects(sql, params, code, text) {
  await client.query('SAVEPOINT cu005_negative');
  try {
    await client.query(sql, params);
    throw new Error(`${text}: unexpectedly succeeded`);
  } catch (error) {
    if (error.code !== code || !error.message.includes(text)) throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT cu005_negative');
  }
}

async function seed() {
  const ids = {
    department: randomUUID(),
    actor: randomUUID(),
    target: randomUUID(),
    draft: randomUUID(),
    admitted: randomUUID(),
    holder: randomUUID(),
    link: randomUUID(),
    lead: randomUUID(),
    audit: randomUUID(),
    oldFact: randomUUID(),
    oldReceipt: randomUUID(),
  };
  await client.query(
    "INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU005',now())",
    [ids.department],
  );
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,updated_at)
     VALUES ($1,$3,'当前运营',now()),($2,$4,'目标运营',now())`,
    [ids.actor, ids.target, `cu005-${ids.actor}`, `cu005-${ids.target}`],
  );
  await client.query(
    `INSERT INTO department_memberships(id,user_id,department_id,updated_at)
     VALUES (gen_random_uuid(),$1,$3,now()),(gen_random_uuid(),$2,$3,now())`,
    [ids.actor, ids.target, ids.department],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,profile_status,department_id,
       responsible_user_id,version,updated_at)
     VALUES ($1,'维护草稿','维护草稿','DRAFT',$2,$3,1,now())`,
    [ids.draft, ids.department, ids.actor],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,profile_status,department_id,
       responsible_user_id,version,updated_at,customer_type,identity_type,
       identity_number,normalized_identity_number,admission_contact_name,
       admission_contact_phone,identity_validity_mode,admitted_at,ever_admitted)
     VALUES ($1,'已准入客户','已准入客户','ADMITTED',$2,$3,1,now(),
       'ENTERPRISE','BUSINESS_LICENSE','91310000TEST123456','91310000TEST123456',
       '客户联系人','13800138000','LONG_TERM',now(),true)`,
    [ids.admitted, ids.department, ids.actor],
  );
  await client.query(
    `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2,version=2 WHERE id=$1`,
    [ids.draft, ids.actor],
  );
  await client.query(
    `UPDATE customers SET deleted_at=NULL,deleted_by_user_id=NULL,version=3 WHERE id=$1`,
    [ids.draft],
  );
  await client.query(
    `INSERT INTO rights_holders(id,name,department_id,updated_at)
     VALUES ($1,'权利主体',$2,now())`,
    [ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
     VALUES ($1,$2,$3,$4)`,
    [ids.link, ids.admitted, ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action)
     VALUES ($1,$2,$3,'customer',$4,'customer.draft-restored')`,
    [ids.audit, ids.department, ids.actor, ids.draft],
  );
  await client.query(
    `INSERT INTO customer_draft_lifecycle_facts(id,customer_id,department_id,action,actor_user_id,
       from_version,to_version,audit_event_id)
     VALUES ($1,$2,$3,'RESTORE',$4,2,3,$5)`,
    [ids.oldFact, ids.draft, ids.department, ids.actor, ids.audit],
  );
  await client.query(
    `INSERT INTO customer_draft_lifecycle_receipts(id,department_id,actor_user_id,idempotency_key,
       request_fingerprint,action,customer_id,result_snapshot,fact_id)
     VALUES ($1,$2,$3,'old-key',repeat('a',64),'RESTORE',$4,
       jsonb_build_object('id',($4::uuid)::text,'version',3),$5)`,
    [ids.oldReceipt, ids.department, ids.actor, ids.draft, ids.oldFact],
  );
  await leadInsert(ids, ids.admitted, 'legacy', ids.lead);
  return ids;
}

async function leadInsert(ids, customerId, suffix, id = randomUUID()) {
  return client.query(
    `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
       responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
     VALUES ($6,$1,$2,$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'合法店铺',false,now())`,
    [
      ids.department,
      `CU005-${suffix}-${randomBytes(4).toString('hex')}`,
      customerId,
      ids.holder,
      ids.actor,
      id,
    ],
  );
}

// This is a synthetic, legal schema-100 archive. It does not claim that an old
// HTTP process issued the certificate; the browser E2E covers real issuance.
async function seedArchivedCase(ids) {
  const legacy = {
    client: randomUUID(),
    clientBinding: randomUUID(),
    leadReview: randomUUID(),
    product: randomUUID(),
    office: randomUUID(),
    matter: randomUUID(),
    openingMaterial: randomUUID(),
    openingVersion: randomUUID(),
    openingAudit: randomUUID(),
    openingReview: randomUUID(),
    issuance: randomUUID(),
    issuanceAudit: randomUUID(),
    notary: randomUUID(),
    notaryBinding: randomUUID(),
    certificateMaterial: randomUUID(),
    certificateVersion: randomUUID(),
    certificate: randomUUID(),
    case: randomUUID(),
    certificateAudit: randomUUID(),
    certificateReference: randomUUID(),
    certificateReceipt: randomUUID(),
  };
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at)
       VALUES ($1,$2,'历史客户账号','CLIENT',now())`,
      [legacy.client, `cu005-client-${legacy.client}`],
    );
    await client.query(
      `INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at)
       VALUES ($1,$2,$3,$4,now())`,
      [legacy.clientBinding, legacy.client, ids.admitted, ids.department],
    );
    await client.query(
      `INSERT INTO lead_products(id,lead_id,position,title,quantity,unit_price,comment_count,estimated_amount)
       VALUES ($1,$2,1,'历史商品',1,10.00,0,10.00)`,
      [legacy.product, ids.lead],
    );
    await client.query(
      `INSERT INTO lead_infringements(id,lead_id,infringement_type)
       VALUES (gen_random_uuid(),$1,'TRADEMARK')`,
      [ids.lead],
    );
    await client.query(
      `UPDATE leads SET status='WAITING_REVIEW',version=2,pushed_at=now(),pushed_by_user_id=$2
       WHERE id=$1`,
      [ids.lead, ids.actor],
    );
    await client.query(
      `INSERT INTO lead_review_decisions(id,department_id,lead_id,customer_id,reviewer_user_id,
         customer_account_binding_id,reviewer_display_name_snapshot,result,from_version,to_version)
       VALUES ($1,$2,$3,$4,$5,$6,'历史客户账号','INFRINGEMENT',2,3)`,
      [
        legacy.leadReview,
        ids.department,
        ids.lead,
        ids.admitted,
        legacy.client,
        legacy.clientBinding,
      ],
    );
    await client.query(
      `UPDATE leads SET status='WAITING_EVIDENCE_DECISION',version=3,active_review_decision_id=$2
       WHERE id=$1`,
      [ids.lead, legacy.leadReview],
    );
    await client.query(
      `INSERT INTO notary_offices(id,department_id,name,created_by_user_id,updated_at)
       VALUES ($1,$2,'CU005 历史公证处',$3,now())`,
      [legacy.office, ids.department, ids.actor],
    );
    await client.query(
      `UPDATE leads SET status='TRANSFERRED_TO_NOTARY',version=4 WHERE id=$1`,
      [ids.lead],
    );
    const sourceSnapshot = {
      leadId: ids.lead,
      customerId: ids.admitted,
      rightsHolderId: ids.holder,
      selectedProductIds: [legacy.product],
    };
    await client.query(
      `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,
         customer_id,rights_holder_id,responsible_user_id,notary_office_id,
         evidence_mode,batch_purpose,source_snapshot,created_by_user_id,
         from_lead_version,to_lead_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ONLINE_PURCHASE','历史公证取证',$9::jsonb,$7,3,4)`,
      [
        legacy.matter,
        `CU005-M-${legacy.matter}`,
        ids.department,
        ids.lead,
        ids.admitted,
        ids.holder,
        ids.actor,
        legacy.office,
        JSON.stringify(sourceSnapshot),
      ],
    );
    await client.query(
      `INSERT INTO notary_matter_products(notary_matter_id,source_lead_id,lead_product_id)
       VALUES ($1,$2,$3)`,
      [legacy.matter, ids.lead, legacy.product],
    );
    await client.query(
      `INSERT INTO notary_matter_evidence(matter_id,department_id,evidence_at,
         sample_fee_state,sample_fee_amount,recorded_by_user_id)
       VALUES ($1,$2,current_date,'PENDING',NULL,$3)`,
      [legacy.matter, ids.department, ids.actor],
    );
    await client.query(
      `INSERT INTO notary_matter_logistics(id,matter_id,position,company_state,tracking_state)
       VALUES (gen_random_uuid(),$1,1,'NONE','NONE')`,
      [legacy.matter],
    );
    await client.query(
      `UPDATE notary_matters SET stage='WAITING_UNBOX',version=2 WHERE id=$1`,
      [legacy.matter],
    );
    await seedMaterial(
      legacy.openingMaterial,
      legacy.openingVersion,
      'NOTARY_OPENING_PHOTO',
      'historical-opening.jpg',
      'image/jpeg',
      ids.actor,
      legacy.matter,
      ids.department,
    );
    await client.query(
      `INSERT INTO notary_matter_opening(matter_id,department_id,recorded_by_user_id)
       VALUES ($1,$2,$3)`,
      [legacy.matter, ids.department, ids.actor],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details)
       VALUES ($1,$2,$3,'notary_matter',$4,'notary.opening_recorded',$5::jsonb)`,
      [
        legacy.openingAudit,
        ids.department,
        ids.actor,
        legacy.matter,
        JSON.stringify({ contentVersionIds: [legacy.openingVersion] }),
      ],
    );
    await client.query(
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,
         material_id,content_version_id,action_event_id)
       VALUES (gen_random_uuid(),$1,'notary_matter',$2,'NOTARY_OPENING_PHOTO',$3,$4,$5)`,
      [
        ids.department,
        legacy.matter,
        legacy.openingMaterial,
        legacy.openingVersion,
        legacy.openingAudit,
      ],
    );
    await client.query(
      `UPDATE notary_matters SET stage='UNBOX_REVIEW',version=3 WHERE id=$1`,
      [legacy.matter],
    );
    await client.query(
      `INSERT INTO notary_opening_review_decisions(id,matter_id,department_id,customer_id,
         actor_user_id,actor_kind,internal_actor_user_id,actor_display_name_snapshot,
         result,from_version,to_version)
       VALUES ($1,$2,$3,$4,$5,'INTERNAL',$5,'当前运营','INFRINGEMENT',3,4)`,
      [
        legacy.openingReview,
        legacy.matter,
        ids.department,
        ids.admitted,
        ids.actor,
      ],
    );
    await client.query(
      `UPDATE notary_matters SET stage='ISSUANCE_DECISION',version=4 WHERE id=$1`,
      [legacy.matter],
    );
    await client.query(
      `INSERT INTO notary_issuance_decisions(id,matter_id,department_id,
         opening_review_decision_id,actor_user_id,actor_display_name_snapshot,
         decision,from_version,to_version)
       VALUES ($1,$2,$3,$4,$5,'当前运营','ISSUE',4,5)`,
      [
        legacy.issuance,
        legacy.matter,
        ids.department,
        legacy.openingReview,
        ids.actor,
      ],
    );
    await client.query(
      `INSERT INTO notary_issuance_decision_audit_events(id,issuance_decision_id,
         matter_id,department_id,actor_user_id,decision,matter_version,action)
       VALUES ($1,$2,$3,$4,$5,'ISSUE',5,'notary.issuance.decide.succeeded')`,
      [
        legacy.issuanceAudit,
        legacy.issuance,
        legacy.matter,
        ids.department,
        ids.actor,
      ],
    );
    await client.query(
      `UPDATE notary_matters SET stage='WAITING_CERTIFICATE',version=5 WHERE id=$1`,
      [legacy.matter],
    );
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at)
       VALUES ($1,$2,'历史公证员','NOTARY',now())`,
      [legacy.notary, `cu005-notary-${legacy.notary}`],
    );
    await client.query(
      `INSERT INTO notary_office_account_bindings(id,user_id,department_id,
         notary_office_id,updated_at)
       VALUES ($1,$2,$3,$4,now())`,
      [legacy.notaryBinding, legacy.notary, ids.department, legacy.office],
    );
    await seedMaterial(
      legacy.certificateMaterial,
      legacy.certificateVersion,
      'NOTARY_CERTIFICATE',
      'historical-certificate.pdf',
      'application/pdf',
      legacy.notary,
      legacy.matter,
      ids.department,
    );
    await client.query(
      `UPDATE notary_matters SET stage='ARCHIVED',version=6 WHERE id=$1`,
      [legacy.matter],
    );
    await client.query(
      `INSERT INTO notary_certificates(id,matter_id,department_id,issuance_decision_id,
         notary_office_account_binding_id,actor_user_id,certificate_no,
         certificate_date,need_disclose,from_version,to_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,current_date,false,5,6)`,
      [
        legacy.certificate,
        legacy.matter,
        ids.department,
        legacy.issuance,
        legacy.notaryBinding,
        legacy.notary,
        `CU005-CERT-${legacy.certificate}`,
      ],
    );
    await client.query(
      `INSERT INTO notary_certificate_fees(certificate_id,category,state,amount)
       VALUES ($1,'NOTARY','KNOWN',120.00),($1,'INVESTIGATION','PENDING',NULL),
         ($1,'DISCLOSURE','KNOWN',0.00)`,
      [legacy.certificate],
    );
    await client.query(
      `INSERT INTO case_number_counters(business_date,last_value,updated_at)
       VALUES (current_date,1,now())`,
    );
    await client.query(
      `INSERT INTO cases(id,business_no,department_id,source_lead_id,
         source_notary_matter_id,certificate_id,customer_id,rights_holder_id,
         responsible_user_id,stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING_MATCH')`,
      [
        legacy.case,
        `CU005-CASE-${legacy.case}`,
        ids.department,
        ids.lead,
        legacy.matter,
        legacy.certificate,
        ids.admitted,
        ids.holder,
        ids.actor,
      ],
    );
    const auditDetails = {
      certificateId: legacy.certificate,
      caseId: legacy.case,
      certificateNo: `CU005-CERT-${legacy.certificate}`,
      fromStage: 'WAITING_CERTIFICATE',
      toStage: 'ARCHIVED',
      fromVersion: 5,
      toVersion: 6,
      contentVersionIds: [legacy.certificateVersion],
      disclosureContentVersionIds: [],
    };
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,
         notary_office_account_binding_id,resource_type,resource_id,action,details)
       VALUES ($1,$2,$3,$4,'notary_matter',$5,'notary.certificate_issued',$6::jsonb)`,
      [
        legacy.certificateAudit,
        ids.department,
        legacy.notary,
        legacy.notaryBinding,
        legacy.matter,
        JSON.stringify(auditDetails),
      ],
    );
    await client.query(
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,
         material_id,content_version_id,action_event_id)
       VALUES ($1,$2,'notary_matter',$3,'NOTARY_CERTIFICATE',$4,$5,$6)`,
      [
        legacy.certificateReference,
        ids.department,
        legacy.matter,
        legacy.certificateMaterial,
        legacy.certificateVersion,
        legacy.certificateAudit,
      ],
    );
    await client.query(
      `INSERT INTO notary_matter_command_receipts(id,department_id,actor_user_id,
         notary_office_account_binding_id,action,idempotency_key,
         request_fingerprint,result_matter_id,result_matter_version,result_snapshot)
       VALUES ($1,$2,$3,$4,'notary.certificate.issue','legacy-certificate-key',
         repeat('c',64),$5,6,$6::jsonb)`,
      [
        legacy.certificateReceipt,
        ids.department,
        legacy.notary,
        legacy.notaryBinding,
        legacy.matter,
        JSON.stringify({
          id: legacy.matter,
          stage: 'ARCHIVED',
          version: 6,
          case: { id: legacy.case, stage: 'PENDING_MATCH' },
        }),
      ],
    );
    await client.query('COMMIT');
    return legacy;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedMaterial(
  materialId,
  versionId,
  category,
  filename,
  mime,
  actorId,
  matterId,
  departmentId,
) {
  await client.query(
    `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at)
     VALUES ($1,$2,'NOTARY_MATTER',$3,$4::material_category,$4::text,now())`,
    [materialId, departmentId, matterId, category],
  );
  await client.query(
    `INSERT INTO content_versions(id,material_id,storage_key,original_filename,
       mime_type,size_bytes,sha256,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,8,repeat('a',64),$6)`,
    [
      versionId,
      materialId,
      `cu005-synthetic/${versionId}`,
      filename,
      mime,
      actorId,
    ],
  );
  await client.query('UPDATE materials SET current_version_id=$2 WHERE id=$1', [
    materialId,
    versionId,
  ]);
}

async function archivedCaseSnapshot(ids, legacy) {
  const rows = {};
  for (const [name, table, id] of [
    ['customer', 'customers', ids.admitted],
    ['lead', 'leads', ids.lead],
    ['matter', 'notary_matters', legacy.matter],
    ['review', 'notary_opening_review_decisions', legacy.openingReview],
    ['issuance', 'notary_issuance_decisions', legacy.issuance],
    ['certificate', 'notary_certificates', legacy.certificate],
    ['case', 'cases', legacy.case],
    ['audit', 'audit_events', legacy.certificateAudit],
    ['reference', 'material_references', legacy.certificateReference],
    ['receipt', 'notary_matter_command_receipts', legacy.certificateReceipt],
  ]) {
    const result = await client.query(
      `SELECT to_jsonb(t) AS body FROM ${table} t WHERE id=$1`,
      [id],
    );
    if (result.rowCount !== 1) throw new Error(`Legacy ${name} missing`);
    rows[name] = result.rows[0].body;
  }
  rows.fees = (
    await client.query(
      `SELECT to_jsonb(f) AS body FROM notary_certificate_fees f
     WHERE certificate_id=$1 ORDER BY category`,
      [legacy.certificate],
    )
  ).rows.map((row) => row.body);
  if (rows.fees.length !== 3)
    throw new Error('Legacy certificate fees missing');
  const joined = await count(
    `SELECT count(*)::int AS count FROM cases c
     JOIN leads l ON l.id=c.source_lead_id AND l.customer_id=c.customer_id
       AND l.department_id=c.department_id
     JOIN customers u ON u.id=c.customer_id AND u.department_id=c.department_id
     JOIN rights_holders h ON h.id=c.rights_holder_id AND h.department_id=c.department_id
     JOIN notary_matters m ON m.id=c.source_notary_matter_id
       AND m.source_lead_id=l.id AND m.customer_id=u.id AND m.rights_holder_id=h.id
       AND m.department_id=c.department_id AND m.stage='ARCHIVED'
     JOIN notary_issuance_decisions d ON d.matter_id=m.id AND d.decision='ISSUE'
     JOIN notary_certificates n ON n.id=c.certificate_id AND n.matter_id=m.id
       AND n.issuance_decision_id=d.id
     JOIN audit_events a ON a.id='${legacy.certificateAudit}'
       AND a.resource_id=m.id AND a.action='notary.certificate_issued'
       AND a.details->>'certificateId'=n.id::text
     JOIN material_references r ON r.id='${legacy.certificateReference}'
       AND r.action_event_id=a.id AND r.resource_id=m.id
       AND r.purpose='NOTARY_CERTIFICATE'
     JOIN notary_matter_command_receipts p ON p.id='${legacy.certificateReceipt}'
       AND p.result_matter_id=m.id AND p.result_matter_version=6
     WHERE c.id='${legacy.case}' AND u.ever_admitted AND u.deleted_at IS NULL`,
  );
  if (joined !== 1)
    throw new Error('Legacy Case provenance is not a single legal chain');
  return rows;
}

async function run() {
  await client.connect();
  try {
    const database = (await client.query('SELECT current_database() AS name'))
      .rows[0]?.name;
    if (database !== 'dev_cor_test')
      throw new Error('Migration probe requires dev_cor_test');
    for (const schema of schemas) {
      if (!/^cu005_(empty|upgrade)_[a-f0-9]{16}$/u.test(schema))
        throw new Error('Unsafe random schema name');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await apply(previous);
      if (schema.includes('_upgrade_')) {
        const ids = await seed();
        const legacy = await seedArchivedCase(ids);
        const caseBefore = await archivedCaseSnapshot(ids, legacy);
        const before = {
          customers: await count(
            'SELECT count(*)::int AS count FROM customers',
          ),
          leads: await count('SELECT count(*)::int AS count FROM leads'),
          audits: await count(
            'SELECT count(*)::int AS count FROM audit_events',
          ),
          receipt: (
            await client.query(
              'SELECT to_jsonb(r) AS body FROM customer_draft_lifecycle_receipts r WHERE id=$1',
              [ids.oldReceipt],
            )
          ).rows[0]?.body,
        };
        // A preexisting object forces a late DDL failure. The migration's
        // earlier enum/column/table changes must all roll back.
        await client.query('CREATE TABLE customer_maintenance_facts(id uuid)');
        let failed = false;
        try {
          await apply([target]);
        } catch (error) {
          if (!error.message.includes('already exists')) throw error;
          await client.query('ROLLBACK');
          failed = true;
        }
        if (!failed) throw new Error('Injected DDL failure did not occur');
        if (
          (await count(
            `SELECT count(*)::int AS count FROM information_schema.columns
           WHERE table_schema='${schema}' AND table_name='customers'
             AND column_name='cooperation_status'`,
          )) !== 0
        )
          throw new Error('Failed DDL left the cooperation column');
        await client.query('DROP TABLE customer_maintenance_facts');
        await apply([target]);
        const after = {
          customers: await count(
            'SELECT count(*)::int AS count FROM customers',
          ),
          leads: await count('SELECT count(*)::int AS count FROM leads'),
          audits: await count(
            'SELECT count(*)::int AS count FROM audit_events',
          ),
          receipt: (
            await client.query(
              'SELECT to_jsonb(r) AS body FROM customer_draft_lifecycle_receipts r WHERE id=$1',
              [ids.oldReceipt],
            )
          ).rows[0]?.body,
        };
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error(
            'Old customers or lifecycle receipt changed during upgrade',
          );
        const caseAfter = await archivedCaseSnapshot(ids, legacy);
        // Migration 101 adds this column to the old customer only.
        delete caseAfter.customer.cooperation_status;
        if (JSON.stringify(caseBefore) !== JSON.stringify(caseAfter))
          throw new Error(
            'Legal legacy Case or certificate provenance changed during upgrade',
          );
        if (
          (await count(
            "SELECT count(*)::int AS count FROM customers WHERE cooperation_status='COOPERATING'",
          )) !== 2
        )
          throw new Error('Old customers were not backfilled as cooperating');

        await client.query('BEGIN');
        try {
          await leadInsert(ids, ids.admitted, 'cooperating');
          await client.query(
            `UPDATE customers SET cooperation_status='PAUSED',version=version+1 WHERE id=$1`,
            [ids.admitted],
          );
          await rejects(
            `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
               responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'合法店铺',false,now())`,
            [
              ids.department,
              `CU005-paused-${randomUUID()}`,
              ids.admitted,
              ids.holder,
              ids.actor,
            ],
            '23514',
            'customer unavailable for new lead',
          );
          await client.query(
            'UPDATE leads SET remark=$2 WHERE customer_id=$1',
            [ids.admitted, '存量可编辑'],
          );
          await client.query(
            `UPDATE customers SET cooperation_status='TERMINATED' WHERE id=$1`,
            [ids.admitted],
          );
          await rejects(
            `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
               responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'合法店铺',false,now())`,
            [
              ids.department,
              `CU005-terminated-${randomUUID()}`,
              ids.admitted,
              ids.holder,
              ids.actor,
            ],
            '23514',
            'customer unavailable for new lead',
          );
          await client.query(
            `UPDATE customers SET cooperation_status='COOPERATING' WHERE id=$1`,
            [ids.admitted],
          );
          await leadInsert(ids, ids.admitted, 'resumed');

          // Customer maintenance evidence does not create a CU004 business
          // association: an unadmitted, otherwise empty draft remains deletable.
          const audit = randomUUID();
          const fact = randomUUID();
          await client.query(
            `UPDATE customers SET cooperation_status='PAUSED',version=version+1 WHERE id=$1`,
            [ids.draft],
          );
          await client.query(
            `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action)
             VALUES ($1,$2,$3,'customer',$4,'customer.cooperation-pause')`,
            [audit, ids.department, ids.actor, ids.draft],
          );
          await client.query(
            `INSERT INTO customer_maintenance_facts(id,customer_id,department_id,action,actor_user_id,
               from_version,to_version,from_cooperation_status,to_cooperation_status,reason,audit_event_id)
             VALUES ($1,$2,$3,'PAUSE',$4,3,4,'COOPERATING','PAUSED','人工暂停',$5)`,
            [fact, ids.draft, ids.department, ids.actor, audit],
          );
          await client.query(
            `INSERT INTO customer_maintenance_receipts(id,department_id,actor_user_id,idempotency_key,
               request_fingerprint,action,customer_id,fact_id)
             VALUES (gen_random_uuid(),$1,$2,'maintenance-key',repeat('b',64),'PAUSE',$3,$4)`,
            [ids.department, ids.actor, ids.draft, fact],
          );
          await rejects(
            `UPDATE customer_maintenance_facts SET reason='changed' WHERE id=$1`,
            [fact],
            '23514',
            'immutable',
          );
          await rejects(
            `UPDATE customer_maintenance_receipts SET idempotency_key='changed' WHERE fact_id=$1`,
            [fact],
            '23514',
            'immutable',
          );
          await client.query(
            `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2,version=version+1 WHERE id=$1`,
            [ids.draft, ids.actor],
          );
          if (
            (await count(
              `SELECT count(*)::int AS count FROM customers WHERE id='${ids.draft}' AND deleted_at IS NOT NULL`,
            )) !== 1
          )
            throw new Error(
              'Maintenance history blocked eligible draft deletion',
            );
          await client.query('ROLLBACK');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        console.log(
          '100 -> 101 upgrade, legal synthetic archived Case preserved with ordinary triggers/FKs, DDL rollback/retry, old receipt preservation, lead INSERT guard and draft deletion passed',
        );
      } else {
        await apply([target]);
        if (
          (await count(
            `SELECT count(*)::int AS count FROM information_schema.columns
             WHERE table_schema='${schema}' AND column_name='cooperation_status'
               AND table_name='customers'`,
          )) !== 1
        )
          throw new Error('Empty-chain cooperation column missing');
        console.log('101-migration empty chain passed');
      }
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SET search_path TO public').catch(() => {});
    for (const schema of schemas) {
      if (/^cu005_(empty|upgrade)_[a-f0-9]{16}$/u.test(schema))
        await client
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .catch(() => {});
    }
    await client.end();
  }
}

export async function verifyCustomerCooperationMigration() {
  const lock = acquireE2eResourceLock();
  try {
    await run();
  } finally {
    lock.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  verifyCustomerCooperationMigration().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
