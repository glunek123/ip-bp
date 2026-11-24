#!/usr/bin/env node
/**
 * 补录「外部结案」事实（仅 dry-run 默认，--apply 才提交）。
 *
 * 适用：迁移时直接落在待归档、从未走执行流程的案件。补一条外部结案记录
 * （审计 + 结案版本 + 结案头 + 回执 + 案件版本），不是伪造执行链。
 *
 * 用法：
 *   node backend/scripts/backfill-external-closures.mjs --file=/tmp/closures.csv [--apply]
 *
 * CSV 列：business_no,close_at,close_amt,legacy_case_number,note
 *   close_at 为 YYYY-MM-DD 或空；close_amt 为数字或空。
 * 每个案件先在事务内写入并 SET CONSTRAINTS ALL IMMEDIATE 校验，dry-run 后回滚。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const args = new Map(
  process.argv
    .slice(2)
    .map((item) => item.replace(/^--/u, ''))
    .map((item) => {
      const index = item.indexOf('=');
      return index === -1 ? [item, 'true'] : [item.slice(0, index), item.slice(index + 1)];
    }),
);
const file = args.get('file');
const apply = args.get('apply') === 'true';
const actorUsername = args.get('actor') ?? 'zhichan';
const connectionString = process.env.DATABASE_URL;
if (!file) {
  console.error('需要 --file=<csv>');
  process.exit(2);
}
if (!connectionString) {
  console.error('DATABASE_URL 未设置');
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const [header, ...body] = parseCsv(readFileSync(file, 'utf8'));
const rows = body
  .filter((cells) => cells.length === header.length)
  .map((cells) => Object.fromEntries(header.map((key, at) => [key, cells[at]])));

function uuidFor(...parts) {
  const hex = createHash('md5').update(parts.join(':')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const client = new Client({ connectionString });
await client.connect();
const results = [];
try {
  const { rows: actors } = await client.query(
    `SELECT ua.id
       FROM user_accounts ua
       JOIN local_credentials lc ON lc.user_id = ua.id
      WHERE lc.username = $1 AND ua.active
      LIMIT 1`,
    [actorUsername],
  );
  if (actors.length === 0) throw new Error(`actor ${actorUsername} not found`);
  const actorId = actors[0].id;

  for (const row of rows) {
    const businessNo = (row.business_no ?? '').trim();
    if (!businessNo) continue;
    const closeAt = (row.close_at ?? '').trim() || null;
    const closeAmt = (row.close_amt ?? '').trim() || null;
    const legacyNo = (row.legacy_case_number ?? '').trim();
    const rowNote = (row.note ?? '').trim();

    await client.query('BEGIN');
    let state = 'ok';
    let detail = '';
    try {
      const { rows: cases } = await client.query(
        `SELECT id, department_id, stage::text AS stage, version
           FROM cases WHERE business_no = $1`,
        [businessNo],
      );
      if (cases.length !== 1) throw new Error(`案件不唯一或不存在：${cases.length}`);
      const target = cases[0];
      if (target.stage !== 'WAITING_ARCHIVE') throw new Error(`阶段不是待归档：${target.stage}`);

      const { rows: entries } = await client.query(
        `SELECT id FROM case_external_entries
          WHERE case_id = $1 AND department_id = $2 AND initial_stage = 'WAITING_ARCHIVE'`,
        [target.id, target.department_id],
      );
      if (entries.length !== 1) throw new Error(`外部入口不唯一：${entries.length}`);

      const { rows: existing } = await client.query(
        'SELECT id FROM case_closures WHERE case_id = $1',
        [target.id],
      );
      if (existing.length > 0) throw new Error('已存在结案记录，跳过');

      const auditId = uuidFor(target.id, 'closure-audit');
      const versionId = uuidFor(target.id, 'closure-version');
      const closureId = uuidFor(target.id, 'closure');
      const receiptId = uuidFor(target.id, 'closure-receipt');
      const fromVersion = target.version;
      const toVersion = fromVersion + 1;
      const amountState = closeAmt ? 'KNOWN' : 'PENDING';
      // close_amt 是 numeric(16,2)，审计里必须写与列存储完全一致的文本，否则守卫比对失败。
      let closeAmtText = null;
      if (closeAmt) {
        const { rows: amountRows } = await client.query(
          'SELECT ($1::numeric(16,2))::text AS text',
          [closeAmt],
        );
        closeAmtText = amountRows[0].text;
      }
      const recordedAt = closeAt
        ? new Date(`${closeAt}T02:00:00.000Z`)
        : new Date();
      const note = rowNote || `迁移补录：老系统已结案${legacyNo ? `（原案号 ${legacyNo}）` : ''}`;
      const details = {
        closureId,
        closureVersionId: versionId,
        priorVersionId: null,
        finishId: null,
        fromVersion: String(fromVersion),
        toVersion: String(toVersion),
        closeAt,
        closeAmountState: amountState,
        closeAmt: closeAmtText,
        note,
        correctionReason: null,
        closeContentVersionIds: [],
      };

      await client.query(
        `INSERT INTO audit_events
           (id, department_id, actor_user_id, internal_actor_user_id, resource_type, resource_id, action, details)
         VALUES ($1,$2,$3,$3,'CASE',$4,'case.closure.recorded',$5::jsonb)`,
        [auditId, target.department_id, actorId, target.id, JSON.stringify(details)],
      );
      await client.query(
        `INSERT INTO case_closure_versions
           (id, closure_id, case_id, department_id, finish_id, kind, prior_version_id,
            from_version, to_version, close_at, close_amount_state, close_amt, note,
            correction_reason, recorded_at, recorded_by_user_id, audit_event_id,
            external_entry_id, early_closure_id, payment_type)
         VALUES ($1,$2,$3,$4,NULL,'REGISTER',NULL,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,$14,NULL,NULL)`,
        [
          versionId,
          closureId,
          target.id,
          target.department_id,
          fromVersion,
          toVersion,
          closeAt,
          amountState,
          closeAmt,
          note,
          recordedAt,
          actorId,
          auditId,
          entries[0].id,
        ],
      );
      await client.query(
        `INSERT INTO case_closures
           (id, case_id, department_id, finish_id, current_version_id, external_entry_id, early_closure_id)
         VALUES ($1,$2,$3,NULL,$4,$5,NULL)`,
        [closureId, target.id, target.department_id, versionId, entries[0].id],
      );
      await client.query(
        'UPDATE cases SET version = $2 WHERE id = $1',
        [target.id, toVersion],
      );
      const snapshot = {
        id: target.id,
        closureId,
        closureVersionId: versionId,
        finishId: null,
        stage: 'WAITING_ARCHIVE',
        version: String(toVersion),
        recordedAt: recordedAt.toISOString().replace('Z', '+00:00'),
      };
      await client.query(
        `INSERT INTO case_closure_receipts
           (id, department_id, actor_user_id, case_id, command, idempotency_key, request_fingerprint, result_snapshot)
         VALUES ($1,$2,$3,$4,'RECORD',$5,$6,$7::jsonb)`,
        [
          receiptId,
          target.department_id,
          actorId,
          target.id,
          `backfill-${businessNo}-${fromVersion}`,
          createHash('sha256').update(`backfill:${businessNo}:${fromVersion}`).digest('hex'),
          JSON.stringify(snapshot),
        ],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      detail = `version ${fromVersion}->${toVersion} closeAt=${closeAt ?? '-'} amt=${closeAmt ?? '-'}`;
    } catch (error) {
      state = 'blocked';
      detail = String(error.message ?? error).split('\n')[0].slice(0, 160);
    } finally {
      await client.query(apply && state === 'ok' ? 'COMMIT' : 'ROLLBACK');
    }
    results.push({ businessNo, state, detail });
    console.log(`${state === 'ok' ? 'OK  ' : 'SKIP'} ${businessNo} ${detail}`);
  }
} finally {
  await client.end();
}

const ok = results.filter((row) => row.state === 'ok').length;
console.log(
  `\n${apply ? '已提交' : 'dry-run（已回滚）'}：通过 ${ok}／${results.length}`,
);
if (!apply) console.log('确认无误后加 --apply 提交。');
