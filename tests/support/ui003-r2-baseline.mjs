import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
export const ui003R2Instance = Object.freeze({
  project: 'dev-cor-ui003-r2',
  containerId:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  host: '127.0.0.1',
  port: 15438,
  database: 'dev_cor_test',
});

// Statically copied from the approved 155 synthetic factory; never import it.
export const ui003R2BaselineFixtures = Object.freeze({
  departmentA: '10000000-0000-4000-8000-000000000001',
  departmentB: '10000000-0000-4000-8000-000000000002',
  userA: '20000000-0000-4000-8000-000000000001',
  userB: '20000000-0000-4000-8000-000000000002',
  userSelf: '20000000-0000-4000-8000-000000000003',
  roleA: '30000000-0000-4000-8000-000000000001',
  roleB: '30000000-0000-4000-8000-000000000002',
  roleSelf: '30000000-0000-4000-8000-000000000003',
  teamA: '40000000-0000-4000-8000-000000000001',
  teamSelf: '40000000-0000-4000-8000-000000000002',
  draftCustomer: '50000000-0000-4000-8000-000000000001',
  admittedCustomer: '50000000-0000-4000-8000-000000000002',
  foreignCustomer: '50000000-0000-4000-8000-000000000003',
  selfCustomer: '50000000-0000-4000-8000-000000000004',
  holder: '60000000-0000-4000-8000-000000000001',
  unlinkedHolder: '60000000-0000-4000-8000-000000000002',
  foreignHolder: '60000000-0000-4000-8000-000000000003',
  selfHolder: '60000000-0000-4000-8000-000000000004',
  tokenA: 'e2e-department-a',
  tokenB: 'e2e-department-b',
  tokenSelf: 'e2e-department-a-self',
  operatorUsername: 'core-lead-operator',
  operatorPassword: 'correct horse battery staple',
  selfUsername: 'core-lead-self',
  selfPassword: 'correct horse battery staple self',
});

const actions155 = Object.freeze([
  'CUSTOMER_READ',
  'CUSTOMER_ADMIT',
  'LEAD_READ',
  'LEAD_CREATE',
  'LEAD_EDIT',
  'LEAD_PUSH',
  'LEAD_EVIDENCE_DECIDE',
  'NOTARY_EVIDENCE_RECORD',
  'NOTARY_UNBOX_RECORD',
  'NOTARY_OPENING_REVIEW',
  'NOTARY_ISSUANCE_DECIDE',
  'NOTARY_RETURN_ARCHIVE',
  'CASE_READ',
  'CASE_MATCH',
  'CASE_COMPLAINT_SUBMIT',
  'CASE_COMPLAINT_CONFIRM',
  'CASE_EXECUTION_CONFIRM',
  'CASE_EXECUTION_MAIL',
  'CASE_EXECUTION_FILING_SUBMIT',
  'NOTARY_OFFICE_MANAGE',
  'LEAD_WITHDRAW_APPLY',
]);
// Frozen approved factory actions only; raw SQL needs the PostgreSQL @map labels.
const actionDatabaseLabels = Object.freeze({
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_ADMIT: 'customer.admit',
  LEAD_READ: 'lead.read',
  LEAD_CREATE: 'lead.create',
  LEAD_EDIT: 'lead.edit',
  LEAD_PUSH: 'lead.push',
  LEAD_EVIDENCE_DECIDE: 'lead.evidence.decide',
  NOTARY_EVIDENCE_RECORD: 'notary.evidence.record',
  NOTARY_UNBOX_RECORD: 'notary.unbox.record',
  NOTARY_OPENING_REVIEW: 'notary.opening.review',
  NOTARY_ISSUANCE_DECIDE: 'notary.issuance.decide',
  NOTARY_RETURN_ARCHIVE: 'notary.return.archive',
  CASE_READ: 'case.read',
  CASE_MATCH: 'case.match',
  CASE_COMPLAINT_SUBMIT: 'case.complaint.submit',
  CASE_COMPLAINT_CONFIRM: 'case.complaint.confirm',
  CASE_EXECUTION_CONFIRM: 'case.execution.confirm',
  CASE_EXECUTION_MAIL: 'case.execution.mail',
  CASE_EXECUTION_FILING_SUBMIT: 'case.execution.filing.submit',
  NOTARY_OFFICE_MANAGE: 'notary.office.manage',
  LEAD_WITHDRAW_APPLY: 'lead.withdraw.apply',
  USER_MANAGE: 'user.manage',
  LAWYER_ACCOUNT_MANAGE: 'lawyer.account.manage',
});

export function assertUi003R2Binding(environment = process.env) {
  let url;
  try {
    url = new URL(environment.DEV_COR_TEST_DATABASE_URL);
  } catch {
    throw new Error('R2 requires its complete isolated binding');
  }
  if (
    environment.NODE_ENV !== 'test' ||
    environment.DEV_COR_TEST_DATABASE_PROJECT !== ui003R2Instance.project ||
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
      ui003R2Instance.containerId ||
    environment.DATABASE_URL !== environment.DEV_COR_TEST_DATABASE_URL ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== ui003R2Instance.host ||
    url.port !== String(ui003R2Instance.port) ||
    url.pathname !== '/dev_cor_test' ||
    url.username !== 'dev_cor_test' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'R2 requires its exact project, full container ID and loopback database target',
    );
  }
}

// Fail before importing database/runtime modules. Import itself creates no client.
assertUi003R2Binding();

const uid = (key) => {
  const hex = createHash('sha256')
    .update(`ui003-r2-baseline:${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const f = ui003R2BaselineFixtures;
const users = [f.userA, f.userB, f.userSelf];
const roles = [f.roleA, f.roleB, f.roleSelf];
const frozenAt = '2026-09-21T00:00:00.000Z';

function plan() {
  const entries = [];
  const add = (
    table,
    rows,
    scopeColumn = 'id',
    scopeValues = rows.map((row) => row.id),
    security = false,
  ) => entries.push({ table, rows, scopeColumn, scopeValues, security });
  add('departments', [
    { id: f.departmentA, name: 'CORE 知产部' },
    { id: f.departmentB, name: 'CORE 外部门' },
  ]);
  add(
    'user_accounts',
    users.map((id, i) => ({
      id,
      external_subject: [
        'core-lead-user-a',
        'core-lead-user-b',
        'core-lead-user-self',
      ][i],
      display_name: ['核心主管', '外部门主管', '本人范围人员'][i],
      active: true,
      account_type: 'INTERNAL',
      authorization_revision: 1,
    })),
    'id',
    users,
    true,
  );
  add('teams', [
    {
      id: f.teamA,
      department_id: f.departmentA,
      name: 'CORE A 组',
      status: 'ACTIVE',
    },
    {
      id: f.teamSelf,
      department_id: f.departmentA,
      name: 'CORE SELF 组',
      status: 'ACTIVE',
    },
  ]);
  add(
    'department_memberships',
    users.map((id, i) => ({
      id: uid(`membership:${id}`),
      user_id: id,
      department_id: i === 1 ? f.departmentB : f.departmentA,
      team_id: [f.teamA, null, f.teamSelf][i],
      active: true,
    })),
    'user_id',
    users,
    true,
  );
  add(
    'role_templates',
    roles.map((id, i) => ({
      id,
      department_id: i === 1 ? f.departmentB : f.departmentA,
      name: ['CORE TEAM', 'CORE DEPARTMENT', 'CORE SELF'][i],
      active: true,
      version: 1,
    })),
    'id',
    roles,
    true,
  );
  const grants = [];
  for (const [i, role] of roles.entries()) {
    for (const action of actions155) {
      if (i === 2 && action === 'NOTARY_OFFICE_MANAGE') continue;
      const scope =
        i === 1 || action === 'CASE_READ' || action === 'NOTARY_OFFICE_MANAGE'
          ? 'DEPARTMENT'
          : i === 0
            ? 'TEAM'
            : 'SELF';
      grants.push({
        id: uid(`grant:${role}:${action}:${scope}`),
        role_template_id: role,
        action: actionDatabaseLabels[action],
        scope,
      });
    }
    if (i < 2)
      for (const action of ['USER_MANAGE', 'LAWYER_ACCOUNT_MANAGE'])
        grants.push({
          id: uid(`grant:${role}:${action}:DEPARTMENT`),
          role_template_id: role,
          action: actionDatabaseLabels[action],
          scope: 'DEPARTMENT',
        });
  }
  add('role_grants', grants, 'role_template_id', roles, true);
  add(
    'role_assignments',
    users.map((id, i) => ({
      id: uid(`assignment:${id}`),
      user_id: id,
      department_id: i === 1 ? f.departmentB : f.departmentA,
      role_template_id: roles[i],
      team_id: [f.teamA, null, f.teamSelf][i],
      active: true,
      version: 1,
    })),
    'user_id',
    users,
    true,
  );
  add(
    'local_credentials',
    [
      {
        id: uid('credential:operator'),
        user_id: f.userA,
        username: f.operatorUsername,
      },
      {
        id: uid('credential:self'),
        user_id: f.userSelf,
        username: f.selfUsername,
      },
    ],
    'user_id',
    users,
    true,
  );
  const customers = [
    f.draftCustomer,
    f.admittedCustomer,
    f.foreignCustomer,
    f.selfCustomer,
  ].map((id, i) => {
    const name = ['待准入客户', '已准入客户', '外部门客户', '本人范围客户'][i];
    const identity = [null, 'COREA001', 'COREB001', 'CORESELF1'][i];
    return {
      id,
      department_id: i === 2 ? f.departmentB : f.departmentA,
      responsible_user_id: [f.userA, f.userA, f.userB, f.userSelf][i],
      team_id: [f.teamA, f.teamA, null, f.teamSelf][i],
      name,
      normalized_name: name,
      customer_type: i ? 'ENTERPRISE' : null,
      identity_type: i ? 'BUSINESS_LICENSE' : null,
      identity_number: identity,
      normalized_identity_number: identity,
      category: null,
      issuing_country_or_region: null,
      identity_valid_from: null,
      identity_valid_to: null,
      identity_validity_mode: i ? 'LONG_TERM' : null,
      profile_status: i ? 'ADMITTED' : 'DRAFT',
      cooperation_status: 'COOPERATING',
      ever_admitted: Boolean(i),
      admitted_at: i ? frozenAt : null,
      admission_contact_name: i ? '测试联系人' : null,
      admission_contact_phone: i ? '13800000000' : null,
      admission_contact_email: null,
      admission_contact_snapshot_name: i ? '测试联系人' : null,
      admission_contact_snapshot_phone: i ? '13800000000' : null,
      admission_contact_snapshot_email: null,
      admission_contact_snapshot_source: i ? 'NEW_ADMISSION' : null,
      admission_contact_snapshot_frozen_at: i ? frozenAt : null,
      compatibility_contact_id: i ? uid(`contact:${id}`) : null,
      legacy_contact_pending: false,
      deleted_at: null,
      deleted_by_user_id: null,
      deletion_reason: null,
    };
  });
  add('customers', customers);
  const contacts = customers
    .filter((row) => row.profile_status === 'ADMITTED')
    .map((row) => ({
      id: row.compatibility_contact_id,
      customer_id: row.id,
      department_id: row.department_id,
      name: '测试联系人',
      phone: '13800000000',
      email: null,
      duty: null,
      is_primary: false,
      ended_at: null,
      ended_by_user_id: null,
      end_reason: null,
      version: 1,
      origin: 'LEGACY_CREATE',
      origin_key: null,
      created_by_user_id: row.responsible_user_id,
      updated_by_user_id: row.responsible_user_id,
    }));
  add(
    'customer_contacts',
    contacts,
    'customer_id',
    customers.map((row) => row.id),
  );
  add(
    'customer_contact_versions',
    contacts.map((row) => ({
      id: uid(`contact-version:${row.id}`),
      contact_id: row.id,
      version: 1,
      action: 'CREATED',
      before: null,
      after: {
        name: row.name,
        phone: row.phone,
        email: null,
        duty: null,
        isPrimary: false,
        endedAt: null,
        endReason: null,
      },
      actor_user_id: row.created_by_user_id,
      source: 'HUMAN',
    })),
    'contact_id',
    contacts.map((row) => row.id),
  );
  const holders = [
    f.holder,
    f.unlinkedHolder,
    f.foreignHolder,
    f.selfHolder,
  ].map((id, i) => ({
    id,
    department_id: i === 2 ? f.departmentB : f.departmentA,
    name: ['核心权利主体', '未关联主体', '外部门主体', '本人范围主体'][i],
    credit: null,
    address: null,
    legal_representative: null,
    duty: null,
  }));
  add('rights_holders', holders);
  add(
    'customer_rights_holder_links',
    customers.map((row, i) => ({
      id: uid(`link:${row.id}`),
      customer_id: row.id,
      rights_holder_id: [f.holder, f.holder, f.foreignHolder, f.selfHolder][i],
      department_id: row.department_id,
    })),
    'customer_id',
    customers.map((row) => row.id),
  );
  return entries;
}

async function migrations155() {
  const directory = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (
    names.length !== 155 ||
    names.at(-1) !== '20261015130000_guard_direct_second_remand_child'
  )
    throw new Error('R2 baseline requires the frozen 155 migration source');
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(resolve(directory, name, 'migration.sql')))
        .digest('hex'),
    })),
  );
}

const normalized = (value) =>
  value instanceof Date ? value.toISOString() : value;
function equalValue(actual, expected) {
  if (expected && typeof expected === 'object')
    return isDeepStrictEqual(actual, expected);
  return normalized(actual) === expected;
}

async function defaults() {
  const { captureTestEnvironment, validateBrowserTestDatabaseUrl } =
    await import('../../scripts/test-environment.mjs');
  const { acquireE2eResourceLock } = await import('../../scripts/run-e2e.mjs');
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  return {
    capture: () => captureTestEnvironment(root, { pnpmVersion: '11.27.0' }),
    validate: () =>
      validateBrowserTestDatabaseUrl(process.env.DATABASE_URL, root),
    acquireLock: acquireE2eResourceLock,
    openClient: (url) =>
      new (requireBackend('pg').Client)({ connectionString: url }),
    passwordCodec: () => requireBackend('./dist/auth/password.js'),
    migrations: migrations155,
  };
}

// Dependency injection is confined to offline tests; runtime uses the singleton below.
export function createUi003R2BaselineSupport(offlineDependencies) {
  const owned = new Set();
  async function disconnect() {
    for (const client of [...owned]) {
      await client.end();
      owned.delete(client);
    }
  }
  async function prepare() {
    assertUi003R2Binding();
    const dependencies = offlineDependencies ?? (await defaults());
    const environment = dependencies.capture();
    const target = dependencies.validate();
    if (
      target.connectionString !== environment.childEnvironment.DATABASE_URL ||
      target.connectionString !== process.env.DEV_COR_TEST_DATABASE_URL ||
      target.port !== 15438
    )
      throw new Error('R2 baseline effective target mismatch');
    const sourceMigrations = await dependencies.migrations();
    if (sourceMigrations.length !== 155)
      throw new Error('R2 baseline requires all 155 migrations');
    const lock = dependencies.acquireLock();
    let client;
    let transaction = false;
    let result;
    let failure;
    try {
      client = dependencies.openClient(target.connectionString);
      owned.add(client);
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      transaction = true;
      const identity = (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
        )
      ).rows;
      if (
        identity.length !== 1 ||
        identity[0].db !== 'dev_cor_test' ||
        identity[0].schema !== 'public' ||
        identity[0].username !== 'dev_cor_test'
      )
        throw new Error('R2 baseline database identity mismatch');
      const applied = (
        await client.query(
          'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
        )
      ).rows;
      if (
        applied.length !== 155 ||
        applied.some(
          (row, i) =>
            row.migration_name !== sourceMigrations[i].name ||
            row.checksum !== sourceMigrations[i].checksum ||
            !row.finished_at ||
            row.rolled_back_at !== null,
        )
      )
        throw new Error('R2 baseline migration identity mismatch');
      const codec = dependencies.passwordCodec();
      const entries = plan();
      let presentSecurity = 0,
        missingSecurity = 0;
      const absent = [];
      const checked = {};
      // Read-only preflight of every row completes before any INSERT.
      for (const entry of entries) {
        let predicate = `"${entry.scopeColumn}" = ANY($1::uuid[])`;
        const parameters = [entry.scopeValues];
        if (entry.table === 'user_accounts') {
          predicate += ' OR external_subject = ANY($2::text[])';
          parameters.push(entry.rows.map((row) => row.external_subject));
        }
        if (entry.table === 'local_credentials') {
          predicate += ' OR username = ANY($2::text[])';
          parameters.push(entry.rows.map((row) => row.username));
        }
        if (entry.table === 'role_assignments') {
          predicate += ' OR role_template_id = ANY($2::uuid[])';
          parameters.push(roles);
        }
        if (entry.table === 'role_templates' || entry.table === 'teams') {
          predicate +=
            ' OR (department_id = ANY($2::uuid[]) AND name = ANY($3::text[]))';
          parameters.push(
            [f.departmentA, f.departmentB],
            entry.rows.map((row) => row.name),
          );
        }
        if (entry.table === 'customers') {
          predicate +=
            ' OR (department_id = ANY($2::uuid[]) AND normalized_identity_number = ANY($3::text[]))';
          parameters.push(
            [f.departmentA, f.departmentB],
            entry.rows
              .map((row) => row.normalized_identity_number)
              .filter(Boolean),
          );
        }
        const existing = (
          await client.query(
            `SELECT * FROM public."${entry.table}" WHERE ${predicate}`,
            parameters,
          )
        ).rows;
        checked[entry.table] = existing.length;
        const expectedIds = new Set(entry.rows.map((row) => row.id));
        if (existing.some((row) => !expectedIds.has(row.id)))
          throw new Error(`R2 baseline unexpected row: ${entry.table}`);
        for (const row of entry.rows) {
          const found = existing.find((item) => item.id === row.id);
          if (!found) {
            absent.push({ entry, row });
            if (entry.security) missingSecurity++;
            continue;
          }
          if (entry.security) presentSecurity++;
          if (
            Object.entries(row).some(
              ([key, value]) => !equalValue(found[key], value),
            )
          )
            throw new Error(
              `R2 baseline existing row mismatch: ${entry.table}`,
            );
          if (entry.table === 'local_credentials') {
            const password =
              row.user_id === f.userA ? f.operatorPassword : f.selfPassword;
            if (!(await codec.verifyPassword(password, found.password_hash)))
              throw new Error('R2 baseline existing credential mismatch');
          }
        }
      }
      // An atomic seed cannot be partially present. Never recreate revoked grants
      // or attach fresh permissions to any already-existing baseline account.
      if (presentSecurity && missingSecurity)
        throw new Error(
          'R2 baseline incomplete existing security cohort; no permission restoration',
        );
      const created = {};
      for (const { entry, row } of absent) {
        const values = { ...row };
        if (entry.table === 'local_credentials')
          values.password_hash = await codec.hashPassword(
            row.user_id === f.userA ? f.operatorPassword : f.selfPassword,
          );
        // Prisma-managed updated_at columns have no database default.
        if (
          [
            'departments',
            'user_accounts',
            'teams',
            'department_memberships',
            'role_templates',
            'role_assignments',
            'local_credentials',
            'customers',
            'customer_contacts',
            'rights_holders',
          ].includes(entry.table)
        )
          values.updated_at = new Date();
        const columns = Object.keys(values);
        await client.query(
          `INSERT INTO public."${entry.table}" (${columns.map((name) => `"${name}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(values),
        );
        created[entry.table] = (created[entry.table] ?? 0) + 1;
      }
      await client.query('COMMIT');
      transaction = false;
      result = {
        migrationCount: 155,
        created,
        checked,
        ids: absent.map(({ row }) => row.id),
      };
    } catch {
      if (transaction) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* Closing the connection ends any remaining transaction. */
        }
      }
      failure = new Error(
        'R2 baseline rejected or transaction failed; existing data was not overwritten',
      );
    } finally {
      try {
        if (client) {
          try {
            await client.end();
            owned.delete(client);
          } catch {
            failure = new Error('R2 baseline connection close failed');
          }
        }
      } finally {
        lock.release();
      }
    }
    if (failure) throw failure;
    return result;
  }
  return Object.freeze({ prepare, disconnect });
}
const singleton = createUi003R2BaselineSupport();
export const prepareUi003R2Baseline = singleton.prepare;
export const disconnectUi003R2Baseline = singleton.disconnect;
