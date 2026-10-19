import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  assertExecutionFilingFollowupR2Binding,
  assertExecutionFilingFollowupMigrationSource,
  assertExecutionFilingFollowupMigrationLedger,
  assertExecutionFilingFollowupResolveArtifacts,
} from './case-execution-filing-followup-database.mjs';
import { validateLeadBatchPushBinding } from './lead-batch-push-database.mjs';
import { captureTestEnvironment } from '../../scripts/test-environment.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
export const preservedEfCheckpoint = Object.freeze({
  mode: 'PRESERVED_EF_CHECKPOINT',
  summarySha256:
    '566b1f7043334af0d2a8e106baa4c2ce285705e54536fca56121d8b68c90718f',
  caseId: '6c151c42-3054-466b-9a0e-a8daaf99fbde',
  businessNo: 'CA-20261019-0001',
  mailingId: 'edc4c890-0a88-477b-8318-fea0e93586a0',
  filingId: 'c1fab17d-d583-45ad-bf36-f3492c5d8b9b',
  contentVersionIds: Object.freeze([
    '0cb8fb1c-81fe-42d9-9815-6bdb39e798b1',
    'b1b2b0fd-757d-41a2-9c8e-da66d933e6d4',
  ]),
  receiptIds: Object.freeze({
    external: '861537f5-de3e-4aeb-bef4-60ae349b32b1',
    mailing: 'e2761ab5-9c0d-4b80-9cf2-4d1bfe1d8c8a',
    filing: '1b4e4e77-dc31-4dbf-ba52-8b40b065143c',
  }),
  pdfSha256: 'a920a7cdb0a855fa2f00a0991f9fde35c8db481f204e97dec56f07c917ebe29e',
  priorConsumed: Object.freeze({
    login: 1,
    external: 1,
    draft: 2,
    filePut: 2,
    mail: 1,
    filing: 1,
    logout: 1,
    feedback: 0,
    correction: 0,
  }),
});
const preservedEfEvidenceHashes = Object.freeze({
  'safe-trace-http.json':
    '70688f1c0cd68880bcff8ffa4ce723bb53cd06f52e9712ab63a8cbe04595d15a',
  'database-delta.json':
    'c70de4137cfd604534447207fdbca7ad8fab1c1c5d2b17c0adb40df3fd8d986c',
  'all-after-rows.json':
    'b299d57133bd5c7e92f628c2b5fe83ea21b614f7038fe97e8ddf8adfea9f98e4',
  'closure-addendum/actual-facts.json':
    'e0e2143467a2ed8cc46b5bd473b822df5759064f5f47f2cdb90c510a6d735a3b',
  'closure-addendum/closure-proof.json':
    '63d6f11592bbfbe6c512680f54b019e7e78b65c537bd20865e7951eca5d4b3a5',
  'closure-addendum/file-closure.json':
    '04728af27c85f83ab1d91ff4563fb19b3beed4f8b532e92e946105ec339f1069',
});
const departmentId = '10000000-0000-4000-8000-000000000001';
const customerId = '50000000-0000-4000-8000-000000000002';
const rightsHolderId = '60000000-0000-4000-8000-000000000001';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const minimalPageScopes = Object.freeze({
  EF_FEEDBACK: Object.freeze({
    kind: 'EF_FEEDBACK',
    userId: '03620738-5f11-49f9-9279-95d51306e32e',
    roleId: 'cfd6fa11-f04d-4e99-ab3c-2fccc8e22161',
    assignmentId: '9c052f06-6047-4e71-8316-affb20d55385',
    membershipId: 'b51a9331-beb8-4fae-974a-197c5d680820',
    credentialId: '966cb48d-2789-493e-9ba2-eefb99ca1bd8',
    departmentId,
    actions: Object.freeze([
      'case.read',
      'customer.read',
      'case.external-entry.create',
      'case.execution.mail',
      'case.execution.filing.submit',
      'case.execution.feedback.record',
      'case.execution.feedback.correct',
    ]),
    demoATerminal: Object.freeze({
      roleId: '49f006dd-1ee8-4399-aee8-41788b1035da',
      assignmentId: 'a3af87ea-0306-435f-aaad-757d983bf166',
      grants: Object.freeze(
        [
          ['721bec1c-0973-458c-8f80-930da871acaa', 'settlement.read'],
          ['4e43d8cd-bf88-4ace-8614-a57f90413e61', 'settlement.terms.update'],
          ['f807bbb8-8058-4cb0-80d7-7ecfacdc6d61', 'settlement.launch'],
          ['33b56a6f-32bf-4df9-84ed-a5f1ecbd5b63', 'settlement.bill.create'],
          ['147188f5-2bb7-4ade-979f-ad31bbf6441f', 'settlement.bill.cancel'],
          ['732ed253-6342-4fd2-810a-ad6d7d400629', 'fee.read'],
          ['33cd9343-0c68-4565-8086-1de6fc85979a', 'fee.create'],
          ['f28907b7-3f33-4b67-96a4-e98ff6c20455', 'fee.update'],
          ['4494e01c-36aa-4e5c-94a9-8bf911344337', 'fee.launch'],
          ['efdb2d45-9a83-44ce-aab9-fd38c5b69e53', 'fee.delete'],
          ['0d5a2f46-b4a8-451d-b9b7-76a9caacdb7a', 'evidence.read'],
          ['b7311efd-6767-4f9c-adce-6e9e6c33cc55', 'evidence.edit'],
          ['a444642d-4614-4b52-970a-80f54cfebff2', 'evidence.bulk-status'],
          ['9c6e728e-ebe7-4c4b-bcc5-d61a9e2e0db3', 'evidence.export'],
        ].map(([id, action]) => Object.freeze({ id, action })),
      ),
    }),
    privateCredential: Object.freeze({
      path: 'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-ef161-http14-b759db9e-72df-4974-b2cf-3c259b02c4a0\\part2-pwsh7-fba076cd-d2eb-455f-8039-61534d8bc973\\permission-continuation-input.private.json',
      sha256:
        'ce0d8db2d774f214bec05da87fe7a64834a1ae5a6d7da8255f185733dcf7300e',
    }),
  }),
  LEAD_BATCH: Object.freeze({
    kind: 'LEAD_BATCH',
    userId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
    roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
    assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
    membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
    credentialId: 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b',
    departmentId,
    actions: Object.freeze([
      'customer.read',
      'lead.read',
      'lead.create',
      'lead.push',
    ]),
    privateCredential: Object.freeze({
      path: 'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-h-actor-recovery-83ac59ee-1b96-4fde-b1b8-534061a36ed0\\actor.private.json',
      sha256:
        'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
    }),
  }),
});

const sourceProofs = Object.freeze([
  [
    'settlement-evidence-inventory-67625b9-20261017/current-internal-actor-roles.json',
    '02231cd94969da51208d22a8f777afeedc2cf42e8530feb1115b97ef04239f61',
  ],
  [
    'permission-membership-readonly-20261017/four-actor-relations-proof.json',
    'deaae2314d0394cd7b81a456236fb5fbf848bd4d8f80a9f1b4c7c60202b4403a',
  ],
  [
    'permission-resume-offline-20261017/permission-resume-plan.json',
    '40315e6b74d463b8b681e5f8aa0f8f96407398c72c0f139e76dda1c958104fa3',
  ],
]);
const resolveProofHashes = Object.freeze({
  'receipt.json':
    '162c5ead547631b44a84913abc8a7068191dc2198fb58a420b3f73fa98b3ed1c',
  'stdout.log':
    'a51491bda92c3572154b87419a96572b0052ab3a47fe4222a568eca3a3b9ddfe',
  'stderr.log':
    '211b3323777fed313dce76ef3c4b17609b34e69a87930c44483b90a18e6f256d',
});

function blocked(phase = 'GUARD', cause) {
  const message = `Minimal page acceptance BLOCKED: ${phase}`;
  const error =
    cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = `MINIMAL_PAGE_${phase}`;
  throw error;
}

const preflightPhases = new Set([
  'PREFLIGHT',
  'R2_BINDING',
  'PRESERVED_EF_AUTHORIZATION',
  'PRESERVED_EF_EVIDENCE',
  'FROZEN_SOURCE',
  'ORDINARY_PROOF',
  'CAPTURE',
  'PG_CONNECT',
  'LEDGER',
  'ACTOR',
  'PRESERVED_EF_LIVE',
  'FIXTURE',
  'STARTUP_WINDOW',
  'PRIVATE_CREDENTIAL',
]);
const preflightCauseCodes = new Set([
  'EACCES',
  'ECONNREFUSED',
  'ENOENT',
  'EPERM',
  'ETIMEDOUT',
  'MODULE_NOT_FOUND',
  'TYPE_ERROR',
  'REFERENCE_ERROR',
  'SYNTAX_ERROR',
  'RANGE_ERROR',
  'UNCLASSIFIED',
]);
const preflightGuardCodes = new Set([
  ...[...preflightPhases].map((phase) => `MINIMAL_PAGE_${phase}`),
  'MINIMAL_PAGE_GUARD',
  'MINIMAL_PAGE_FINGERPRINT_KEY',
  'MINIMAL_PAGE_PRESERVED_EF_HASH',
  'MINIMAL_PAGE_PRESERVED_EF_FILES',
  'MINIMAL_PAGE_PRESERVED_EF_TABLE',
  'MINIMAL_PAGE_PRESERVED_EF_ROWS',
]);
const preflightMarker = '@@MINIMAL_PAGE_PREFLIGHT_DIAGNOSTIC@@';

function safePreflightCauseCode(value, name) {
  if (typeof value === 'string') {
    if (preflightGuardCodes.has(value)) return value;
    if (/^(?:[0-9][0-9A-Z]|P0|XX|HV|F0)[0-9A-Z]{3}$/u.test(value)) return value; // PostgreSQL SQLSTATE, without arbitrary five-letter text
    if (preflightCauseCodes.has(value)) return value;
  }
  const names = {
    TypeError: 'TYPE_ERROR',
    ReferenceError: 'REFERENCE_ERROR',
    SyntaxError: 'SYNTAX_ERROR',
    RangeError: 'RANGE_ERROR',
  };
  return Object.hasOwn(names, name) ? names[name] : 'UNCLASSIFIED';
}

export function formatMinimalPagePreflightDiagnostic(error) {
  const phase = preflightPhases.has(error?.phase) ? error.phase : 'PREFLIGHT';
  const code = `MINIMAL_PAGE_${phase}`;
  const causeCode = safePreflightCauseCode(error?.causeCode, error?.name);
  return `${preflightMarker}${JSON.stringify({ phase, code, causeCode })}`;
}

export function parseMinimalPagePreflightDiagnostic(stderr) {
  const lines = String(stderr).split(/\r?\n/u);
  const matches = lines.filter((line) => line.startsWith(preflightMarker));
  if (matches.length !== 1)
    return {
      phase: 'PREFLIGHT',
      code: 'MINIMAL_PAGE_PREFLIGHT',
      causeCode: 'UNCLASSIFIED',
    };
  try {
    const raw = JSON.parse(matches[0].slice(preflightMarker.length));
    if (
      Object.keys(raw).sort().join(',') !== 'causeCode,code,phase' ||
      !preflightPhases.has(raw.phase) ||
      raw.code !== `MINIMAL_PAGE_${raw.phase}` ||
      safePreflightCauseCode(raw.causeCode) !== raw.causeCode
    )
      throw new Error('invalid diagnostic');
    return { phase: raw.phase, code: raw.code, causeCode: raw.causeCode };
  } catch {
    return {
      phase: 'PREFLIGHT',
      code: 'MINIMAL_PAGE_PREFLIGHT',
      causeCode: 'UNCLASSIFIED',
    };
  }
}

function fixedScope(kind) {
  const scope = minimalPageScopes[kind];
  if (!scope) blocked();
  return scope;
}

// This is an evidence reference, not a source of extra budget. The caller must
// supply a separately frozen receipt for the exact five-file candidate.
export function assertPreservedEfAuthorization(
  receipt,
  candidateHashes,
  candidateGit,
) {
  if (
    receipt?.mode !== preservedEfCheckpoint.mode ||
    receipt?.requestMessageId !== 'Sentinel_74f90cb0aadc8191b21a8eb37dbec5a0' ||
    receipt?.requestAtUtc !== '2026-10-19T01:58:27Z' ||
    receipt?.approvalMessageId !==
      'Sentinel_99b86fc7c7ac81918193c5af43f85438' ||
    receipt?.approvalAtUtc !== '2026-10-19T02:01:49Z' ||
    receipt?.summarySha256 !== preservedEfCheckpoint.summarySha256 ||
    receipt?.caseId !== preservedEfCheckpoint.caseId ||
    receipt?.actorId !== minimalPageScopes.EF_FEEDBACK.userId ||
    receipt?.additionalEfSessions !== 1 ||
    receipt?.efFeedbackPosts !== 2 ||
    receipt?.sourcePosts !== 0 ||
    receipt?.uploadRequests !== 0 ||
    receipt?.pdfs !== 0 ||
    receipt?.leadSessionsRemaining !== 1 ||
    receipt?.leadPostsRemaining !== 3 ||
    !/^[0-9a-f]{40}$/u.test(candidateGit?.head ?? '') ||
    !/^[0-9a-f]{40}$/u.test(candidateGit?.tree ?? '') ||
    receipt?.candidateHead !== candidateGit.head ||
    receipt?.candidateTree !== candidateGit.tree ||
    !candidateHashes ||
    Object.keys(candidateHashes).length !== 5 ||
    Object.keys(receipt.candidateHashes ?? {}).length !== 5 ||
    Object.entries(candidateHashes).some(
      ([path, digest]) =>
        !/^[0-9a-f]{64}$/u.test(digest) ||
        receipt.candidateHashes[path] !== digest,
    )
  )
    blocked('PRESERVED_EF_AUTHORIZATION');
  return true;
}

export function assertPreservedEfEvidence({
  summary,
  trace,
  delta,
  facts,
  closure,
  files,
}) {
  const seal = preservedEfCheckpoint;
  const sourceTables = [
    ['case_external_entry_receipts', seal.receiptIds.external],
    ['case_execution_mailing_receipts', seal.receiptIds.mailing],
    ['case_execution_filing_receipts', seal.receiptIds.filing],
  ];
  if (
    summary?.result !== 'PAUSED_EF_LIST_VISIBILITY_FAILURE' ||
    summary?.execution?.EF?.case?.id !== seal.caseId ||
    summary.execution.EF.case.business_no !== seal.businessNo ||
    summary.execution.EF.case.stage !== 'EXECUTING' ||
    summary.execution.EF.case.version !== 3 ||
    summary?.budget?.used?.newSessions !== 1 ||
    summary.budget.used.businessPOST !== 3 ||
    summary.budget.used.uploadRequests !== 4 ||
    summary.budget.used.PDFs !== 2 ||
    summary.budget.used.PDFBytes !== 86 ||
    summary.budget.remaining.newCases !== 0 ||
    summary.budget.remaining.PDFs !== 0 ||
    summary.budget.remaining.uploadRequests !== 0 ||
    summary?.protection?.oldRowsUnchanged !== true ||
    summary.protection.old94FilesUnchanged !== true ||
    summary.protection.sixYesterdayExpiredPreserved !== true ||
    summary.protection.totalPhysicalFiles !== 96 ||
    summary.execution.EF.feedbackWrites !== 0 ||
    trace?.caseId !== seal.caseId ||
    trace?.budget?.feedbackRequestCount !== 0 ||
    trace?.budget?.budgetGuardError != null ||
    JSON.stringify({ ...trace.budget.counts, feedback: 0, correction: 0 }) !==
      JSON.stringify(seal.priorConsumed) ||
    delta?.oldRowsUnchanged !== true ||
    delta?.sequencesEqual !== true ||
    closure?.oldRowsUnchanged !== true ||
    closure?.sequencesUnchanged !== true ||
    closure?.sixExpiredRowsPreserved !== true ||
    closure?.feedbackWrites !== 0 ||
    closure?.leadWrites !== 0 ||
    files?.count !== 96 ||
    files?.allOriginalFilesMatch !== true ||
    sourceTables.some(
      ([table, id]) =>
        facts?.[table]?.count !== 1 ||
        JSON.stringify(facts[table].ids) !== JSON.stringify([id]),
    ) ||
    facts?.case_execution_filing_feedbacks?.count !== 0 ||
    facts?.case_execution_filing_followup_receipts?.count !== 0
  )
    blocked('PRESERVED_EF_EVIDENCE');
  const newFiles = files.files.filter((entry) => entry.new === true);
  if (
    newFiles.length !== 2 ||
    newFiles.some(
      (entry) =>
        !seal.contentVersionIds.includes(entry.id) ||
        entry.bytes !== 43 ||
        entry.sha256 !== seal.pdfSha256,
    ) ||
    new Set(newFiles.map((entry) => entry.id)).size !== 2
  )
    blocked('PRESERVED_EF_FILES');
  const writes = trace.requests.filter(
    (entry) => !['GET', 'HEAD'].includes(entry.method),
  );
  const expected = [
    ['POST', '/api/v1/auth/login', 200],
    ['POST', '/api/v1/cases/external-entries', 201],
    ['POST', '/api/v1/materials/upload-drafts', 201],
    [
      'PUT',
      '/api/v1/materials/upload-drafts/e6967a75-3a27-4723-91c1-9f4084210c7a/content',
      200,
    ],
    ['POST', `/api/v1/cases/${seal.caseId}/execution-mail`, 201],
    ['POST', '/api/v1/materials/upload-drafts', 201],
    [
      'PUT',
      '/api/v1/materials/upload-drafts/d71667cd-8c8e-4e37-be86-c57add65694a/content',
      200,
    ],
    ['POST', `/api/v1/cases/${seal.caseId}/execution-filing-submit`, 201],
    ['POST', '/api/v1/auth/logout', 204],
  ];
  if (
    JSON.stringify(
      writes.map(({ method, path, status }) => [method, path, status]),
    ) !== JSON.stringify(expected)
  )
    blocked('PRESERVED_EF_TRACE');
  return true;
}

export async function readPreservedEfEvidence(root) {
  const directory = resolve(
    root,
    '../ca015-integration/.local/next-batch-preparation/r2-resume-pages-dadb0989-20261019',
  );
  const names = ['summary.json', ...Object.keys(preservedEfEvidenceHashes)];
  const values = {};
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name));
    const expected =
      name === 'summary.json'
        ? preservedEfCheckpoint.summarySha256
        : preservedEfEvidenceHashes[name];
    if (sha(bytes) !== expected) blocked('PRESERVED_EF_HASH');
    values[name] = JSON.parse(bytes.toString('utf8'));
  }
  assertPreservedEfEvidence({
    summary: values['summary.json'],
    trace: values['safe-trace-http.json'],
    delta: values['database-delta.json'],
    facts: values['closure-addendum/actual-facts.json'],
    closure: values['closure-addendum/closure-proof.json'],
    files: values['closure-addendum/file-closure.json'],
  });
  return Object.freeze(values);
}

const preservedCandidatePaths = Object.freeze([
  'tests/support/minimal-page-acceptance.mjs',
  'tests/support/minimal-page-acceptance.d.mts',
  'tests/support/minimal-page-acceptance.test.mjs',
  'tests/e2e/execution-feedback-minimal-page.spec.ts',
  'tests/support/execution-feedback-minimal-page.test.mjs',
]);

export async function readPreservedEfAuthorization(root) {
  const location = resolve(root, '../ca015-integration/.local/resume-20261019');
  const authorizationProof = await readFile(
    resolve(
      root,
      '.local/resume-20261019/ef-extra-session-authorization-20261019.md',
    ),
  );
  if (
    sha(authorizationProof) !==
    '0ff9b9ef6524275341de55ba543b6238a42559c8227b9a900bfb684715741fbc'
  )
    blocked('PRESERVED_EF_AUTHORIZATION');
  const receipt = JSON.parse(
    await readFile(resolve(location, 'ef-checkpoint-receipt.json'), 'utf8'),
  );
  const hashes = Object.fromEntries(
    await Promise.all(
      preservedCandidatePaths.map(async (path) => [
        path,
        sha(await readFile(resolve(root, path))),
      ]),
    ),
  );
  const candidateGit = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  };
  if (
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
    blocked('PRESERVED_EF_CANDIDATE');
  assertPreservedEfAuthorization(receipt, hashes, candidateGit);
  return receipt;
}

export async function snapshotPreservedEfRows(client, sealed) {
  const actualTables = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((row) => row.tablename);
  const expectedTables = sealed.tables.map((entry) => entry.table).sort();
  if (
    actualTables.length !== expectedTables.length ||
    actualTables.some((name, index) => name !== expectedTables[index])
  )
    blocked('PRESERVED_EF_TABLE');
  const tables = [];
  for (const entry of sealed.tables) {
    if (
      !/^[_a-z][_a-z0-9]*$/u.test(entry.table) ||
      !Array.isArray(entry.pk) ||
      entry.pk.length === 0 ||
      entry.pk.some((key) => !/^[a-z][a-z0-9_]*$/u.test(key))
    )
      blocked('PRESERVED_EF_TABLE');
    const key = `jsonb_build_object(${entry.pk.map((name) => `'${name}',t."${name}"`).join(',')})`;
    const rows = (
      await client.query(
        `SELECT encode(sha256(convert_to(${key}::text,'UTF8')),'hex') AS pk_sha256,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha256 FROM public."${entry.table}" t ORDER BY ${entry.pk.map((name) => `t."${name}"`).join(',')}`,
      )
    ).rows;
    tables.push({ table: entry.table, pk: entry.pk, rows });
  }
  const sequences = (
    await client.query(
      "SELECT schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
    )
  ).rows;
  return { tables, sequences };
}

async function readPreservedEfLiveState(client) {
  const id = preservedEfCheckpoint.caseId;
  const filing = preservedEfCheckpoint.filingId;
  const mailing = preservedEfCheckpoint.mailingId;
  const rows = async (sql, values) => (await client.query(sql, values)).rows;
  const caseRows = await rows(
    'SELECT id::text,business_no,stage::text,version,department_id::text,responsible_user_id::text,customer_id::text,rights_holder_id::text FROM cases WHERE id=$1',
    [id],
  );
  return {
    case: caseRows.length === 1 ? caseRows[0] : null,
    external: await rows(
      'SELECT id::text,case_id::text,recorded_by_user_id::text,source FROM case_external_entries WHERE case_id=$1',
      [id],
    ),
    mailings: await rows(
      'SELECT id::text,case_id::text FROM case_execution_mailings WHERE case_id=$1',
      [id],
    ),
    filings: await rows(
      'SELECT id::text,case_id::text FROM case_execution_filings WHERE case_id=$1',
      [id],
    ),
    externalReceipts: await rows(
      'SELECT id::text,case_id::text FROM case_external_entry_receipts WHERE case_id=$1',
      [id],
    ),
    mailingReceipts: await rows(
      'SELECT id::text,case_id::text FROM case_execution_mailing_receipts WHERE case_id=$1',
      [id],
    ),
    filingReceipts: await rows(
      'SELECT id::text,case_id::text FROM case_execution_filing_receipts WHERE case_id=$1',
      [id],
    ),
    contentVersions: await rows(
      'SELECT cv.id::text,cv.material_id::text,cv.storage_key,cv.sha256,cv.size_bytes::text,cv.status::text FROM content_versions cv WHERE cv.id=ANY($1::uuid[])',
      [preservedEfCheckpoint.contentVersionIds],
    ),
    mailingVersions: await rows(
      'SELECT mailing_id::text,content_version_id::text FROM case_execution_mailing_versions WHERE mailing_id=$1',
      [mailing],
    ),
    filingVersions: await rows(
      'SELECT filing_id::text,content_version_id::text FROM case_execution_filing_versions WHERE filing_id=$1',
      [filing],
    ),
    materialReferences: await rows(
      "SELECT resource_type,resource_id::text,content_version_id::text FROM material_references WHERE resource_type='case' AND resource_id=$1 AND content_version_id=ANY($2::uuid[])",
      [id, preservedEfCheckpoint.contentVersionIds],
    ),
    feedbacks: await rows(
      'SELECT id::text FROM case_execution_filing_feedbacks WHERE case_id=$1 AND filing_id=$2',
      [id, filing],
    ),
    followupReceipts: await rows(
      'SELECT id::text FROM case_execution_filing_followup_receipts WHERE case_id=$1 AND filing_id=$2',
      [id, filing],
    ),
  };
}

export function assertPreservedEfLiveState(state) {
  const seal = preservedEfCheckpoint;
  const exact = (rows, ids) =>
    Array.isArray(rows) &&
    rows.length === ids.length &&
    ids.every((id) => rows.some((row) => row.id === id));
  const c = state?.case;
  if (
    c?.id !== seal.caseId ||
    c.business_no !== seal.businessNo ||
    c.stage !== 'EXECUTING' ||
    c.version !== 3 ||
    c.department_id !== departmentId ||
    c.responsible_user_id !== minimalPageScopes.EF_FEEDBACK.userId ||
    c.customer_id !== customerId ||
    c.rights_holder_id !== rightsHolderId ||
    !exact(state.external, ['a6319ad3-2f5e-4b40-9d6e-0a8dbfb22766']) ||
    state.external[0].case_id !== seal.caseId ||
    state.external[0].recorded_by_user_id !==
      minimalPageScopes.EF_FEEDBACK.userId ||
    !new RegExp(
      `^minimal-page:[0-9a-f-]{36}:${minimalPageScopes.EF_FEEDBACK.userId}$`,
      'u',
    ).test(state.external[0].source ?? '') ||
    !exact(state.mailings, [seal.mailingId]) ||
    state.mailings[0].case_id !== seal.caseId ||
    !exact(state.filings, [seal.filingId]) ||
    state.filings[0].case_id !== seal.caseId ||
    !exact(state.externalReceipts, [seal.receiptIds.external]) ||
    !exact(state.mailingReceipts, [seal.receiptIds.mailing]) ||
    !exact(state.filingReceipts, [seal.receiptIds.filing]) ||
    [
      ...state.externalReceipts,
      ...state.mailingReceipts,
      ...state.filingReceipts,
    ].some((row) => row.case_id !== seal.caseId) ||
    !exact(state.contentVersions, seal.contentVersionIds) ||
    state.contentVersions.some(
      (row) =>
        row.sha256 !== seal.pdfSha256 ||
        Number(row.size_bytes) !== 43 ||
        row.status !== 'AVAILABLE' ||
        row.storage_key !== `${departmentId}/${row.material_id}/${row.id}`,
    ) ||
    state.mailingVersions?.length !== 1 ||
    !seal.contentVersionIds.includes(
      state.mailingVersions[0].content_version_id,
    ) ||
    state.mailingVersions[0].mailing_id !== seal.mailingId ||
    state.filingVersions?.length !== 1 ||
    !seal.contentVersionIds.includes(
      state.filingVersions[0].content_version_id,
    ) ||
    state.filingVersions[0].content_version_id ===
      state.mailingVersions[0].content_version_id ||
    state.filingVersions[0].filing_id !== seal.filingId ||
    state.materialReferences?.length !== 2 ||
    seal.contentVersionIds.some(
      (id) =>
        !state.materialReferences.some((row) => row.content_version_id === id),
    ) ||
    state.materialReferences.some(
      (row) => row.resource_id !== seal.caseId || row.resource_type !== 'case',
    ) ||
    state.feedbacks?.length !== 0 ||
    state.followupReceipts?.length !== 0
  )
    blocked('PRESERVED_EF_LIVE');
  return true;
}

export function assertPreservedEfRows(previous, current, complete = false) {
  const additions = complete
    ? {
        auth_sessions: 1,
        case_execution_filing_feedbacks: 2,
        case_execution_filing_followup_receipts: 2,
        audit_events: 2,
      }
    : {};
  if (
    !Array.isArray(previous?.tables) ||
    !Array.isArray(current?.tables) ||
    previous.tables.length !== 165 ||
    current.tables.length !== 165 ||
    JSON.stringify(previous.sequences) !== JSON.stringify(current.sequences)
  )
    blocked('PRESERVED_EF_ROWS');
  for (const original of previous.tables) {
    const observed = current.tables.find(
      (item) => item.table === original.table,
    );
    if (
      !observed ||
      JSON.stringify(observed.pk) !== JSON.stringify(original.pk)
    )
      blocked('PRESERVED_EF_ROWS');
    const old = new Map(
      original.rows.map((row) => [row.pk_sha256, row.row_sha256]),
    );
    const now = new Map(
      observed.rows.map((row) => [row.pk_sha256, row.row_sha256]),
    );
    if (
      old.size !== original.rows.length ||
      now.size !== observed.rows.length ||
      [...old].some(([id, digest]) => now.get(id) !== digest) ||
      (complete === 'partial'
        ? now.size - old.size > (additions[original.table] ?? 0)
        : now.size - old.size !== (additions[original.table] ?? 0))
    )
      blocked('PRESERVED_EF_ROWS');
  }
  return true;
}

export function assertMinimalPageR2Binding(environment) {
  assertExecutionFilingFollowupR2Binding(environment);
  validateLeadBatchPushBinding(environment);
  return true;
}

export function createPreservedEfRequestBudget(runId, username) {
  if (!uuid.test(runId ?? '') || typeof username !== 'string' || !username)
    blocked('PRESERVED_EF_BUDGET');
  const counts = new Map();
  let feedbackId;
  let initialFeedbackId;
  const add = (name, maximum) => {
    const next = (counts.get(name) ?? 0) + 1;
    if (next > maximum) blocked('PRESERVED_EF_BUDGET');
    counts.set(name, next);
  };
  const parse = (value) => {
    try {
      const result = typeof value === 'string' ? JSON.parse(value) : value;
      if (!result || typeof result !== 'object' || Array.isArray(result))
        blocked('PRESERVED_EF_BODY');
      return result;
    } catch {
      blocked('PRESERVED_EF_BODY');
    }
  };
  const sameKeys = (body, names) =>
    Object.keys(body).sort().join('|') === [...names].sort().join('|');
  function admit(method, rawUrl, rawBody) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      blocked('PRESERVED_EF_TARGET');
    }
    if (
      !['http://127.0.0.1:5174', 'http://127.0.0.1:3101'].includes(url.origin)
    )
      blocked('PRESERVED_EF_TARGET');
    if (method === 'GET' || method === 'HEAD') return;
    if (url.search || url.hash) blocked('PRESERVED_EF_TARGET');
    const path = url.pathname;
    if (method === 'POST' && path === '/api/v1/auth/login') {
      const body = parse(rawBody);
      if (
        !sameKeys(body, ['username', 'password']) ||
        body.username !== username ||
        typeof body.password !== 'string' ||
        body.password.length < 12
      )
        blocked('PRESERVED_EF_BODY');
      return add('login', 1);
    }
    if (method === 'POST' && path === '/api/v1/auth/logout') {
      if (rawBody != null && rawBody !== '' && rawBody !== '{}')
        blocked('PRESERVED_EF_BODY');
      return add('logout', 1);
    }
    const base = `/api/v1/cases/${preservedEfCheckpoint.caseId}/execution-filings/${preservedEfCheckpoint.filingId}/feedbacks`;
    if (method === 'POST' && path === base) {
      const body = parse(rawBody);
      if (
        !sameKeys(body, [
          'idempotencyKey',
          'expectedRevision',
          'feedbackOn',
          'courtCaseNo',
          'content',
          'feedbackId',
        ]) ||
        typeof body.idempotencyKey !== 'string' ||
        !body.idempotencyKey ||
        body.expectedRevision !== 0 ||
        body.feedbackOn !== null ||
        body.courtCaseNo !== null ||
        !uuid.test(body.feedbackId ?? '') ||
        body.content !== `合成执行反馈初始记录 ${runId}`
      )
        blocked('PRESERVED_EF_BODY');
      if ((counts.get('feedback') ?? 0) !== 0) blocked('PRESERVED_EF_BUDGET');
      initialFeedbackId = body.feedbackId.toLowerCase();
      return add('feedback', 1);
    }
    if (
      method === 'POST' &&
      feedbackId &&
      path === `${base}/${feedbackId}/corrections`
    ) {
      const body = parse(rawBody);
      if (
        !sameKeys(body, [
          'idempotencyKey',
          'expectedRevision',
          'feedbackOn',
          'courtCaseNo',
          'content',
          'correctionReason',
        ]) ||
        typeof body.idempotencyKey !== 'string' ||
        !body.idempotencyKey ||
        body.expectedRevision !== 1 ||
        body.feedbackOn !== null ||
        body.courtCaseNo !== null ||
        body.content !== `合成执行反馈更正记录 ${runId}` ||
        body.correctionReason !== '补充核对后的反馈内容'
      )
        blocked('PRESERVED_EF_BODY');
      return add('correction', 1);
    }
    blocked('PRESERVED_EF_TARGET');
  }
  return Object.freeze({
    admit,
    setFeedbackRoot(value) {
      if (
        !uuid.test(value ?? '') ||
        value.toLowerCase() !== initialFeedbackId ||
        feedbackId
      )
        blocked('PRESERVED_EF_TARGET');
      feedbackId = value.toLowerCase();
    },
    priorConsumed: preservedEfCheckpoint.priorConsumed,
    counts: () => Object.freeze(Object.fromEntries(counts)),
    assertComplete() {
      if (
        (counts.get('login') ?? 0) !== 1 ||
        (counts.get('feedback') ?? 0) !== 1 ||
        (counts.get('correction') ?? 0) !== 1 ||
        (counts.get('logout') ?? 0) !== 1
      )
        blocked('PRESERVED_EF_INCOMPLETE');
      return true;
    },
  });
}

export function createMinimalPageRequestBudget(kind) {
  fixedScope(kind);
  const counts = new Map();
  const draftIds = new Set();
  const draftCategories = new Map();
  const uploadedDrafts = new Set();
  let mostRecentUploadCategory;
  const proofs = new Map();
  let leadIds;
  let runId;
  let username;
  let businessDay;
  let caseId;
  let filingId;
  let feedbackId;
  let initialFeedbackId;
  let mailingId;
  const add = (key, maximum) => {
    const next = (counts.get(key) ?? 0) + 1;
    if (next > maximum) blocked();
    counts.set(key, next);
  };
  const setOnce = (current, value) => {
    if (current || !uuid.test(value ?? '')) blocked();
    return value.toLowerCase();
  };
  const json = (raw) => {
    try {
      const value =
        typeof raw === 'string' || Buffer.isBuffer(raw)
          ? JSON.parse(raw.toString())
          : raw;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        blocked('BUDGET_BODY');
      return value;
    } catch {
      blocked('BUDGET_BODY');
    }
  };
  const keys = (value, expected) =>
    Object.keys(value).sort().join('|') === [...expected].sort().join('|');
  const key = (value) =>
    typeof value === 'string' && value.length > 0 && value.length <= 128;
  const oneProof = (value, category) =>
    Array.isArray(value) &&
    value.length === 1 &&
    value[0] === proofs.get(category);
  const dayOffset = (days) => {
    const date = new Date(`${businessDay}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  function admit(method, rawUrl, rawBody) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      blocked();
    }
    if (
      !['http://127.0.0.1:5174', 'http://127.0.0.1:3101'].includes(url.origin)
    )
      blocked('BUDGET_ORIGIN');
    if (method === 'GET' || method === 'HEAD') return;
    if (url.search || url.hash) blocked('BUDGET_TARGET');
    const path = url.pathname;
    if (!runId) blocked('BUDGET_RUN');
    if (method === 'POST' && path === '/api/v1/auth/login') {
      const body = json(rawBody);
      if (
        !keys(body, ['username', 'password']) ||
        body.username !== username ||
        typeof body.password !== 'string' ||
        body.password.length < 12
      )
        blocked('BUDGET_BODY');
      return add('login', 1);
    }
    if (method === 'POST' && path === '/api/v1/auth/logout') {
      if (rawBody != null && rawBody !== '' && rawBody !== '{}')
        blocked('BUDGET_BODY');
      return add('logout', 1);
    }
    if (kind === 'LEAD_BATCH') {
      if (method === 'POST' && path === '/api/v1/leads') {
        const body = json(rawBody),
          index = (counts.get('leadCreate') ?? 0) + 1;
        const product = body.products?.[0];
        if (
          index > 2 ||
          !keys(body, [
            'customerId',
            'rightsHolderId',
            'caseType',
            'infringementTypes',
            'source',
            'platform',
            'foundAt',
            'shopName',
            'needDisclose',
            'products',
            'leadScreenshotContentVersionIds',
          ]) ||
          body.customerId !== customerId ||
          body.rightsHolderId !== rightsHolderId ||
          body.caseType !== 'CIVIL' ||
          body.source !== 'ONLINE' ||
          body.platform !== 'TAOBAO' ||
          body.shopName !== `minimal-page:${runId}:${index}` ||
          body.needDisclose !== false ||
          !Array.isArray(body.infringementTypes) ||
          body.infringementTypes.length !== 1 ||
          body.infringementTypes[0] !== 'TRADEMARK' ||
          !Array.isArray(body.leadScreenshotContentVersionIds) ||
          body.leadScreenshotContentVersionIds.length !== 0 ||
          !Array.isArray(body.products) ||
          body.products.length !== 1 ||
          !keys(product ?? {}, [
            'title',
            'quantity',
            'unitPrice',
            'commentCount',
          ]) ||
          product.title !== `${runId}-product-${index}` ||
          product.quantity !== 1 ||
          product.unitPrice !== '1.00' ||
          product.commentCount !== 0 ||
          !Number.isFinite(Date.parse(body.foundAt)) ||
          Math.abs(Date.now() - Date.parse(body.foundAt)) > 15 * 60_000
        )
          blocked('BUDGET_BODY');
        return add('leadCreate', 2);
      }
      if (method === 'POST' && path === '/api/v1/leads/batch-push') {
        const body = json(rawBody);
        if (
          !leadIds ||
          !keys(body, ['items']) ||
          !Array.isArray(body.items) ||
          body.items.length !== 2 ||
          new Set(body.items.map((item) => item?.leadId?.toLowerCase()))
            .size !== 2 ||
          body.items.some(
            (item) =>
              !keys(item ?? {}, ['leadId', 'expectedVersion']) ||
              !leadIds.has(item?.leadId?.toLowerCase()) ||
              item.expectedVersion !== 1,
          )
        )
          blocked('BUDGET_BODY');
        return add('batchPush', 1);
      }
      blocked();
    }
    if (method === 'POST' && path === '/api/v1/cases/external-entries') {
      const body = json(rawBody),
        known = body.known;
      if (
        !keys(body, [
          'idempotencyKey',
          'entryKind',
          'initialStage',
          'stageReachedOn',
          'source',
          'reason',
          'customerId',
          'rightsHolderId',
          'defendants',
          'lawyerAccountId',
          'lawyerProfileId',
          'known',
        ]) ||
        !key(body.idempotencyKey) ||
        body.entryKind !== 'HISTORICAL_BACKFILL' ||
        body.initialStage !== 'WAITING_EXECUTION_STAMP' ||
        body.source !==
          `minimal-page:${runId}:${minimalPageScopes.EF_FEEDBACK.userId}` ||
        body.customerId !== customerId ||
        body.rightsHolderId !== rightsHolderId ||
        !Array.isArray(body.defendants) ||
        body.defendants.length !== 0 ||
        body.lawyerAccountId !== null ||
        body.lawyerProfileId !== null ||
        body.reason !== '独立EF页面验收来源' ||
        body.stageReachedOn !== dayOffset(-6) ||
        !known ||
        !keys(known, [
          'courtId',
          'courtCaseNo',
          'acceptedOn',
          'secondInstanceAcceptedOn',
          'platform',
          'shopName',
          'shopExternalId',
          'caseType',
          'infringementTypes',
        ]) ||
        Object.values(known).some((value) => value !== null)
      )
        blocked('BUDGET_BODY');
      return add('external', 1);
    }
    if (method === 'POST' && path === '/api/v1/materials/upload-drafts') {
      const body = json(rawBody);
      const category =
        (counts.get('draft') ?? 0) === 0
          ? 'MAIL_RECEIPT'
          : 'EXECUTION_FILING_PROOF';
      if (
        !caseId ||
        !keys(body, [
          'ownerType',
          'ownerId',
          'category',
          'purpose',
          'originalFilename',
          'declaredMimeType',
        ]) ||
        body.ownerType !== 'CASE' ||
        body.ownerId !== caseId ||
        body.category !== category ||
        body.purpose !== category ||
        body.declaredMimeType !== 'application/pdf' ||
        !/^[a-f0-9-]{36}\.pdf$/iu.test(body.originalFilename)
      )
        blocked('BUDGET_BODY');
      return add('draft', 2);
    }
    const put =
      /^\/api\/v1\/materials\/upload-drafts\/([a-f0-9-]{36})\/content$/iu.exec(
        path,
      );
    if (method === 'PUT' && put && draftIds.has(put[1].toLowerCase())) {
      if (
        !Buffer.isBuffer(rawBody) ||
        uploadedDrafts.has(put[1].toLowerCase()) ||
        rawBody.length !== 43 ||
        sha(rawBody) !==
          'a920a7cdb0a855fa2f00a0991f9fde35c8db481f204e97dec56f07c917ebe29e'
      )
        blocked('BUDGET_BODY');
      uploadedDrafts.add(put[1].toLowerCase());
      mostRecentUploadCategory = draftCategories.get(put[1].toLowerCase());
      return add('filePut', 2);
    }
    if (!caseId) blocked();
    if (
      method === 'POST' &&
      path === `/api/v1/cases/${caseId}/execution-mail`
    ) {
      const body = json(rawBody);
      if (
        !keys(body, [
          'expectedVersion',
          'idempotencyKey',
          'expectedConfirmationId',
          'mailedAt',
          'mailReceiptContentVersionIds',
        ]) ||
        body.expectedVersion !== 1 ||
        !key(body.idempotencyKey) ||
        body.expectedConfirmationId !== null ||
        body.mailedAt !== dayOffset(-5) ||
        !oneProof(body.mailReceiptContentVersionIds, 'MAIL_RECEIPT')
      )
        blocked('BUDGET_BODY');
      return add('mail', 1);
    }
    if (
      method === 'POST' &&
      path === `/api/v1/cases/${caseId}/execution-filing-submit`
    ) {
      const body = json(rawBody);
      if (
        !mailingId ||
        !keys(body, [
          'expectedVersion',
          'idempotencyKey',
          'expectedMailingId',
          'submittedAt',
          'executionFilingProofContentVersionIds',
        ]) ||
        body.expectedVersion !== 2 ||
        !key(body.idempotencyKey) ||
        body.expectedMailingId !== mailingId ||
        body.submittedAt !== dayOffset(-4) ||
        !oneProof(
          body.executionFilingProofContentVersionIds,
          'EXECUTION_FILING_PROOF',
        )
      )
        blocked('BUDGET_BODY');
      return add('filing', 1);
    }
    if (!filingId) blocked();
    const base = `/api/v1/cases/${caseId}/execution-filings/${filingId}/feedbacks`;
    if (method === 'POST' && path === base) {
      const body = json(rawBody);
      if (
        !keys(body, [
          'idempotencyKey',
          'expectedRevision',
          'feedbackOn',
          'courtCaseNo',
          'content',
          'feedbackId',
        ]) ||
        !key(body.idempotencyKey) ||
        body.expectedRevision !== 0 ||
        body.feedbackOn !== null ||
        body.courtCaseNo !== null ||
        !uuid.test(body.feedbackId ?? '') ||
        body.content !== `合成执行反馈初始记录 ${runId}`
      )
        blocked('BUDGET_BODY');
      initialFeedbackId = body.feedbackId.toLowerCase();
      return add('feedback', 1);
    }
    if (
      method === 'POST' &&
      feedbackId &&
      path === `${base}/${feedbackId}/corrections`
    ) {
      const body = json(rawBody);
      if (
        !keys(body, [
          'idempotencyKey',
          'expectedRevision',
          'feedbackOn',
          'courtCaseNo',
          'content',
          'correctionReason',
        ]) ||
        !key(body.idempotencyKey) ||
        body.expectedRevision !== 1 ||
        body.feedbackOn !== null ||
        body.courtCaseNo !== null ||
        body.content !== `合成执行反馈更正记录 ${runId}` ||
        body.correctionReason !== '补充核对后的反馈内容'
      )
        blocked('BUDGET_BODY');
      return add('correction', 1);
    }
    blocked();
  }
  return Object.freeze({
    admit,
    setRunId(value, loginUsername) {
      if (
        runId ||
        !uuid.test(value ?? '') ||
        typeof loginUsername !== 'string' ||
        !loginUsername
      )
        blocked('BUDGET_RUN');
      runId = value.toLowerCase();
      username = loginUsername;
      businessDay = shanghaiDate(new Date().toISOString());
    },
    setCase(value) {
      caseId = setOnce(caseId, value);
    },
    setLeads(values) {
      if (
        kind !== 'LEAD_BATCH' ||
        leadIds ||
        !Array.isArray(values) ||
        values.length !== 2 ||
        new Set(values.map((value) => value?.toLowerCase())).size !== 2 ||
        values.some((value) => !uuid.test(value ?? '')) ||
        (counts.get('leadCreate') ?? 0) !== 2
      )
        blocked('BUDGET_TARGET');
      leadIds = new Set(values.map((value) => value.toLowerCase()));
    },
    setFiling(value) {
      if (!caseId) blocked();
      filingId = setOnce(filingId, value);
    },
    setFeedbackRoot(value) {
      if (!filingId || value?.toLowerCase() !== initialFeedbackId)
        blocked('BUDGET_TARGET');
      feedbackId = setOnce(feedbackId, value);
    },
    setMailing(value) {
      if (!caseId || (counts.get('mail') ?? 0) !== 1) blocked('BUDGET_TARGET');
      mailingId = setOnce(mailingId, value);
    },
    setProof(category, value) {
      if (
        !['MAIL_RECEIPT', 'EXECUTION_FILING_PROOF'].includes(category) ||
        category !== mostRecentUploadCategory ||
        proofs.has(category) ||
        !uuid.test(value ?? '') ||
        (counts.get('filePut') ?? 0) <= proofs.size
      )
        blocked('BUDGET_TARGET');
      proofs.set(category, value.toLowerCase());
    },
    setDraft(value) {
      if (
        !uuid.test(value ?? '') ||
        draftIds.has(value.toLowerCase()) ||
        draftIds.size >= 2 ||
        (counts.get('draft') ?? 0) <= draftIds.size
      )
        blocked();
      draftIds.add(value.toLowerCase());
      draftCategories.set(
        value.toLowerCase(),
        draftIds.size === 1 ? 'MAIL_RECEIPT' : 'EXECUTION_FILING_PROOF',
      );
    },
    counts() {
      return Object.freeze(Object.fromEntries(counts));
    },
    assertComplete() {
      const expected =
        kind === 'EF_FEEDBACK'
          ? {
              login: 1,
              logout: 1,
              external: 1,
              draft: 2,
              filePut: 2,
              mail: 1,
              filing: 1,
              feedback: 1,
              correction: 1,
            }
          : { login: 1, logout: 1, leadCreate: 2, batchPush: 1 };
      if (
        Object.keys(expected).some((key) => counts.get(key) !== expected[key])
      )
        blocked();
      return true;
    },
  });
}

export function assertMinimalPageSourceAndLedger({
  source,
  identity,
  applied,
  resolveReceipt,
  resolveStdout,
  resolveStderr,
}) {
  assertExecutionFilingFollowupMigrationSource(source);
  assertExecutionFilingFollowupResolveArtifacts(
    resolveReceipt,
    resolveStdout,
    resolveStderr,
  );
  if (!Array.isArray(applied) || applied.length !== 166) blocked();
  assertExecutionFilingFollowupMigrationLedger(
    identity,
    applied,
    source,
    resolveReceipt,
  );
  if (new Set(applied.map((row) => row.id)).size !== 166) blocked();
  return true;
}

function matchesDemoATerminalActor(scope, rows) {
  const terminal = scope.demoATerminal;
  if (!terminal)
    return (
      rows.extraRole === undefined &&
      rows.extraAssignment === undefined &&
      rows.extraGrants === undefined &&
      rows.extraRoleAssignments === undefined
    );
  return (
    rows?.extraRole?.id === terminal.roleId &&
    rows.extraRole.department_id === departmentId &&
    rows.extraRole.active === false &&
    rows.extraRole.version === 2 &&
    rows?.extraAssignment?.id === terminal.assignmentId &&
    rows.extraAssignment.user_id === scope.userId &&
    rows.extraAssignment.department_id === departmentId &&
    rows.extraAssignment.role_template_id === terminal.roleId &&
    rows.extraAssignment.active === true &&
    rows.extraAssignment.version === 1 &&
    Array.isArray(rows.extraGrants) &&
    rows.extraGrants.length === terminal.grants.length &&
    terminal.grants.every(
      (expected) =>
        rows.extraGrants.filter(
          (grant) =>
            grant.id === expected.id &&
            grant.action === expected.action &&
            grant.scope === 'DEPARTMENT' &&
            grant.role_template_id === terminal.roleId,
        ).length === 1,
    ) &&
    rows.extraRoleAssignments?.length === 1 &&
    rows.extraRoleAssignments[0].id === terminal.assignmentId
  );
}

export function assertMinimalPageActor(kind, rows, sealedGrants) {
  const scope = fixedScope(kind);
  const expectedAssignmentIds = [scope.assignmentId];
  if (scope.demoATerminal)
    expectedAssignmentIds.push(scope.demoATerminal.assignmentId);
  if (
    rows?.user?.id !== scope.userId ||
    rows.user.active !== true ||
    rows.user.account_type !== 'INTERNAL' ||
    rows.user.authorization_revision !== (scope.demoATerminal ? 3 : 1) ||
    rows?.role?.id !== scope.roleId ||
    rows.role.department_id !== departmentId ||
    rows.role.active !== true ||
    rows.role.version !== 1 ||
    rows?.assignment?.id !== scope.assignmentId ||
    rows.assignment.user_id !== scope.userId ||
    rows.assignment.department_id !== departmentId ||
    rows.assignment.role_template_id !== scope.roleId ||
    rows.assignment.active !== true ||
    rows.assignment.version !== 1 ||
    rows?.membership?.id !== scope.membershipId ||
    rows.membership.user_id !== scope.userId ||
    rows.membership.department_id !== departmentId ||
    rows.membership.active !== true ||
    rows?.credential?.id !== scope.credentialId ||
    rows.credential.user_id !== scope.userId ||
    !Array.isArray(rows.grants) ||
    scope.actions.some(
      (action) =>
        rows.grants.filter(
          (grant) =>
            grant.action === action &&
            grant.scope === 'DEPARTMENT' &&
            grant.role_template_id === scope.roleId,
        ).length !== 1,
    ) ||
    rows.grants.some(
      (grant) =>
        grant.role_template_id !== scope.roleId || grant.scope !== 'DEPARTMENT',
    ) ||
    rows.activeAssignments?.length !== expectedAssignmentIds.length ||
    expectedAssignmentIds.some(
      (id) =>
        rows.activeAssignments.filter((assignment) => assignment.id === id)
          .length !== 1,
    ) ||
    rows.activeMemberships?.length !== 1 ||
    rows.activeMemberships[0].id !== scope.membershipId ||
    rows.roleAssignments?.length !== 1 ||
    rows.roleAssignments[0].id !== scope.assignmentId ||
    !matchesDemoATerminalActor(scope, rows) ||
    !Array.isArray(sealedGrants) ||
    rows.grants.length !== sealedGrants.length ||
    rows.grants.some(
      (grant) =>
        !sealedGrants.some(
          (prior) =>
            grant.id === prior.id &&
            grant.action === prior.action &&
            grant.scope === prior.scope &&
            grant.role_template_id === prior.role_template_id,
        ),
    )
  )
    blocked();
  return scope;
}

export function assertMinimalPageStartupWindow(input) {
  const start = Date.parse(input?.startIso);
  const deadline = Date.parse(input?.deadlineIso);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(deadline) ||
    deadline <= start ||
    deadline - start > 15 * 60_000 ||
    input.hearingCandidates !== 0 ||
    input.cleanupCandidates !== 0 ||
    input.throttleRows !== 0 ||
    input.sameShanghaiDay !== true
  )
    blocked();
  return true;
}

export function bindMinimalPageSession(
  kind,
  before,
  after,
  cookieValue,
  startIso,
  endIso,
) {
  const scope = fixedScope(kind);
  if (
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    typeof cookieValue !== 'string' ||
    !Number.isFinite(Date.parse(startIso)) ||
    !Number.isFinite(Date.parse(endIso)) ||
    Date.parse(endIso) < Date.parse(startIso) ||
    cookieValue.length < 16
  )
    blocked();
  const beforeIds = new Set(before.map((row) => row.id));
  if (beforeIds.size !== before.length) blocked();
  const added = after.filter((row) => !beforeIds.has(row.id));
  if (added.length !== 1 || after.length !== before.length + 1) blocked();
  const row = added[0];
  if (
    !uuid.test(row.id) ||
    row.user_id !== scope.userId ||
    row.department_id !== departmentId ||
    row.token_digest !== sha(cookieValue) ||
    row.revoked_at !== null ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    !Number.isFinite(Date.parse(row.expires_at)) ||
    Date.parse(row.expires_at) <= Date.parse(row.created_at) ||
    Date.parse(row.created_at) < Date.parse(startIso) ||
    Date.parse(row.created_at) > Date.parse(endIso)
  )
    blocked();
  return Object.freeze({
    id: row.id,
    tokenDigest: row.token_digest,
    userId: scope.userId,
    departmentId,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}

export async function closeMinimalPageSession(
  kind,
  binding,
  { readSession, logout, guardedRevoke },
) {
  const scope = fixedScope(kind);
  if (binding === null) {
    try {
      await logout();
    } catch (error) {
      blocked('SESSION_UNBOUND', error);
    }
    blocked('SESSION_UNBOUND');
  }
  if (
    binding?.userId !== scope.userId ||
    binding.departmentId !== departmentId ||
    !uuid.test(binding.id ?? '') ||
    !/^[0-9a-f]{64}$/u.test(binding.tokenDigest ?? '')
  )
    blocked();
  let logoutFailed = false;
  try {
    await logout();
  } catch {
    logoutFailed = true;
  }
  const row = await readSession(binding);
  if (
    row?.id !== binding.id ||
    row.token_digest !== binding.tokenDigest ||
    row.user_id !== scope.userId ||
    row.department_id !== departmentId ||
    row.created_at !== binding.createdAt ||
    row.expires_at !== binding.expiresAt
  )
    blocked();
  if (row.revoked_at !== null)
    return Object.freeze({
      revoked: true,
      fallback: false,
      logoutSucceeded: !logoutFailed,
    });
  // Controller clears cookies even on failure. Never log in again or revoke an actor's other sessions.
  if (!logoutFailed) blocked();
  const changed = await guardedRevoke(binding);
  if (changed !== 0 && changed !== 1) blocked();
  const verified = await readSession(binding);
  if (
    verified?.id !== binding.id ||
    verified.token_digest !== binding.tokenDigest ||
    verified.user_id !== scope.userId ||
    verified.department_id !== departmentId ||
    verified.created_at !== binding.createdAt ||
    verified.expires_at !== binding.expiresAt ||
    !verified.revoked_at
  )
    blocked();
  return Object.freeze({
    revoked: true,
    fallback: changed === 1,
    logoutSucceeded: false,
  });
}

async function readFrozenEvidence(root, kind) {
  const original = resolve(root, '../ef001-integration/.local/ef001-evidence');
  let sealedGrants;
  if (kind === 'EF_FEEDBACK') {
    for (const [relative, expected] of sourceProofs) {
      if (sha(await readFile(resolve(original, relative))) !== expected)
        blocked();
    }
    const proof = JSON.parse(
      await readFile(resolve(original, sourceProofs[0][0]), 'utf8'),
    );
    sealedGrants = proof.actors?.find(
      (actor) => actor.kind === 'activeSource',
    )?.grants;
  } else {
    const path = resolve(
      original,
      'public160-http14-1a98fc7-20261016/H42-before.json',
    );
    const bytes = await readFile(path);
    if (
      sha(bytes) !==
      'a724a0a177687789c94174a432f09cf3c3a6c724f89c1eb10597995394dec235'
    )
      blocked();
    sealedGrants = JSON.parse(bytes.toString('utf8')).grants;
  }
  const resolveDir = resolve(original, 'official-ef001-resolve');
  const files = Object.fromEntries(
    await Promise.all(
      Object.entries(resolveProofHashes).map(async ([name, expected]) => {
        const bytes = await readFile(resolve(resolveDir, name));
        if (sha(bytes) !== expected) blocked();
        return [name, bytes];
      }),
    ),
  );
  return {
    receipt: JSON.parse(files['receipt.json'].toString('utf8')),
    stdout: files['stdout.log'],
    stderr: files['stderr.log'],
    sealedGrants,
  };
}

async function readSource(root) {
  const directory = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  const source = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: sha(await readFile(resolve(directory, name, 'migration.sql'))),
    })),
  );
  assertExecutionFilingFollowupMigrationSource(source);
  return source;
}

async function assertExistingFingerprintKey(root) {
  // captureTestEnvironment's fingerprintKey can create this file. Refuse that
  // path before capture so the pre-server admission remains read-only.
  const common = execFileSync(
    'git',
    ['-C', root, 'rev-parse', '--git-common-dir'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  const directory = resolve(root, common, 'dev-cor-validation-evidence');
  const file = resolve(directory, 'fingerprint.key');
  const directoryStat = await lstat(directory);
  const fileStat = await lstat(file);
  if (
    !directoryStat.isDirectory() ||
    !fileStat.isFile() ||
    fileStat.size !== 32
  )
    blocked('FINGERPRINT_KEY');
}

function shanghaiDate(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

async function one(client, sql, params = []) {
  const rows = (await client.query(sql, params)).rows;
  if (rows.length !== 1) blocked();
  return rows[0];
}

async function actorRows(client, scope) {
  const [
    user,
    role,
    assignment,
    membership,
    credential,
    grants,
    activeAssignments,
    activeMemberships,
    roleAssignments,
    extraRole,
    extraAssignment,
    extraGrants,
    extraRoleAssignments,
  ] = await Promise.all([
    one(
      client,
      'SELECT id::text,active,account_type::text,authorization_revision FROM user_accounts WHERE id=$1',
      [scope.userId],
    ),
    one(
      client,
      'SELECT id::text,department_id::text,active,version FROM role_templates WHERE id=$1',
      [scope.roleId],
    ),
    one(
      client,
      'SELECT id::text,user_id::text,department_id::text,role_template_id::text,active,version FROM role_assignments WHERE id=$1',
      [scope.assignmentId],
    ),
    one(
      client,
      'SELECT id::text,user_id::text,department_id::text,active FROM department_memberships WHERE id=$1',
      [scope.membershipId],
    ),
    one(
      client,
      'SELECT id::text,user_id::text,username FROM local_credentials WHERE id=$1',
      [scope.credentialId],
    ),
    client
      .query(
        'SELECT id::text,action::text,scope::text,role_template_id::text FROM role_grants WHERE role_template_id=$1',
        [scope.roleId],
      )
      .then((result) => result.rows),
    client
      .query(
        'SELECT id::text FROM role_assignments WHERE user_id=$1 AND active',
        [scope.userId],
      )
      .then((result) => result.rows),
    client
      .query(
        'SELECT id::text FROM department_memberships WHERE user_id=$1 AND active',
        [scope.userId],
      )
      .then((result) => result.rows),
    client
      .query(
        'SELECT id::text FROM role_assignments WHERE role_template_id=$1 AND active',
        [scope.roleId],
      )
      .then((result) => result.rows),
    scope.demoATerminal
      ? one(
          client,
          'SELECT id::text,department_id::text,active,version FROM role_templates WHERE id=$1',
          [scope.demoATerminal.roleId],
        )
      : undefined,
    scope.demoATerminal
      ? one(
          client,
          'SELECT id::text,user_id::text,department_id::text,role_template_id::text,active,version FROM role_assignments WHERE id=$1',
          [scope.demoATerminal.assignmentId],
        )
      : undefined,
    scope.demoATerminal
      ? client
          .query(
            'SELECT id::text,action::text,scope::text,role_template_id::text FROM role_grants WHERE role_template_id=$1',
            [scope.demoATerminal.roleId],
          )
          .then((result) => result.rows)
      : undefined,
    scope.demoATerminal
      ? client
          .query(
            'SELECT id::text FROM role_assignments WHERE role_template_id=$1 AND active',
            [scope.demoATerminal.roleId],
          )
          .then((result) => result.rows)
      : undefined,
  ]);
  return {
    user,
    role,
    assignment,
    membership,
    credential,
    grants,
    activeAssignments,
    activeMemberships,
    roleAssignments,
    extraRole,
    extraAssignment,
    extraGrants,
    extraRoleAssignments,
  };
}

const sessionSql =
  'SELECT id::text,user_id::text,department_id::text,token_digest,created_at::text,expires_at::text,revoked_at::text FROM auth_sessions WHERE user_id=$1 ORDER BY id';
const protectedTables = Object.freeze([
  'user_accounts',
  'department_memberships',
  'local_credentials',
  'role_templates',
  'role_grants',
  'role_assignments',
  'customer_account_bindings',
]);
const trackedTables = Object.freeze({
  EF_FEEDBACK: Object.freeze({
    leads: ['id::text', 0],
    lead_products: ['id::text', 0],
    lead_infringements: ["lead_id::text||':'||infringement_type::text", 0],
    lead_command_receipts: ['id::text', 0],
    lead_batch_push_receipts: ['id::text', 0],
    cases: ['id::text', 1],
    case_external_entries: ['id::text', 1],
    case_external_entry_receipts: ['id::text', 1],
    case_trial_rounds: ['id::text', 1],
    upload_drafts: ['id::text', 2],
    materials: ['id::text', 2],
    content_versions: ['id::text', 2],
    material_references: ['id::text', 2],
    case_execution_mailings: ['id::text', 1],
    case_execution_mailing_versions: [
      "mailing_id::text||':'||content_version_id::text",
      1,
    ],
    case_execution_mailing_receipts: ['id::text', 1],
    case_execution_filings: ['id::text', 1],
    case_execution_filing_versions: [
      "filing_id::text||':'||content_version_id::text",
      1,
    ],
    case_execution_filing_receipts: ['id::text', 1],
    case_execution_filing_feedbacks: ['id::text', 2],
    case_execution_filing_followup_receipts: ['id::text', 2],
    audit_events: ['id::text', 5],
  }),
  LEAD_BATCH: Object.freeze({
    cases: ['id::text', 0],
    case_external_entries: ['id::text', 0],
    case_external_entry_receipts: ['id::text', 0],
    case_trial_rounds: ['id::text', 0],
    upload_drafts: ['id::text', 0],
    materials: ['id::text', 0],
    content_versions: ['id::text', 0],
    material_references: ['id::text', 0],
    case_execution_mailings: ['id::text', 0],
    case_execution_mailing_versions: [
      "mailing_id::text||':'||content_version_id::text",
      0,
    ],
    case_execution_mailing_receipts: ['id::text', 0],
    case_execution_filings: ['id::text', 0],
    case_execution_filing_versions: [
      "filing_id::text||':'||content_version_id::text",
      0,
    ],
    case_execution_filing_receipts: ['id::text', 0],
    case_execution_filing_feedbacks: ['id::text', 0],
    case_execution_filing_followup_receipts: ['id::text', 0],
    leads: ['id::text', 2],
    lead_products: ['id::text', 2],
    lead_infringements: ["lead_id::text||':'||infringement_type::text", 2],
    lead_command_receipts: ['id::text', 2],
    lead_batch_push_receipts: ['id::text', 1],
    audit_events: ['id::text', 4],
  }),
});

async function rowDigestSnapshot(client, kind) {
  const snapshot = new Map();
  for (const [table, [key]] of Object.entries(trackedTables[kind])) {
    const rows = (
      await client.query(
        `SELECT ${key} AS row_key,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM ${table} t`,
      )
    ).rows;
    const mapped = new Map(rows.map((row) => [row.row_key, row.digest]));
    if (mapped.size !== rows.length) blocked('ROW_SNAPSHOT');
    snapshot.set(table, mapped);
  }
  return snapshot;
}

async function counterSnapshot(client, kind) {
  const table =
    kind === 'EF_FEEDBACK' ? 'case_number_counters' : 'lead_number_counters';
  const rows = (
    await client.query(`SELECT business_date::text,last_value FROM ${table}`)
  ).rows;
  return new Map(rows.map((row) => [row.business_date, row.last_value]));
}

async function blobSnapshot(directory) {
  const output = new Map();
  if (!(await lstat(directory)).isDirectory()) blocked('BLOB_ROOT');
  async function visit(current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const file = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(file, relative);
      else if (entry.isFile()) output.set(relative, sha(await readFile(file)));
      else blocked('BLOB_TYPE');
    }
  }
  await visit(directory, '');
  return output;
}

export function assertMinimalPageDatabaseDiff(
  kind,
  before,
  after,
  counterBefore,
  counterAfter,
  verified,
  registered,
) {
  const expected = trackedTables[kind];
  for (const [table, [, maximum]] of Object.entries(expected)) {
    const old = before.get(table),
      current = after.get(table);
    if (
      !old ||
      !current ||
      [...old].some(([id, digest]) => current.get(id) !== digest)
    )
      blocked('OLD_ROW_DRIFT');
    const added = [...current.keys()].filter((id) => !old.has(id));
    if (added.length > maximum || (verified && added.length !== maximum))
      blocked('ROW_DIFF');
    if (
      table === 'cases' &&
      registered &&
      (added.length !== 1 || added[0] !== registered)
    )
      blocked('CASE_DIFF');
    if (
      table === 'leads' &&
      Array.isArray(registered) &&
      (added.length !== 2 || registered.some((id) => !added.includes(id)))
    )
      blocked('LEAD_DIFF');
  }
  const addedCounters = [...counterAfter.keys()].filter(
    (key) => !counterBefore.has(key),
  );
  const changedCounters = [...counterBefore].filter(
    ([key, value]) => counterAfter.get(key) !== value,
  );
  if (
    addedCounters.length > 1 ||
    changedCounters.length > 1 ||
    addedCounters.length + changedCounters.length > 1 ||
    [...counterBefore.keys()].some((key) => !counterAfter.has(key))
  )
    blocked('COUNTER_DIFF');
  if (verified) {
    const increment = kind === 'EF_FEEDBACK' ? 1 : 2;
    const key = addedCounters[0] ?? changedCounters[0]?.[0];
    if (
      !key ||
      counterAfter.get(key) !== (counterBefore.get(key) ?? 0) + increment
    )
      blocked('COUNTER_DIFF');
  }
  return true;
}

async function securityFingerprint(client) {
  const parts = [];
  for (const table of protectedTables) {
    const result = await one(
      client,
      `SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]'),'UTF8')),'hex') AS digest FROM ${table} t`,
    );
    parts.push(`${table}:${result.digest}`);
  }
  return sha(parts.join('\n'));
}

async function sessionSnapshot(client) {
  const rows = (
    await client.query(
      "SELECT id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') AS digest FROM auth_sessions s",
    )
  ).rows;
  return new Map(rows.map((row) => [row.id, row.digest]));
}

export function createMinimalPageAcceptance(kind, options = {}) {
  const scope = fixedScope(kind);
  const resumeMode =
    kind === 'EF_FEEDBACK' &&
    (options.mode === preservedEfCheckpoint.mode ||
      options.preflightOnly === true);
  if (options.mode !== undefined && !resumeMode) blocked('PRESERVED_EF_MODE');
  if (kind === 'EF_FEEDBACK' && !resumeMode) blocked('PRESERVED_EF_MODE');
  const root = resolve(options.root ?? process.cwd());
  const environment = options.environment ?? process.env;
  let client;
  let prepared;
  let before;
  let bound;
  let beforeLoginAt;
  let registered = false;
  let originalCaseIds;
  let originalLeadIds;
  let securityBefore;
  let sessionsBefore;
  let rowsBefore;
  let counterBefore;
  let blobsBefore;
  let blobRoot;
  let verified = false;
  let sessionClosed = false;
  let preservedEvidence;
  let preservedRows;
  let preservedSourceRunId;

  async function prepare() {
    if (prepared || client) blocked();
    let phase = 'R2_BINDING';
    assertMinimalPageR2Binding(environment); // before capture, Docker, PG, services
    try {
      if (resumeMode) {
        phase = 'PRESERVED_EF_AUTHORIZATION';
        await readPreservedEfAuthorization(root); // no capture, credential, PG or HTTP yet
        phase = 'PRESERVED_EF_EVIDENCE';
        preservedEvidence = await readPreservedEfEvidence(root);
      }
      phase = 'FROZEN_SOURCE';
      const source = await readSource(root);
      phase = 'ORDINARY_PROOF';
      const evidence = await readFrozenEvidence(root, kind);
      await assertExistingFingerprintKey(root);
      phase = 'CAPTURE';
      const captured = captureTestEnvironment(root, {
        pnpmVersion: '11.27.0',
        inheritedEnvironment: environment,
      });
      if (captured.childEnvironment.DATABASE_URL !== environment.DATABASE_URL)
        blocked();
      phase = 'PG_CONNECT';
      const requireBackend = createRequire(
        resolve(root, 'backend/package.json'),
      );
      client = new (requireBackend('pg').Client)({
        connectionString: environment.DATABASE_URL,
      });
      await client.connect();
      await client.query('BEGIN READ ONLY');
      phase = 'LEDGER';
      const identity = await client.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      );
      const applied = await client.query(
        'SELECT id::text,migration_name,checksum,started_at::text,finished_at::text,rolled_back_at::text,applied_steps_count,(logs IS NULL) AS logs_is_null FROM public._prisma_migrations ORDER BY migration_name,started_at',
      );
      assertMinimalPageSourceAndLedger({
        source,
        identity: identity.rows,
        applied: applied.rows,
        resolveReceipt: evidence.receipt,
        resolveStdout: evidence.stdout,
        resolveStderr: evidence.stderr,
      });
      phase = 'ACTOR';
      const rows = await actorRows(client, scope);
      assertMinimalPageActor(kind, rows, evidence.sealedGrants);
      securityBefore = await securityFingerprint(client);
      sessionsBefore = await sessionSnapshot(client);
      rowsBefore = await rowDigestSnapshot(client, kind);
      counterBefore = await counterSnapshot(client, kind);
      if (resumeMode) {
        phase = 'PRESERVED_EF_LIVE';
        preservedRows = await snapshotPreservedEfRows(
          client,
          preservedEvidence['all-after-rows.json'],
        );
        assertPreservedEfRows(
          preservedEvidence['all-after-rows.json'],
          preservedRows,
        );
        const live = await readPreservedEfLiveState(client);
        assertPreservedEfLiveState(live);
        preservedSourceRunId = live.external[0].source.split(':')[1];
      }
      blobRoot = captured.childEnvironment.PRIVATE_FILE_ROOT;
      if (resumeMode || options.preflightOnly !== true)
        blobsBefore = await blobSnapshot(blobRoot);
      if (resumeMode) {
        const expectedFiles =
          preservedEvidence['closure-addendum/file-closure.json'].files;
        const versionRows = (
          await client.query(
            'SELECT id::text,storage_key FROM content_versions',
          )
        ).rows;
        if (
          versionRows.length !== expectedFiles.length ||
          blobsBefore.size !== expectedFiles.length ||
          expectedFiles.some((file) => {
            const row = versionRows.find((item) => item.id === file.id);
            return !row || blobsBefore.get(row.storage_key) !== file.sha256;
          })
        )
          blocked('PRESERVED_EF_FILES');
      }
      phase = 'FIXTURE';
      const fixture = await one(
        client,
        'SELECT (SELECT count(*)::int FROM customers WHERE id=$1 AND department_id=$3 AND deleted_at IS NULL) AS customer,(SELECT count(*)::int FROM customer_rights_holder_links WHERE rights_holder_id=$2 AND customer_id=$1 AND department_id=$3) AS holder',
        [customerId, rightsHolderId, departmentId],
      );
      if (fixture.customer !== 1 || fixture.holder !== 1) blocked();
      originalCaseIds = new Set(
        (await client.query('SELECT id::text FROM cases')).rows.map(
          (row) => row.id,
        ),
      );
      if (resumeMode) registered = preservedEfCheckpoint.caseId;
      originalLeadIds = new Set(
        (await client.query('SELECT id::text FROM leads')).rows.map(
          (row) => row.id,
        ),
      );
      phase = 'STARTUP_WINDOW';
      const startIso = new Date().toISOString();
      const localDeadline = Date.parse(startIso) + 15 * 60_000;
      const inherited = options.window;
      if (
        inherited &&
        (!uuid.test(inherited.runId ?? '') ||
          !Number.isFinite(Date.parse(inherited.deadlineIso)))
      )
        blocked();
      const deadlineIso = new Date(
        Math.min(
          localDeadline,
          inherited ? Date.parse(inherited.deadlineIso) : localDeadline,
        ),
      ).toISOString();
      const today = shanghaiDate(startIso);
      if (shanghaiDate(deadlineIso) !== today) blocked();
      const hearing = await one(
        client,
        `SELECT count(*)::int AS count FROM cases c JOIN case_hearing_arrangements a ON a.id=c.current_hearing_arrangement_id WHERE c.stage='WAITING_HEARING' AND (a.hearing_at < $1::date OR EXISTS (SELECT 1 FROM case_hearing_record_corrections rc WHERE rc.arrangement_id=a.id AND rc.hearing_at < $1::date))`,
        [today],
      );
      const cleanup = await one(
        client,
        `SELECT (SELECT count(*) FROM upload_drafts d WHERE d.pending_storage_key IS NOT NULL AND d.updated_at <= $1::timestamptz - interval '15 minutes' AND NOT EXISTS (SELECT 1 FROM content_versions cv WHERE cv.storage_key=d.pending_storage_key)) + (SELECT count(*) FROM upload_drafts WHERE status='OPEN' AND expires_at <= $1) + (SELECT count(*) FROM content_versions cv JOIN materials m ON m.id=cv.material_id WHERE cv.status IN ('AVAILABLE','DELETED') AND ((m.status='DELETED' AND m.deleted_at + interval '90 days' <= $1) OR (m.owner_type='LEAD_DRAFT' AND EXISTS (SELECT 1 FROM upload_drafts d WHERE d.department_id=m.department_id AND d.owner_id=m.owner_id AND d.owner_type='LEAD_DRAFT' AND d.expires_at <= $1)) ) AND NOT EXISTS (SELECT 1 FROM material_references mr WHERE mr.content_version_id=cv.id)) AS count`,
        [deadlineIso],
      );
      const throttleSecret = captured.childEnvironment.AUTH_THROTTLE_SECRET;
      if (typeof throttleSecret !== 'string' || !throttleSecret) blocked();
      const usernameDigest = sha(
        rows.credential.username.trim().normalize('NFKC').toLowerCase(),
      );
      const sourceDigest = createHmac('sha256', throttleSecret)
        .update('127.0.0.1')
        .digest('hex');
      const throttle = await one(
        client,
        "SELECT count(*)::int AS count FROM auth_throttles WHERE (kind='USERNAME' AND identifier_digest=$1) OR (kind='SOURCE' AND identifier_digest=$2)",
        [usernameDigest, sourceDigest],
      );
      assertMinimalPageStartupWindow({
        startIso,
        deadlineIso,
        hearingCandidates: hearing.count,
        cleanupCandidates: Number(cleanup.count),
        throttleRows: throttle.count,
        sameShanghaiDay: true,
      });
      await client.query('COMMIT');
      phase = 'PRIVATE_CREDENTIAL';
      const runId = inherited?.runId ?? options.runId ?? randomUUID();
      if (!uuid.test(runId)) blocked();
      if (options.preflightOnly === true) {
        prepared = Object.freeze({
          runId,
          deadlineIso,
          sourceRunId: resumeMode ? preservedSourceRunId : undefined,
        });
        return prepared;
      }
      const credentialBytes = await readFile(scope.privateCredential.path);
      if (sha(credentialBytes) !== scope.privateCredential.sha256) blocked();
      const privateValue = JSON.parse(credentialBytes.toString('utf8'));
      const login =
        kind === 'EF_FEEDBACK'
          ? privateValue.actors?.source?.login
          : privateValue;
      if (
        (kind === 'EF_FEEDBACK' &&
          (privateValue.actors?.source?.userId !== scope.userId ||
            privateValue.actors?.source?.roleId !== scope.roleId ||
            privateValue.actors?.source?.assignmentId !==
              scope.assignmentId)) ||
        (kind === 'LEAD_BATCH' &&
          (privateValue.actorId !== scope.userId ||
            privateValue.roleId !== scope.roleId ||
            privateValue.departmentId !== departmentId)) ||
        typeof login?.username !== 'string' ||
        typeof login?.password !== 'string' ||
        !login.username ||
        !login.password ||
        login.username !== rows.credential.username
      )
        blocked();
      prepared = Object.freeze({
        runId,
        deadlineIso,
        sourceRunId: resumeMode ? preservedSourceRunId : undefined,
        actor: {
          userId: scope.userId,
          departmentId,
          username: login.username,
          password: login.password,
        },
        fixture: { customerId, rightsHolderId },
      });
      return prepared;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (client) {
        const old = client;
        client = undefined;
        await old.end().catch(() => undefined);
      }
      const failure = new Error(`Minimal page acceptance BLOCKED: ${phase}`);
      failure.code = `MINIMAL_PAGE_${phase}`;
      failure.phase = phase;
      failure.causeCode = safePreflightCauseCode(error?.code, error?.name);
      throw failure;
    }
  }

  async function beforeLogin() {
    if (!prepared || before || Date.now() >= Date.parse(prepared.deadlineIso))
      blocked();
    beforeLoginAt = new Date().toISOString();
    before = (await client.query(sessionSql, [scope.userId])).rows;
    return Object.freeze({ count: before.length });
  }

  async function bindSession(cookieValue) {
    if (!before || bound || Date.now() >= Date.parse(prepared.deadlineIso))
      blocked();
    const after = (await client.query(sessionSql, [scope.userId])).rows;
    bound = bindMinimalPageSession(
      kind,
      before,
      after,
      cookieValue,
      beforeLoginAt,
      new Date().toISOString(),
    );
    return bound;
  }

  async function closeSession(logoutCallback) {
    const result = await closeMinimalPageSession(kind, bound ?? null, {
      readSession: async (binding) =>
        one(
          client,
          `${sessionSql.replace(' ORDER BY id', '')} AND id=$2 AND token_digest=$3`,
          [binding.userId, binding.id, binding.tokenDigest],
        ),
      logout: logoutCallback,
      guardedRevoke: async (binding) => {
        await client.query('BEGIN');
        try {
          const locked = await one(
            client,
            'SELECT id::text,user_id::text,department_id::text,token_digest,created_at::text,expires_at::text,revoked_at::text FROM auth_sessions WHERE id=$1 FOR UPDATE',
            [binding.id],
          );
          if (
            locked.id !== binding.id ||
            locked.token_digest !== binding.tokenDigest ||
            locked.user_id !== binding.userId ||
            locked.department_id !== binding.departmentId ||
            locked.created_at !== binding.createdAt ||
            locked.expires_at !== binding.expiresAt
          )
            blocked();
          if (locked.revoked_at !== null) {
            await client.query('COMMIT');
            return 0;
          }
          const changed = await client.query(
            'UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND token_digest=$2 AND user_id=$3 AND department_id=$4 AND created_at=$5::timestamptz AND expires_at=$6::timestamptz AND revoked_at IS NULL',
            [
              binding.id,
              binding.tokenDigest,
              binding.userId,
              binding.departmentId,
              binding.createdAt,
              binding.expiresAt,
            ],
          );
          if (changed.rowCount !== 1) blocked();
          await client.query('COMMIT');
          return changed.rowCount;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      },
    });
    sessionClosed = true;
    return result;
  }

  async function registerCase(caseId) {
    if (
      kind !== 'EF_FEEDBACK' ||
      !prepared ||
      registered ||
      !uuid.test(caseId ?? '')
    )
      blocked();
    if (originalCaseIds.has(caseId)) blocked();
    const row = await one(
      client,
      'SELECT c.id::text,c.department_id::text,c.responsible_user_id::text,c.customer_id::text,c.rights_holder_id::text,e.entry_kind::text,e.initial_stage::text,e.source,e.recorded_by_user_id::text FROM cases c JOIN case_external_entries e ON e.case_id=c.id WHERE c.id=$1',
      [caseId],
    );
    if (
      row.department_id !== departmentId ||
      row.responsible_user_id !== scope.userId ||
      row.customer_id !== customerId ||
      row.rights_holder_id !== rightsHolderId ||
      row.entry_kind !== 'HISTORICAL_BACKFILL' ||
      row.initial_stage !== 'WAITING_EXECUTION_STAMP' ||
      row.source !== `minimal-page:${prepared.runId}:${scope.userId}` ||
      row.recorded_by_user_id !== scope.userId
    )
      blocked();
    registered = caseId;
    return true;
  }

  async function registerLeads(ids) {
    if (
      kind !== 'LEAD_BATCH' ||
      !prepared ||
      registered ||
      !Array.isArray(ids) ||
      ids.length !== 2 ||
      new Set(ids).size !== 2 ||
      ids.some((id) => !uuid.test(id))
    )
      blocked();
    if (ids.some((id) => originalLeadIds.has(id))) blocked();
    const result = await client.query(
      'SELECT id::text,department_id::text,customer_id::text,rights_holder_id::text,responsible_user_id::text,shop_name,creation_channel::text,status::text,version FROM leads WHERE id=ANY($1::uuid[])',
      [ids],
    );
    if (
      result.rows.length !== 2 ||
      ids.some((id, index) => {
        const row = result.rows.find((item) => item.id === id);
        return (
          !row ||
          row.department_id !== departmentId ||
          row.customer_id !== customerId ||
          row.rights_holder_id !== rightsHolderId ||
          row.responsible_user_id !== scope.userId ||
          row.shop_name !== `minimal-page:${prepared.runId}:${index + 1}` ||
          row.creation_channel !== 'MANUAL' ||
          row.status !== 'WAITING_PUSH' ||
          row.version !== 1
        );
      })
    )
      blocked();
    const created = await client.query(
      'SELECT result_lead_id::text AS id,actor_user_id::text,action,result_lead_version FROM lead_command_receipts WHERE result_lead_id=ANY($1::uuid[]) AND department_id=$2',
      [ids, departmentId],
    );
    if (
      created.rows.length !== 2 ||
      created.rows.some(
        (row) =>
          !ids.includes(row.id) ||
          row.actor_user_id !== scope.userId ||
          row.action !== 'create' ||
          row.result_lead_version !== 1,
      )
    )
      blocked();
    registered = Object.freeze([...ids]);
    return true;
  }

  async function verifyEfResult(caseId, feedbackId, filingId) {
    if (
      kind !== 'EF_FEEDBACK' ||
      registered !== caseId ||
      !uuid.test(feedbackId ?? '') ||
      !uuid.test(filingId ?? '')
    )
      blocked();
    const result = await one(
      client,
      "SELECT count(*)::int AS count,min(from_revision) AS first,max(to_revision) AS last,count(*) FILTER (WHERE recorded_by_user_id=$4 AND department_id=$5 AND actor_type='INTERNAL')::int AS owned FROM case_execution_filing_feedbacks WHERE case_id=$1 AND filing_id=$2 AND feedback_id=$3",
      [caseId, filingId, feedbackId, scope.userId, departmentId],
    );
    if (
      result.count !== 2 ||
      result.owned !== 2 ||
      result.first !== 0 ||
      result.last !== 2
    )
      blocked();
    const receipt = await one(
      client,
      "SELECT count(*)::int AS count,count(*) FILTER (WHERE command='FEEDBACK_RECORD')::int AS initial,count(*) FILTER (WHERE command='FEEDBACK_CORRECT')::int AS correction FROM case_execution_filing_followup_receipts WHERE case_id=$1 AND filing_id=$2 AND actor_user_id=$3 AND department_id=$4 AND feedback_version_id IN (SELECT id FROM case_execution_filing_feedbacks WHERE feedback_id=$5)",
      [caseId, filingId, scope.userId, departmentId, feedbackId],
    );
    if (
      receipt.count !== 2 ||
      receipt.initial !== 1 ||
      receipt.correction !== 1
    )
      blocked();
    const audit = await one(
      client,
      "SELECT count(*)::int AS count,count(*) FILTER (WHERE action='case.execution.feedback.recorded')::int AS initial,count(*) FILTER (WHERE action='case.execution.feedback.corrected')::int AS correction FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND actor_user_id=$2 AND department_id=$3 AND details->>'feedbackId'=$4",
      [caseId, scope.userId, departmentId, feedbackId],
    );
    if (audit.count !== 2 || audit.initial !== 1 || audit.correction !== 1)
      blocked();
    const filing = await one(
      client,
      'SELECT case_id::text,department_id::text,submitted_by_user_id::text FROM case_execution_filings WHERE id=$1',
      [filingId],
    );
    if (
      filing.case_id !== caseId ||
      filing.department_id !== departmentId ||
      filing.submitted_by_user_id !== scope.userId
    )
      blocked();
    verified = true;
    return true;
  }

  async function verifyLeadResult(ids) {
    if (
      kind !== 'LEAD_BATCH' ||
      !Array.isArray(registered) ||
      JSON.stringify(ids) !== JSON.stringify(registered)
    )
      blocked();
    const result = await one(
      client,
      "SELECT count(*)::int AS count FROM leads WHERE id=ANY($1::uuid[]) AND department_id=$2 AND status='WAITING_REVIEW' AND version=2 AND pushed_by_user_id=$3 AND pushed_at IS NOT NULL",
      [ids, departmentId, scope.userId],
    );
    if (result.count !== 2) blocked();
    const receipt = await one(
      client,
      "SELECT count(*)::int AS count FROM lead_batch_push_receipts WHERE department_id=$1 AND actor_user_id=$2 AND original_request->'items' @> $3::jsonb AND jsonb_array_length(original_request->'items')=2",
      [
        departmentId,
        scope.userId,
        JSON.stringify(ids.map((leadId) => ({ leadId, expectedVersion: 1 }))),
      ],
    );
    if (receipt.count !== 1) blocked();
    const audits = await client.query(
      "SELECT resource_id::text,action,count(*)::int AS count FROM audit_events WHERE resource_type='lead' AND resource_id=ANY($1::uuid[]) AND department_id=$2 AND actor_user_id=$3 AND action IN ('lead.created','lead.pushed') GROUP BY resource_id,action",
      [ids, departmentId, scope.userId],
    );
    if (
      audits.rows.length !== 4 ||
      audits.rows.some(
        (row) =>
          !ids.includes(row.resource_id) ||
          !['lead.created', 'lead.pushed'].includes(row.action) ||
          row.count !== 1,
      )
    )
      blocked();
    verified = true;
    return true;
  }

  async function dispose() {
    if (client) {
      const old = client;
      client = undefined;
      try {
        if (securityBefore && prepared && options.preflightOnly !== true) {
          if ((await securityFingerprint(old)) !== securityBefore)
            blocked('SECURITY_DRIFT');
          const sessionsAfter = await sessionSnapshot(old);
          if (
            [...sessionsBefore].some(
              ([id, hash]) => sessionsAfter.get(id) !== hash,
            )
          )
            blocked('OLD_SESSION_DRIFT');
          const added = [...sessionsAfter.keys()].filter(
            (id) => !sessionsBefore.has(id),
          );
          if (
            added.length !== (bound ? 1 : 0) ||
            (bound && (added[0] !== bound.id || !sessionClosed))
          )
            blocked('SESSION_DIFF');
          const rowsAfter = await rowDigestSnapshot(old, kind);
          if (resumeMode) {
            const current = await snapshotPreservedEfRows(
              old,
              preservedEvidence['all-after-rows.json'],
            );
            assertPreservedEfRows(
              preservedEvidence['all-after-rows.json'],
              current,
              verified ? true : 'partial',
            );
            const counterAfter = await counterSnapshot(old, kind);
            if (
              JSON.stringify([...counterBefore]) !==
              JSON.stringify([...counterAfter])
            )
              blocked('PRESERVED_EF_COUNTER');
          } else {
            await assertMinimalPageDatabaseDiff(
              kind,
              rowsBefore,
              rowsAfter,
              counterBefore,
              await counterSnapshot(old, kind),
              verified,
              registered,
            );
          }
          const blobsAfter = await blobSnapshot(blobRoot);
          if (
            [...blobsBefore].some(
              ([path, digest]) => blobsAfter.get(path) !== digest,
            )
          )
            blocked('OLD_BLOB_DRIFT');
          const newBlobs = [...blobsAfter.keys()].filter(
            (path) => !blobsBefore.has(path),
          );
          const blobMaximum = resumeMode ? 0 : kind === 'EF_FEEDBACK' ? 2 : 0;
          if (
            newBlobs.length > blobMaximum ||
            (verified && newBlobs.length !== blobMaximum)
          )
            blocked('BLOB_DIFF');
          if (kind === 'EF_FEEDBACK' && verified && !resumeMode) {
            const newVersions = [
              ...rowsAfter.get('content_versions').keys(),
            ].filter((id) => !rowsBefore.get('content_versions').has(id));
            const newMaterials = new Set(
              [...rowsAfter.get('materials').keys()].filter(
                (id) => !rowsBefore.get('materials').has(id),
              ),
            );
            const versions = (
              await old.query(
                'SELECT id::text,material_id::text,storage_key,sha256,size_bytes::text FROM content_versions WHERE id=ANY($1::uuid[])',
                [newVersions],
              )
            ).rows;
            if (
              versions.length !== 2 ||
              versions.some(
                (row) =>
                  !newMaterials.has(row.material_id) ||
                  row.storage_key !==
                    `${departmentId}/${row.material_id}/${row.id}` ||
                  !newBlobs.includes(row.storage_key) ||
                  row.sha256 !==
                    'a920a7cdb0a855fa2f00a0991f9fde35c8db481f204e97dec56f07c917ebe29e' ||
                  row.size_bytes !== '43' ||
                  blobsAfter.get(row.storage_key) !== row.sha256,
              )
            )
              blocked('BLOB_ANCHOR');
          }
        }
      } finally {
        await old.end();
      }
    }
  }

  return Object.freeze({
    prepare,
    beforeLogin,
    bindSession,
    closeSession,
    registerCase,
    registerLeads,
    verifyEfResult,
    verifyLeadResult,
    dispose,
  });
}
