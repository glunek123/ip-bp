import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute only the actual fixture function with in-memory delegates. No support
// imports, application dist, environment capture, DB, Docker or browser calls.
const source = ts.createSourceFile(
  'hearing-support.mjs',
  readFileSync(
    new URL('./hearing-correction-chain-database.mjs', import.meta.url),
    'utf8',
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const declaration = source.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'seedOwner',
);
assert.ok(declaration, 'Missing actual seedOwner function');
const seedOwner = new Function(
  'randomUUID',
  declaration.getText(source) + '\nreturn seedOwner;',
)(randomUUID);

// A focused final-state contract from customer_contact_projection_guard (migration
// 20261009040000). This is an offline fixture regression, not a PostgreSQL test.
function assertProjection(customer, contacts) {
  const contact = contacts.find(
    (row) =>
      row.id === customer.compatibilityContactId &&
      row.customerId === customer.id &&
      row.departmentId === customer.departmentId,
  );
  const matches =
    contact !== undefined &&
    contact.endedAt === null &&
    customer.admissionContactName === contact.name &&
    customer.admissionContactPhone === contact.phone &&
    customer.admissionContactEmail === contact.email;
  assert.ok(matches, 'customer contact projection mismatch (23514 contract)');
}

function fixture(beforeCommit = () => {}) {
  const rows = { customers: [], contacts: [], customerUpdates: [] };
  const operations = [];
  const create = (model, defaults = {}) => ({
    async create({ data }) {
      const row = { ...defaults, ...globalThis.structuredClone(data) };
      operations.push(model + '.create');
      return row;
    },
  });
  const tx = {
    department: create('department'),
    userAccount: create('userAccount'),
    departmentMembership: create('departmentMembership'),
    roleTemplate: create('roleTemplate'),
    roleAssignment: create('roleAssignment'),
    rightsHolder: create('rightsHolder'),
    customerRightsHolderLink: create('customerRightsHolderLink'),
    async $executeRawUnsafe(sql, ...parameters) {
      assert.match(sql, /^INSERT INTO role_grants\(/u);
      assert.equal(parameters.length, 3);
      operations.push('role_grants.insert');
      return 1;
    },
    customer: {
      async create({ data }) {
        const row = {
          compatibilityContactId: null,
          admissionContactEmail: null,
          ...globalThis.structuredClone(data),
        };
        rows.customers.push(row);
        operations.push('customer.create');
        return row;
      },
      async update({ where, data }) {
        const row = rows.customers.find((item) => item.id === where.id);
        assert.ok(row, 'Customer must exist before binding its contact');
        rows.customerUpdates.push(globalThis.structuredClone(data));
        Object.assign(row, globalThis.structuredClone(data));
        operations.push('customer.update');
        return row;
      },
    },
    customerContact: {
      async create({ data }) {
        const row = {
          id: randomUUID(),
          email: null,
          endedAt: null,
          ...globalThis.structuredClone(data),
        };
        assert.ok(
          rows.customers.some(
            (customer) =>
              customer.id === row.customerId &&
              customer.departmentId === row.departmentId,
          ),
          'Contact must reference an existing customer in the same department',
        );
        rows.contacts.push(row);
        operations.push('customerContact.create');
        return row;
      },
    },
  };
  const database = {
    async $transaction(callback) {
      operations.push('transaction.begin');
      await callback(tx);
      beforeCommit(rows);
      for (const customer of rows.customers) {
        assertProjection(customer, rows.contacts);
      }
      operations.push('transaction.commit');
    },
  };
  return { database, rows, operations };
}

test('seedOwner commits a scoped active contact and exact compatibility projection', async () => {
  const { database, rows, operations } = fixture();
  const owner = await seedOwner(database);
  assert.equal(rows.customers.length, 1);
  assert.equal(rows.contacts.length, 1);
  const [customer] = rows.customers;
  const [contact] = rows.contacts;
  assert.equal(customer.id, owner.customerId);
  assert.equal(customer.departmentId, owner.actor.departmentId);
  assert.equal(contact.customerId, owner.customerId);
  assert.equal(contact.departmentId, owner.actor.departmentId);
  assert.equal(contact.createdByUserId, owner.actor.userId);
  assert.equal(contact.updatedByUserId, owner.actor.userId);
  assert.equal(contact.origin, 'ADMISSION_FREEFORM');
  assert.equal(customer.profileStatus, 'ADMITTED');
  assert.equal(customer.admissionContactName, 'Synthetic contact');
  assert.equal(customer.admissionContactPhone, '13800000000');
  assert.equal(
    customer.admissionContactSnapshotName,
    customer.admissionContactName,
  );
  assert.equal(
    customer.admissionContactSnapshotPhone,
    customer.admissionContactPhone,
  );
  assert.equal(customer.admissionContactSnapshotSource, 'NEW_ADMISSION');
  assert.ok(customer.admissionContactSnapshotFrozenAt instanceof Date);
  assert.deepEqual(rows.customerUpdates, [
    { compatibilityContactId: contact.id },
  ]);
  assert.ok(
    operations.indexOf('customer.create') <
      operations.indexOf('customerContact.create'),
  );
  assert.ok(
    operations.indexOf('customerContact.create') <
      operations.indexOf('customer.update'),
  );
  assert.ok(
    operations.indexOf('customer.update') <
      operations.indexOf('rightsHolder.create'),
  );
  assert.equal(operations.at(-1), 'transaction.commit');
});

test('separate fixture invocations append unique customer and contact facts', async () => {
  const first = fixture();
  const second = fixture();
  const firstOwner = await seedOwner(first.database);
  const secondOwner = await seedOwner(second.database);
  assert.notEqual(firstOwner.customerId, secondOwner.customerId);
  assert.notEqual(
    firstOwner.actor.departmentId,
    secondOwner.actor.departmentId,
  );
  assert.notEqual(first.rows.contacts[0].id, second.rows.contacts[0].id);
});

const invalid = [
  [
    'missing pointer',
    ({ customers }) => {
      customers[0].compatibilityContactId = null;
    },
  ],
  [
    'missing contact',
    ({ contacts }) => {
      contacts.length = 0;
    },
  ],
  [
    'wrong customer',
    ({ contacts }) => {
      contacts[0].customerId = randomUUID();
    },
  ],
  [
    'wrong department',
    ({ contacts }) => {
      contacts[0].departmentId = randomUUID();
    },
  ],
  [
    'ended contact',
    ({ contacts }) => {
      contacts[0].endedAt = new Date();
    },
  ],
  [
    'name mismatch',
    ({ contacts }) => {
      contacts[0].name = 'Other contact';
    },
  ],
  [
    'phone mismatch',
    ({ contacts }) => {
      contacts[0].phone = '13900000000';
    },
  ],
  [
    'email mismatch',
    ({ contacts }) => {
      contacts[0].email = 'synthetic@example.invalid';
    },
  ],
];
for (const [label, mutate] of invalid) {
  test('offline projection contract rejects ' + label, async () => {
    const { database, operations } = fixture(mutate);
    await assert.rejects(
      seedOwner(database),
      /customer contact projection mismatch/u,
    );
    assert.ok(!operations.includes('transaction.commit'));
  });
}
