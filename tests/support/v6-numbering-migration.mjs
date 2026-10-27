import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { PrismaClient } = requireBackend(
  resolve(process.cwd(), 'backend/dist/generated/prisma/client.js'),
);
const { AccessControlService } = requireBackend(
  resolve(
    process.cwd(),
    'backend/dist/access-control/access-control.service.js',
  ),
);
const { PrismaAccessControlStore } = requireBackend(
  resolve(
    process.cwd(),
    'backend/dist/access-control/prisma-access-control.store.js',
  ),
);
const { OrganizationService } = requireBackend(
  resolve(process.cwd(), 'backend/dist/access-control/organization.service.js'),
);
const { CustomerAccountService } = requireBackend(
  resolve(
    process.cwd(),
    'backend/dist/modules/customers/customer-account.service.js',
  ),
);
const {
  allocateCustomerBusinessId,
  allocateCustomerDailyNumber,
  resolveHistoricalNumber,
} = requireBackend(
  resolve(
    process.cwd(),
    'backend/dist/modules/business-numbering/business-numbering.service.js',
  ),
);
const { CaseCreationService } = requireBackend(
  resolve(process.cwd(), 'backend/dist/modules/cases/case-creation.service.js'),
);
const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
const last = '20261026110000_v6_customer_account_create';
const names = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/u.test(name) && name <= last)
  .sort();
const sql = (name) =>
  readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
const cutover = readFileSync(
  resolve(
    process.cwd(),
    'docs/superpowers/plans/2026-10-26-v6-numbering-cutover.draft.sql',
  ),
  'utf8',
);
const uuid = (n) => n.toString(16).padStart(32, '0');
function scopedDatabase(schema) {
  const prismaUrl = new URL(process.env.DATABASE_URL);
  prismaUrl.searchParams.set('options', `-c search_path=${schema}`);
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: prismaUrl.toString() },
      { schema },
    ),
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function verifyV6NumberingMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Requires isolated test environment');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  assert(names.at(-1) === last, '180 migration missing');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `v6number_${randomUUID().replaceAll('-', '')}`;
  const checks = [];
  let primaryError;
  let primaryFailed = false;
  const cleanup = [];
  let created = false;
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    assert(
      identity.db === 'dev_cor_test' && identity.schema === 'public',
      'Unexpected database identity',
    );
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of names) await client.query(sql(name));
    assert(
      names.length === 180,
      `Expected 180 migrations, got ${names.length}`,
    );
    checks.push('full 178+179+180 migration chain');
    const actions = (
      await client.query(
        `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace=$1::regnamespace AND t.typname='permission_action' AND enumlabel='customer.account.create'`,
        [schema],
      )
    ).rows;
    assert(actions.length === 1, 'create-only action absent');
    const grants = (
      await client.query(
        `SELECT count(*)::int AS n FROM role_grants WHERE action='customer.account.create'`,
      )
    ).rows[0].n;
    assert(grants === 0, '180 granted create-only permission');
    checks.push('180 enum added without grants');
    const department = randomUUID(),
      actor = randomUUID(),
      holder = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
      [department, 'v6 合成部门'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
      [actor, `v6-${actor}`, '合成操作员'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
      [randomUUID(), actor, department],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES($1,$2,$3,now())',
      [holder, '合成权利人', department],
    );
    await client.query(
      `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,created_at,updated_at)
      SELECT lpad(to_hex(i),32,'0')::uuid, '客户'||i, '客户'||i, $1,$2,
        '2026-10-24T00:00:00Z'::timestamptz + i * interval '1 second',now()
      FROM generate_series(1,1000) i`,
      [department, actor],
    );
    await client.query(
      `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
      [uuid(1000), actor],
    );
    const contact = randomUUID();
    await client.query(
      `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin)
      VALUES($1,$2,$3,'合成联系人','13800000000','MANUAL')`,
      [contact, uuid(1), department],
    );
    await client.query(
      `UPDATE customers SET profile_status='ADMITTED',admitted_at=now(),
      customer_type='ENTERPRISE',identity_type='BUSINESS_LICENSE',identity_number='V6-LICENSE',
      normalized_identity_number='V6-LICENSE',identity_validity_mode='LONG_TERM',
      admission_contact_name='合成联系人',admission_contact_phone='13800000000',
      compatibility_contact_id=$2,
      admission_contact_snapshot_name='合成联系人',admission_contact_snapshot_phone='13800000000',
      admission_contact_snapshot_source='NEW_ADMISSION',admission_contact_snapshot_frozen_at=now()
      WHERE id=$1`,
      [uuid(1), contact],
    );
    const before = (
      await client.query(
        `SELECT last_value FROM customer_business_number_counters`,
      )
    ).rows[0].last_value;
    assert(
      before === '-1',
      'Global sequence must remain unready before cutover',
    );
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,created_at,updated_at)
      SELECT lpad(to_hex(i+2000),32,'0')::uuid,$1,'LD-V6-'||i,$2,$3,$4,
        'CIVIL','ONLINE','TAOBAO','2026-10-25T00:00:00Z'::timestamptz,'合成店铺',false,
        '2026-10-25T00:00:00Z'::timestamptz + i * interval '1 second',now()
      FROM generate_series(1,1000) i`,
      [department, uuid(1), holder, actor],
    );
    const externalCase = randomUUID(),
      externalAudit = randomUUID(),
      externalEntry = randomUUID(),
      externalReceipt = randomUUID();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO cases(id,business_no,department_id,customer_id,rights_holder_id,responsible_user_id,stage,created_at)
      VALUES($1,'CA-V6-EXTERNAL',$2,$3,$4,$5,'PENDING_MATCH','2026-10-25T01:00:00Z')`,
      [externalCase, department, uuid(1), holder, actor],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details)
      VALUES($1,$2,$3,$3,'CASE',$4,'case.external-entry.created',$5::jsonb)`,
      [
        externalAudit,
        department,
        actor,
        externalCase,
        JSON.stringify({
          entryId: externalEntry,
          entryKind: 'EXTERNAL_TRANSFER',
          initialStage: 'PENDING_MATCH',
          stageReachedOn: '2026-10-25',
          source: '合成外录来源',
          reason: '历史补录',
        }),
      ],
    );
    const externalRecorded = await client.query(
      `INSERT INTO case_external_entries(id,case_id,department_id,entry_kind,initial_stage,stage_reached_on,source,reason,known,recorded_by_user_id,audit_event_id)
      VALUES($1,$2,$3,'EXTERNAL_TRANSFER','PENDING_MATCH','2026-10-25','合成外录来源','历史补录',
        '{"courtId":null,"courtCaseNo":null,"acceptedOn":null,"secondInstanceAcceptedOn":null,"platform":null,"shopName":null,"shopExternalId":null,"caseType":null,"infringementTypes":null}'::jsonb,$4,$5) RETURNING recorded_at`,
      [externalEntry, externalCase, department, actor, externalAudit],
    );
    await client.query(
      `INSERT INTO case_external_entry_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot)
      VALUES($1,$2,$3,$4,'v6-external',repeat('b',64),$5::jsonb)`,
      [
        externalReceipt,
        department,
        actor,
        externalCase,
        JSON.stringify({
          id: externalCase,
          businessNo: 'CA-V6-EXTERNAL',
          stage: 'PENDING_MATCH',
          version: 1,
          entryId: externalEntry,
          recordedAt: externalRecorded.rows[0].recorded_at.toISOString(),
        }),
      ],
    );
    await client.query('COMMIT');
    const office = randomUUID(),
      notary = randomUUID(),
      binding = randomUUID();
    await client.query(
      `INSERT INTO notary_offices(id,department_id,name,created_by_user_id) VALUES($1,$2,'合成公证处',$3)`,
      [office, department, actor],
    );
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES($1,$2,'合成公证员','NOTARY',now())`,
      [notary, `v6-notary-${notary}`],
    );
    await client.query(
      `INSERT INTO notary_office_account_bindings(id,user_id,department_id,notary_office_id,updated_at) VALUES($1,$2,$3,$4,now())`,
      [binding, notary, department, office],
    );
    await client.query('COMMIT');
    await client.query(
      `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,stage,version,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version)
      SELECT lpad(to_hex(10000+i),32,'0')::uuid,'NT-V6-'||i,$1,$2,$3,$4,$5,$6,'ARCHIVED',4,'ONLINE_PURCHASE','合成公证',
        jsonb_build_object('leadId',$2::uuid,'customerId',$3::uuid,'rightsHolderId',$4::uuid,'selectedProductIds','[]'::jsonb),$5,1,2
      FROM generate_series(1,101) i`,
      [department, uuid(2001), uuid(1), holder, actor, office],
    );
    await client.query(
      `INSERT INTO notary_matter_opening(matter_id,department_id,recorded_by_user_id)
      SELECT lpad(to_hex(10000+i),32,'0')::uuid,$1,$2 FROM generate_series(1,101) i`,
      [department, actor],
    );
    await client.query(
      `INSERT INTO notary_opening_review_decisions(id,matter_id,department_id,customer_id,actor_user_id,actor_kind,internal_actor_user_id,actor_display_name_snapshot,result,from_version,to_version)
      SELECT lpad(to_hex(11000+i),32,'0')::uuid,lpad(to_hex(10000+i),32,'0')::uuid,$1,$2,$3,'INTERNAL',$3,'合成操作员','INFRINGEMENT',1,2
      FROM generate_series(1,101) i`,
      [department, uuid(1), actor],
    );
    await client.query(
      `INSERT INTO notary_issuance_decisions(id,matter_id,department_id,opening_review_decision_id,actor_user_id,actor_display_name_snapshot,decision,from_version,to_version)
      SELECT lpad(to_hex(12000+i),32,'0')::uuid,lpad(to_hex(10000+i),32,'0')::uuid,$1,lpad(to_hex(11000+i),32,'0')::uuid,$2,'合成操作员','ISSUE',2,3
      FROM generate_series(1,101) i`,
      [department, actor],
    );
    await client.query(
      `INSERT INTO notary_certificates(id,matter_id,department_id,issuance_decision_id,notary_office_account_binding_id,actor_user_id,certificate_no,certificate_date,need_disclose,from_version,to_version)
      SELECT lpad(to_hex(13000+i),32,'0')::uuid,lpad(to_hex(10000+i),32,'0')::uuid,$1,lpad(to_hex(12000+i),32,'0')::uuid,$2,$3,'CERT-V6-'||i,current_date,false,3,4
      FROM generate_series(1,101) i`,
      [department, binding, notary],
    );
    await client.query(
      `INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,created_at)
      SELECT lpad(to_hex(14000+i),32,'0')::uuid,'CA-V6-'||i,$1,$2,lpad(to_hex(10000+i),32,'0')::uuid,
        lpad(to_hex(13000+i),32,'0')::uuid,$3,$4,$5,'PENDING_MATCH',
        '2026-10-25T02:00:00Z'::timestamptz + i * interval '1 second'
      FROM generate_series(1,100) i`,
      [department, uuid(2001), uuid(1), holder, actor],
    );
    const auditId = randomUUID(),
      receiptId = randomUUID();
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details)
      VALUES($1,$2,$3,'lead',$4,'lead.created','{"oldNumber":"LD-V6-1"}'::jsonb)`,
      [auditId, department, actor, uuid(2001)],
    );
    await client.query(
      `INSERT INTO lead_command_receipts(id,department_id,actor_user_id,action,idempotency_key,request_fingerprint,result_lead_id,result_lead_version,result_snapshot)
      VALUES($1,$2,$3,'lead.create','v6-original',repeat('a',64),$4,1,'{"businessNo":"LD-V6-1"}'::jsonb)`,
      [receiptId, department, actor, uuid(2001)],
    );
    const oldEvidence = (
      await client.query(
        `SELECT
      (SELECT to_jsonb(a) FROM audit_events a WHERE id=$1) AS audit,
      (SELECT to_jsonb(r) FROM lead_command_receipts r WHERE id=$2) AS receipt`,
        [auditId, receiptId],
      )
    ).rows[0];
    const oldExternalEvidence = (
      await client.query(
        `SELECT
      (SELECT to_jsonb(a) FROM audit_events a WHERE id=$1) AS audit,
      (SELECT to_jsonb(r) FROM case_external_entry_receipts r WHERE id=$2) AS receipt`,
        [externalAudit, externalReceipt],
      )
    ).rows[0];
    checks.push(
      '1000 historical customers including deleted draft, 1000 leads',
    );
    const unreadyDatabase = scopedDatabase(schema);
    try {
      await unreadyDatabase.$transaction(async (tx) => {
        async function unready(work, label) {
          try {
            await work();
            throw new Error(`${label} unexpectedly succeeded`);
          } catch (error) {
            if (error?.response?.code !== 'CUSTOMER_NUMBER_NOT_INITIALIZED')
              throw error;
          }
        }
        await unready(() => allocateCustomerBusinessId(tx), 'New customer ID');
        await unready(
          () =>
            allocateCustomerDailyNumber(tx, {
              customerId: uuid(1),
              businessId: '001',
            }),
          'New lead or external case daily ID',
        );
        await unready(
          () =>
            new CaseCreationService().createFromNotaryCertificate(tx, {
              departmentId: department,
              sourceLeadId: uuid(2001),
              sourceNotaryMatterId: uuid(10001),
              certificateId: uuid(13001),
              customerId: uuid(1),
              rightsHolderId: holder,
              responsibleUserId: actor,
              issuedAt: new Date(),
            }),
          'Normal case from old lead',
        );
      });
      assert(
        (
          await client.query(
            'SELECT count(*)::int AS n FROM customer_daily_number_counters',
          )
        ).rows[0].n === 0,
        'Unready write path consumed daily counter',
      );
      checks.push(
        'global -1 blocks customer, lead/external shared allocator and normal case before any daily count',
      );
    } finally {
      await unreadyDatabase.$disconnect();
    }
    await client.query('BEGIN');
    try {
      await client.query(
        'ALTER TABLE customers ADD CONSTRAINT v6_forced_failure CHECK (business_id IS NULL)',
      );
      await client.query(cutover);
      throw new Error('Expected cutover failure');
    } catch (error) {
      assert(
        error.code === '23514',
        `Unexpected forced failure: ${error.message}`,
      );
      await client.query('ROLLBACK');
    }
    const guard = (
      await client.query(
        `SELECT tgenabled FROM pg_trigger WHERE tgrelid='customers'::regclass AND tgname='customers_draft_deletion_guard'`,
      )
    ).rows[0];
    assert(
      guard?.tgenabled === 'O',
      'Deleted draft guard changed after failed cutover',
    );
    assert(
      (
        await client.query(
          `SELECT last_value FROM customer_business_number_counters`,
        )
      ).rows[0].last_value === '-1',
      'Counter changed after failed cutover',
    );
    assert(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM business_number_aliases`,
        )
      ).rows[0].n === 0,
      'Aliases changed after failed cutover',
    );
    checks.push('failed cutover restores guard, counter and aliases');
    await client.query(cutover);
    const c1000 = (
      await client.query('SELECT business_id FROM customers WHERE id=$1', [
        uuid(1000),
      ])
    ).rows[0].business_id;
    assert(c1000 === '1000', `Customer 1000 truncated: ${c1000}`);
    const lead1000 = (
      await client.query('SELECT business_no FROM leads WHERE id=$1', [
        uuid(3000),
      ])
    ).rows[0].business_no;
    assert(lead1000 === '001202610251000', `Daily 1000 truncated: ${lead1000}`);
    const externalNumber = (
      await client.query('SELECT business_no FROM cases WHERE id=$1', [
        externalCase,
      ])
    ).rows[0].business_no;
    assert(
      externalNumber === '001202610251001',
      `External case did not share daily sequence: ${externalNumber}`,
    );
    const normal = (
      await client.query(
        `SELECT business_no,source_lead_ordinal FROM cases
      WHERE id IN ($1,$2,$3) ORDER BY source_lead_ordinal`,
        [uuid(14001), uuid(14002), uuid(14100)],
      )
    ).rows;
    assert(
      JSON.stringify(
        normal.map(({ business_no, source_lead_ordinal }) => [
          business_no,
          source_lead_ordinal,
        ]),
      ) ===
        JSON.stringify([
          ['00120261025001', 1],
          ['00120261025001-02', 2],
          ['00120261025001-100', 100],
        ]),
      `Normal case numbering mismatch: ${JSON.stringify(normal)}`,
    );
    const liveNumberingDatabase = scopedDatabase(schema);
    try {
      const addedCase = await liveNumberingDatabase.$transaction((tx) =>
        new CaseCreationService().createFromNotaryCertificate(tx, {
          departmentId: department,
          sourceLeadId: uuid(2001),
          sourceNotaryMatterId: uuid(10101),
          certificateId: uuid(13101),
          customerId: uuid(1),
          rightsHolderId: holder,
          responsibleUserId: actor,
          issuedAt: new Date(),
        }),
      );
      assert(
        addedCase.businessNo === '00120261025001-101',
        `Current normal-case service suffix mismatch: ${addedCase.businessNo}`,
      );
    } finally {
      await liveNumberingDatabase.$disconnect();
    }
    const historicCounter = (
      await client.query(
        `SELECT last_value FROM customer_daily_number_counters WHERE customer_id=$1 AND business_date='2026-10-25'`,
        [uuid(1)],
      )
    ).rows[0].last_value;
    assert(
      historicCounter === '1001',
      'Normal cases consumed historical shared daily sequence',
    );
    assert(
      (
        await client.query(
          'SELECT last_value FROM customer_business_number_counters',
        )
      ).rows[0].last_value === '1000',
      'Final counter mismatch',
    );
    assert(
      (
        await client.query(
          `SELECT old_number FROM business_number_aliases WHERE entity_type='LEAD' AND entity_id=$1`,
          [uuid(3000)],
        )
      ).rows[0].old_number === 'LD-V6-1000',
      'Old receipt alias lost',
    );
    const newEvidence = (
      await client.query(
        `SELECT
      (SELECT to_jsonb(a) FROM audit_events a WHERE id=$1) AS audit,
      (SELECT to_jsonb(r) FROM lead_command_receipts r WHERE id=$2) AS receipt`,
        [auditId, receiptId],
      )
    ).rows[0];
    assert(
      JSON.stringify(newEvidence) === JSON.stringify(oldEvidence),
      'Audit or original receipt changed',
    );
    const newExternalEvidence = (
      await client.query(
        `SELECT
      (SELECT to_jsonb(a) FROM audit_events a WHERE id=$1) AS audit,
      (SELECT to_jsonb(r) FROM case_external_entry_receipts r WHERE id=$2) AS receipt`,
        [externalAudit, externalReceipt],
      )
    ).rows[0];
    assert(
      JSON.stringify(newExternalEvidence) ===
        JSON.stringify(oldExternalEvidence),
      'External case audit or receipt changed',
    );
    checks.push(
      'cutover preserves 1000th customer, daily 1000 and old aliases',
    );
    checks.push(
      '100 historical normal cases and current service case 101 retain guards, suffixes and no daily consumption',
    );
    const upsert = `INSERT INTO customer_daily_number_counters(customer_id,business_date,last_value)
      VALUES($1,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date,1)
      ON CONFLICT(customer_id,business_date) DO UPDATE
      SET last_value=customer_daily_number_counters.last_value+1
      RETURNING last_value,business_date`;
    const date = (
      await client.query(
        `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date AS value`,
      )
    ).rows[0].value;
    await client.query('BEGIN');
    const rolled = (await client.query(upsert, [uuid(1)])).rows[0].last_value;
    assert(rolled === '1', 'Expected first allocation on current Shanghai day');
    await client.query('ROLLBACK');
    const peer = new Client({ connectionString: process.env.DATABASE_URL });
    await peer.connect();
    try {
      await peer.query(`SET search_path TO "${schema}"`);
      const [first, second] = await Promise.all([
        client.query(upsert, [uuid(1)]),
        peer.query(upsert, [uuid(1)]),
      ]);
      const numbers = [
        first.rows[0].last_value,
        second.rows[0].last_value,
      ].sort();
      assert(
        JSON.stringify(numbers) === JSON.stringify(['1', '2']),
        `Concurrent sequence collision: ${numbers}`,
      );
      assert(
        first.rows[0].business_date.getTime() === date.getTime(),
        'Shanghai business date mismatch',
      );
      const nextDay = (
        await client.query(
          `INSERT INTO customer_daily_number_counters(customer_id,business_date,last_value)
        VALUES($1,$2::date+1,1) RETURNING last_value`,
          [uuid(1), date],
        )
      ).rows[0].last_value;
      assert(
        nextDay === '1',
        'New Shanghai business day did not reset sequence',
      );
    } finally {
      await peer.end();
    }
    checks.push(
      'rollback retry and two-client concurrency stay unique across business days',
    );
    const role = randomUUID();
    await client.query(
      `INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,'v6 合成创建角色',now())`,
      [role, department],
    );
    await client.query(
      `INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())`,
      [randomUUID(), actor, department, role],
    );
    await client.query(
      `INSERT INTO role_grants(id,role_template_id,action,scope) VALUES
      ($1,$3,'customer.read','DEPARTMENT'),($2,$3,'customer.account.create','DEPARTMENT')`,
      [randomUUID(), randomUUID(), role],
    );
    await client.query(
      `INSERT INTO role_grants(id,role_template_id,action,scope) VALUES
      ($1,$3,'customer.admit','DEPARTMENT'),($2,$3,'evidence.edit','DEPARTMENT')`,
      [randomUUID(), randomUUID(), role],
    );
    const database = scopedDatabase(schema);
    try {
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const organization = new OrganizationService(database);
      const accounts = new CustomerAccountService(
        database,
        access,
        organization,
      );
      const oldLeadAccepted = await resolveHistoricalNumber(database, {
        entityType: 'LEAD',
        entityId: uuid(2001),
        receiptNumber: 'LD-V6-1',
        currentNumber: '00120261025001',
      });
      const wrongEntityAccepted = await resolveHistoricalNumber(database, {
        entityType: 'LEAD',
        entityId: uuid(2002),
        receiptNumber: 'LD-V6-1',
        currentNumber: '00120261025002',
      });
      const oldCaseAccepted = await resolveHistoricalNumber(database, {
        entityType: 'CASE',
        entityId: externalCase,
        receiptNumber: 'CA-V6-EXTERNAL',
        currentNumber: '001202610251001',
      });
      assert(
        oldLeadAccepted && !wrongEntityAccepted && oldCaseAccepted,
        'Old receipt alias replay identity mismatch',
      );
      const actorContext = {
        userId: actor,
        departmentId: department,
        authorizationRevision: 1,
      };
      await access.authorizeCustomer(actorContext, 'customer.admit', {
        departmentId: department,
        responsibleUserId: actor,
      });
      await access.authorizeDepartmentAction(actorContext, 'evidence.edit');
      const capabilities = await accounts.capabilities(actorContext, uuid(1));
      assert(
        capabilities.canCreate && !capabilities.canManage,
        'Create-only capabilities mismatch',
      );
      const createdAccount = await accounts.create(actorContext, uuid(1), {
        displayName: '合成客户账号',
        username: `v6client${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        password: 'correct horse battery staple',
      });
      assert(
        createdAccount.accountActive && createdAccount.bindingActive,
        'Create-only grant did not create client account',
      );
      async function forbidden(work, label) {
        try {
          await work();
          throw new Error(`${label} unexpectedly succeeded`);
        } catch (error) {
          if (
            error?.response?.code !== 'ACTION_FORBIDDEN' &&
            error?.response?.code !== 'RESOURCE_NOT_FOUND'
          )
            throw error;
        }
      }
      await forbidden(
        () => accounts.list(actorContext, uuid(1)),
        'Create-only list',
      );
      await forbidden(
        () =>
          accounts.setStatus(actorContext, uuid(1), createdAccount.id, false),
        'Create-only disable',
      );
      await forbidden(
        () =>
          accounts.create(
            { ...actorContext, departmentId: randomUUID() },
            uuid(1),
            {
              displayName: '跨部门',
              username: 'v6crossdept',
              password: 'correct horse battery staple',
            },
          ),
        'Cross-department create',
      );
      await client.query(
        `DELETE FROM role_grants WHERE role_template_id=$1 AND action='customer.account.create'`,
        [role],
      );
      await forbidden(
        () =>
          accounts.create(actorContext, uuid(1), {
            displayName: '撤权后',
            username: 'v6revoked',
            password: 'correct horse battery staple',
          }),
        'Revoked create',
      );
      await access.authorizeCustomer(actorContext, 'customer.admit', {
        departmentId: department,
        responsibleUserId: actor,
      });
      await access.authorizeDepartmentAction(actorContext, 'evidence.edit');
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,'user.manage','DEPARTMENT')`,
        [randomUUID(), role],
      );
      await forbidden(
        () =>
          accounts.create(actorContext, uuid(1), {
            displayName: '管理但无创建',
            username: 'v6manageonly',
            password: 'correct horse battery staple',
          }),
        'Manage-only create',
      );
      checks.push(
        '180 real Prisma store/service create-only, admit/material retained, manage separation, cross-department and revocation',
      );
      checks.push(
        'old lead/external receipt aliases resolve only by entity UUID while snapshots stay immutable',
      );
    } finally {
      await database.$disconnect();
    }
  } catch (error) {
    primaryError = error;
    primaryFailed = true;
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      cleanup.push(error);
    }
    if (created) {
      try {
        await client.query('RESET search_path');
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      } catch (error) {
        cleanup.push(error);
      }
    }
    try {
      await client.end();
    } catch (error) {
      cleanup.push(error);
    }
  }
  if (primaryFailed && cleanup.length)
    throw new AggregateError(
      [primaryError, ...cleanup],
      'Test and cleanup failed',
    );
  if (cleanup.length) throw new AggregateError(cleanup, 'Cleanup failed');
  if (primaryFailed) throw primaryError;
  return { migrationCount: names.length, checks };
}
