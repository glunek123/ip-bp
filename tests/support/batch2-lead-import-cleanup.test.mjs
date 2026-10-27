import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

async function source(name) {
  return readFile(resolve('tests/support', name), 'utf8');
}

function inOrder(text, labels) {
  let previous = -1;
  for (const label of labels) {
    const position = text.indexOf(label, previous + 1);
    assert.ok(position > previous, `Missing or out-of-order cleanup: ${label}`);
    previous = position;
  }
}

test('owned lead fixtures clear task and screenshot FKs before lead and draft', async () => {
  for (const [name, start] of [
    [
      'core-lead-database.mjs',
      'await clearCoreCustomerDocuments(departmentIds)',
    ],
    [
      'customer-database.mjs',
      'await clearCustomerSettlements(transaction, departmentIds)',
    ],
  ]) {
    const text = await source(name);
    const cleanup = text.slice(text.indexOf(start));
    inOrder(cleanup, [
      'leadProductScreenshot.deleteMany',
      'leadImageImportTask.deleteMany',
      'lead.deleteMany',
      'material.updateMany',
      'contentVersion.deleteMany',
      'uploadDraft.deleteMany',
      'material.deleteMany',
    ]);
    assert.match(
      cleanup,
      /leadImageImportTask\.deleteMany\(\{\s*where: \{ departmentId: \{ in: departmentIds \} \}/u,
    );
  }
});

test('customer auth fixture keeps its department scope and clears versions before drafts', async () => {
  const text = await source('customer-database.mjs');
  const cleanup = text.slice(
    text.indexOf('await clearCustomerSettlements(transaction, [departmentId])'),
  );
  inOrder(cleanup, [
    'leadProductScreenshot.deleteMany',
    'leadImageImportTask.deleteMany',
    'material.updateMany',
    'contentVersion.deleteMany',
    'uploadDraft.deleteMany',
    'material.deleteMany',
  ]);
  assert.match(
    cleanup,
    /leadImageImportTask\.deleteMany\(\{\s*where: \{ departmentId \}/u,
  );
});

test('case and right evidence helpers release current versions before source drafts', async () => {
  const judgment = await source('case-judgment-database.mjs');
  inOrder(judgment, [
    'UPDATE materials SET current_version_id=NULL WHERE owner_type=$1 AND owner_id=$2',
    'DELETE FROM content_versions WHERE material_id IN',
    'DELETE FROM upload_drafts WHERE owner_type=$1 AND owner_id=$2',
    'DELETE FROM materials WHERE owner_type=$1 AND owner_id=$2',
  ]);
  const rightEvidence = await source('customer-right-asset-database.mjs');
  inOrder(rightEvidence, [
    'UPDATE materials SET current_version_id=NULL WHERE id=ANY($1::uuid[])',
    'DELETE FROM content_versions WHERE material_id=ANY($1::uuid[])',
    'DELETE FROM upload_drafts WHERE department_id=$1 AND owner_type=',
  ]);
});
