import { randomUUID } from 'node:crypto';

// SQL seed adapted from tests/support/v6-followup-fixture.mjs. No connection,
// migration, cutover, trigger bypass, grant, or cleanup is performed here.
function assertSchema(schema) {
  if (!/^closure_upgrade_[a-f0-9]{32}$/u.test(schema ?? ''))
    throw new Error('Expected probe-owned upgrade schema');
}
async function assertContext(client, schema) {
  assertSchema(schema);
  const { rows } = await client.query(
    'SELECT current_schema() AS schema, current_schemas(false)::text[] AS schemas',
  );
  if (
    rows.length !== 1 ||
    rows[0].schema !== schema ||
    JSON.stringify(rows[0].schemas) !== JSON.stringify([schema])
  )
    throw new Error('Fixture requires the single probe-owned search_path');
}

export async function snapshotSynthetic196ExternalCase(client, schema, ids) {
  await assertContext(client, schema);
  const columns = {
    departments: ['id', 'name', 'updated_at'],
    user_accounts: [
      'id',
      'external_subject',
      'display_name',
      'active',
      'account_type',
      'updated_at',
    ],
    department_memberships: [
      'id',
      'user_id',
      'department_id',
      'active',
      'updated_at',
    ],
    rights_holders: ['id', 'name', 'department_id', 'updated_at'],
    customers: [
      'id',
      'name',
      'normalized_name',
      'department_id',
      'responsible_user_id',
      'profile_status',
      'identity_number',
      'compatibility_contact_id',
      'updated_at',
    ],
    customer_rights_holder_links: [
      'id',
      'customer_id',
      'rights_holder_id',
      'department_id',
    ],
    customer_contacts: [
      'id',
      'customer_id',
      'department_id',
      'name',
      'phone',
      'origin',
    ],
    cases: [
      'id',
      'business_no',
      'department_id',
      'customer_id',
      'rights_holder_id',
      'responsible_user_id',
      'stage',
      'version',
      'created_at',
    ],
    audit_events: [
      'id',
      'department_id',
      'actor_user_id',
      'internal_actor_user_id',
      'resource_type',
      'resource_id',
      'action',
      'details',
    ],
    case_external_entries: [
      'id',
      'case_id',
      'department_id',
      'entry_kind',
      'initial_stage',
      'stage_reached_on',
      'source',
      'reason',
      'known',
      'recorded_by_user_id',
      'audit_event_id',
      'recorded_at',
    ],
    case_external_entry_receipts: [
      'id',
      'department_id',
      'actor_user_id',
      'case_id',
      'idempotency_key',
      'request_fingerprint',
      'result_snapshot',
    ],
  };
  const selectors = {
    departments: ['id', ids.departmentId],
    user_accounts: ['id', ids.actorUserId],
    cases: ['id', ids.caseId],
    audit_events: ['id', ids.auditId],
    case_external_entries: ['id', ids.entryId],
    case_external_entry_receipts: ['id', ids.receiptId],
    rights_holders: ['id', ids.rightsHolderId],
    customers: ['id', ids.customerId],
    department_memberships: ['department_id', ids.departmentId],
    customer_rights_holder_links: ['customer_id', ids.customerId],
    customer_contacts: ['customer_id', ids.customerId],
  };
  const snapshot = {};
  for (const [table, fields] of Object.entries(columns)) {
    const [key, value] = selectors[table];
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value ?? ''))
      throw new Error('Invalid fixture ID');
    const { rows } = await client.query(
      `SELECT to_jsonb(row) AS row FROM (SELECT ${fields.join(',')} FROM ${table} WHERE ${key}=$1 ORDER BY id) row`,
      [value],
    );
    if (rows.length !== 1)
      throw new Error(`Incomplete synthetic fixture: ${table}`);
    snapshot[table] = rows.map(({ row }) => row);
  }
  return snapshot;
}

export async function seedSynthetic196ExternalCase(client, schema) {
  await assertContext(client, schema);
  await client.query('BEGIN');
  try {
    const owner = await seedInternalCustomer(client);
    const source = await seedExternalCase(client, owner);
    const { oldBusinessNo: ignored, ...sourceIds } = source;
    void ignored;
    const ids = { ...owner, ...sourceIds };
    const snapshot = await snapshotSynthetic196ExternalCase(
      client,
      schema,
      ids,
    );
    // Force all deferred identity/audit/receipt guards before returning evidence.
    await client.query('COMMIT');
    return { ids, snapshot };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
async function seedInternalCustomer(client) {
  const departmentId = randomUUID();
  const actorUserId = randomUUID();
  const customerId = randomUUID();
  const rightsHolderId = randomUUID();
  const contactId = randomUUID();
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
    [departmentId, `196合成部门-${departmentId.slice(0, 8)}`],
  );
  await client.query(
    'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
    [actorUserId, `closure-196-synthetic-${actorUserId}`, '合成运营'],
  );
  await client.query(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
    [randomUUID(), actorUserId, departmentId],
  );
  await client.query(
    'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES($1,$2,$3,now())',
    [rightsHolderId, '合成权利人', departmentId],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at)
     VALUES($1,'合成客户','合成客户',$2,$3,now())`,
    [customerId, departmentId, actorUserId],
  );
  await client.query(
    `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
     VALUES($1,$2,$3,$4)`,
    [randomUUID(), customerId, rightsHolderId, departmentId],
  );
  await client.query(
    `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin)
     VALUES($1,$2,$3,'合成联系人','13800000000','MANUAL')`,
    [contactId, customerId, departmentId],
  );
  await client.query(
    `UPDATE customers SET profile_status='ADMITTED', admitted_at=now(),
      customer_type='ENTERPRISE', identity_type='BUSINESS_LICENSE',
      identity_number='CLOSURE-196-SYNTHETIC',
      normalized_identity_number='CLOSURE-196-SYNTHETIC',
      identity_validity_mode='LONG_TERM',
      admission_contact_name='合成联系人', admission_contact_phone='13800000000',
      compatibility_contact_id=$2,
      admission_contact_snapshot_name='合成联系人',
      admission_contact_snapshot_phone='13800000000',
      admission_contact_snapshot_source='NEW_ADMISSION',
      admission_contact_snapshot_frozen_at=now()
     WHERE id=$1`,
    [customerId, contactId],
  );
  return { departmentId, actorUserId, customerId, rightsHolderId };
}

async function seedExternalCase(client, owner, options = {}) {
  const caseId = randomUUID();
  const entryId = randomUUID();
  const auditId = randomUUID();
  const receiptId = randomUUID();
  const oldBusinessNo = `CA-SYNTHETIC-${caseId.slice(0, 8)}`;
  const createdAt = options.createdAt ?? '2026-10-25T01:00:00Z';
  const stageReachedOn = options.stageReachedOn ?? '2026-10-25';
  const stage = options.stage ?? 'PENDING_MATCH';
  const source = '合成外录来源';
  const reason = '历史补录';

  await client.query(
    `INSERT INTO cases(id,business_no,department_id,customer_id,rights_holder_id,
         responsible_user_id,stage,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      caseId,
      oldBusinessNo,
      owner.departmentId,
      owner.customerId,
      owner.rightsHolderId,
      owner.actorUserId,
      stage,
      createdAt,
    ],
  );
  await client.query(
    `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
         resource_type,resource_id,action,details)
       VALUES($1,$2,$3,$3,'CASE',$4,'case.external-entry.created',$5::jsonb)`,
    [
      auditId,
      owner.departmentId,
      owner.actorUserId,
      caseId,
      JSON.stringify({
        entryId,
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: stage,
        stageReachedOn,
        source,
        reason,
      }),
    ],
  );
  const entry = await client.query(
    `INSERT INTO case_external_entries(id,case_id,department_id,entry_kind,
         initial_stage,stage_reached_on,source,reason,known,recorded_by_user_id,audit_event_id)
       VALUES($1,$2,$3,'EXTERNAL_TRANSFER',$4,$5,$6,$7,
         '{"courtId":null,"courtCaseNo":null,"acceptedOn":null,"secondInstanceAcceptedOn":null,"platform":null,"shopName":null,"shopExternalId":null,"caseType":null,"infringementTypes":null}'::jsonb,$8,$9)
       RETURNING recorded_at`,
    [
      entryId,
      caseId,
      owner.departmentId,
      stage,
      stageReachedOn,
      source,
      reason,
      owner.actorUserId,
      auditId,
    ],
  );
  await client.query(
    `INSERT INTO case_external_entry_receipts(id,department_id,actor_user_id,
         case_id,idempotency_key,request_fingerprint,result_snapshot)
       VALUES($1,$2,$3,$4,$5,repeat('b',64),$6::jsonb)`,
    [
      receiptId,
      owner.departmentId,
      owner.actorUserId,
      caseId,
      `closure-196-external-${caseId}`,
      JSON.stringify({
        id: caseId,
        businessNo: oldBusinessNo,
        stage,
        version: 1,
        entryId,
        recordedAt: entry.rows[0].recorded_at.toISOString(),
      }),
    ],
  );
  return { caseId, entryId, auditId, receiptId, oldBusinessNo };
}
