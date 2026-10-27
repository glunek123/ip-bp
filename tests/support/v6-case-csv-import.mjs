import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  grantV6SyntheticRole,
  seedV6InternalCustomer,
  v6Access,
  v6Actor,
  v6BackendClass,
  v6ScopedPrisma,
  withV6FollowupSchema,
} from './v6-followup-fixture.mjs';

const cutover = readFileSync(
  resolve(
    process.cwd(),
    'docs/superpowers/plans/2026-10-26-v6-numbering-cutover.draft.sql',
  ),
  'utf8',
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function expectCode(work, code) {
  try {
    await work();
  } catch (error) {
    const response = error?.getResponse?.() ?? error?.response;
    if (response?.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}

function csv(template, rows) {
  const header = template.trimEnd();
  const cell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return Buffer.from(
    `${header}\r\n${rows
      .map((row) => row.map(cell).join(','))
      .join('\r\n')}\r\n`,
    'utf8',
  ).toString('base64');
}

function row(customerBusinessId, overrides = {}) {
  const values = [
    '外部移交',
    '待匹配',
    '2026-10-25',
    '合成外录来源',
    '历史补录',
    customerBusinessId,
    '合成权利人',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
  for (const [index, value] of Object.entries(overrides))
    values[Number(index)] = value;
  return values;
}

export async function verifyV6CaseCsvImport() {
  return withV6FollowupSchema(async ({ client, schema }) => {
    const owner = await seedV6InternalCustomer(client);
    const outsider = await seedV6InternalCustomer(client);
    await client.query(cutover);
    const businessId = (
      await client.query('SELECT business_id FROM customers WHERE id=$1', [
        owner.customerId,
      ])
    ).rows[0].business_id;
    assert(businessId, 'Cutover did not assign a customer business ID');
    const courtId = randomUUID();
    await client.query(
      'INSERT INTO filing_courts(id,department_id,name) VALUES($1,$2,$3)',
      [courtId, owner.departmentId, '合成法院'],
    );
    const roleId = await grantV6SyntheticRole(client, owner, [
      ['customer.read', 'DEPARTMENT'],
      ['case.read', 'DEPARTMENT'],
      ['case.external-entry.create', 'SELF'],
    ]);
    await grantV6SyntheticRole(client, outsider, [
      ['customer.read', 'DEPARTMENT'],
      ['case.read', 'DEPARTMENT'],
      ['case.external-entry.create', 'SELF'],
    ]);
    const database = v6ScopedPrisma(schema);
    try {
      const access = v6Access(database);
      const CustomerCaseEntrySourceService = v6BackendClass(
        'modules/customers/customer-case-entry-source.service.js',
        'CustomerCaseEntrySourceService',
      );
      const CaseExternalEntryService = v6BackendClass(
        'modules/cases/case-external-entry.service.js',
        'CaseExternalEntryService',
      );
      const CaseCsvImportService = v6BackendClass(
        'modules/cases/case-csv-import.service.js',
        'CaseCsvImportService',
      );
      const customerSource = new CustomerCaseEntrySourceService(
        database,
        access,
      );
      const external = new CaseExternalEntryService(
        database,
        access,
        customerSource,
      );
      const service = new CaseCsvImportService(
        database,
        customerSource,
        external,
        access,
      );
      const actor = v6Actor(owner);
      const simpleFile = csv(service.template(), [row(businessId)]);
      const simplePreview = await service.preview(actor, {
        csvBase64: simpleFile,
      });
      assert(
        simplePreview.validCount === 1 &&
          simplePreview.rows[0]?.duplicateCandidates.cases.length === 0 &&
          simplePreview.rows[0]?.duplicateCandidates.rowNumbers.length === 0,
        'Fresh CSV row unexpectedly required duplicate confirmation',
      );
      const simpleInput = {
        csvBase64: simpleFile,
        rowNumbers: [2],
        duplicateConfirmations: [],
        idempotencyKey: 'v6-csv-simple',
      };
      const beforeCases = (
        await client.query('SELECT count(*)::int AS count FROM cases')
      ).rows[0].count;
      await client.query(`CREATE FUNCTION v6_fail_csv_row() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic CSV row failure'
        USING ERRCODE='23514'; END $$`);
      await client.query(`CREATE TRIGGER v6_fail_csv_row BEFORE INSERT ON
        case_csv_imported_rows FOR EACH ROW EXECUTE FUNCTION v6_fail_csv_row()`);
      let injectedFailure;
      try {
        await service.commit(actor, simpleInput);
      } catch (error) {
        injectedFailure = error;
      }
      assert(
        injectedFailure,
        'Late CSV receipt failure unexpectedly committed',
      );
      const rollback = (
        await client.query(`SELECT
        (SELECT count(*)::int FROM cases) AS cases,
        (SELECT count(*)::int FROM case_csv_import_receipts) AS receipts,
        (SELECT count(*)::int FROM case_csv_imported_rows) AS rows`)
      ).rows[0];
      assert(
        rollback.cases === beforeCases &&
          rollback.receipts === 0 &&
          rollback.rows === 0,
        'CSV late failure left partial cases or receipts',
      );
      await client.query(
        'DROP TRIGGER v6_fail_csv_row ON case_csv_imported_rows',
      );
      await client.query('DROP FUNCTION v6_fail_csv_row()');
      const simple = await service.commit(actor, simpleInput);
      assert(
        simple.items.length === 1 && simple.items[0].rowNumber === 2,
        'Fresh CSV row did not commit without confirmations',
      );
      deepStrictEqual(
        await service.commit(actor, simpleInput),
        simple,
        'Fresh CSV replay changed result',
      );
      await expectCode(
        () =>
          service.commit(actor, {
            ...simpleInput,
            idempotencyKey: 'v6-csv-simple-second',
          }),
        'CASE_CSV_ROW_ALREADY_IMPORTED',
      );

      const repeatedRows = [
        row(businessId, { 4: '同文件第1行', 13: '合成法院', 14: '合成案号-1' }),
        row(businessId, { 4: '同文件第2行', 13: '合成法院', 14: '合成案号-1' }),
      ];
      const sameFile = csv(service.template(), repeatedRows);
      const samePreview = await service.preview(actor, { csvBase64: sameFile });
      assert(
        samePreview.validCount === 2 &&
          JSON.stringify(samePreview.rows[0].duplicateCandidates.rowNumbers) ===
            '[3]',
        'Unselected same-file row was omitted from duplicate candidates',
      );
      const sameInput = {
        csvBase64: sameFile,
        rowNumbers: [2],
        duplicateConfirmations: [
          { rowNumber: 2, caseIds: [], rowNumbers: [3] },
        ],
        idempotencyKey: 'v6-csv-same-file',
      };
      await expectCode(
        () =>
          service.commit(actor, { ...sameInput, duplicateConfirmations: [] }),
        'CASE_CSV_DUPLICATES_CHANGED',
      );
      const same = await service.commit(actor, sameInput);
      assert(
        same.items.length === 1 && same.items[0].rowNumber === 2,
        'Explicit same-file confirmation did not import selected row',
      );

      const crossFile = csv(service.template(), [
        row(businessId, { 4: '跨文件新行', 13: '合成法院', 14: '合成案号-1' }),
      ]);
      const crossPreview = await service.preview(actor, {
        csvBase64: crossFile,
      });
      const candidates = crossPreview.rows[0]?.duplicateCandidates.cases ?? [];
      assert(
        candidates.length === 1 && candidates[0].id === same.items[0].id,
        'Cross-file duplicate candidate did not identify existing case',
      );
      const crossInput = {
        csvBase64: crossFile,
        rowNumbers: [2],
        duplicateConfirmations: [],
        idempotencyKey: 'v6-csv-cross-file',
      };
      await expectCode(
        () => service.commit(actor, crossInput),
        'CASE_CSV_DUPLICATES_CHANGED',
      );
      const confirmed = await service.commit(actor, {
        ...crossInput,
        duplicateConfirmations: [
          { rowNumber: 2, caseIds: [candidates[0].id], rowNumbers: [] },
        ],
      });
      assert(
        confirmed.items.length === 1 &&
          confirmed.items[0].id !== same.items[0].id,
        'Confirmed suspected duplicate was merged instead of imported separately',
      );

      const racedFile = csv(service.template(), [
        row(businessId, { 4: '合成并发独立行' }),
      ]);
      const raced = await Promise.allSettled([
        service.commit(actor, {
          csvBase64: racedFile,
          rowNumbers: [2],
          duplicateConfirmations: [],
          idempotencyKey: 'v6-csv-race-a',
        }),
        service.commit(actor, {
          csvBase64: racedFile,
          rowNumbers: [2],
          duplicateConfirmations: [],
          idempotencyKey: 'v6-csv-race-b',
        }),
      ]);
      assert(
        raced.filter((item) => item.status === 'fulfilled').length === 1 &&
          raced.filter((item) => item.status === 'rejected').length === 1,
        'Concurrent same-file row did not admit exactly one case',
      );
      const racedRows = (
        await client.query(
          'SELECT count(*)::int AS count FROM case_csv_imported_rows',
        )
      ).rows[0].count;
      assert(
        racedRows === 4,
        'Concurrent same-file row changed committed row cardinality',
      );

      await client.query(
        `DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.read'`,
        [roleId],
      );
      await expectCode(
        () => service.preview(actor, { csvBase64: crossFile }),
        'CUSTOMER_ACTION_FORBIDDEN',
      );
      const outsiderPreview = await service.preview(v6Actor(outsider), {
        csvBase64: crossFile,
      });
      assert(
        outsiderPreview.validCount === 0 &&
          outsiderPreview.rows[0]?.duplicateCandidates.cases.length === 0,
        'Cross-department preview disclosed customer or duplicate case',
      );
      return {
        checks: [
          'late CSV row failure rolls back case, receipt and row before retry',
          'fresh CSV imports with no duplicate confirmation and replays exactly once',
          'unselected same-file candidate requires exact row confirmation',
          'cross-file candidate requires exact case confirmation and stays a separate case',
          'concurrent same-file row admits exactly one case',
          'case-read denial and cross-department actor do not see duplicate candidates',
        ],
      };
    } finally {
      await database.$disconnect();
    }
  });
}
