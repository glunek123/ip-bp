#!/usr/bin/env node
/**
 * 只读体检：判断「未指派律师」的案件能否安全递增版本。
 *
 * 背景：案件主表上有一批延迟约束触发器（归档、结案、执行终态）。历史数据若缺少
 * 对应快照，`UPDATE cases SET version = version + 1` 会在提交时抛 23514，接口表现为
 * 500，补指派就会失败。本脚本逐案在事务内更新并立即检查约束，然后回滚，不写入任何
 * 数据，只回答「这个案件现在能不能改」。
 *
 * 用法（在 UAT 或本地库执行，需 DATABASE_URL）：
 *   node backend/scripts/check-case-guards.mjs [--stage=WAITING_ARCHIVE,ARCHIVED] [--limit=200] [--out=report.csv]
 *
 * 默认 dry-run，永远 ROLLBACK。
 */
import { Client } from 'pg';
import { writeFileSync } from 'node:fs';

const args = new Map(
  process.argv
    .slice(2)
    .map((item) => item.replace(/^--/u, ''))
    .map((item) => {
      const index = item.indexOf('=');
      return index === -1 ? [item, 'true'] : [item.slice(0, index), item.slice(index + 1)];
    }),
);
const stages = args.get('stage')?.split(',').filter(Boolean) ?? null;
const limit = Number(args.get('limit') ?? 200);
const outPath = args.get('out');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL 未设置');
  process.exit(2);
}
if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
  console.error('limit 需为 1..5000 的整数');
  process.exit(2);
}

const client = new Client({ connectionString });
await client.connect();
const results = [];
try {
  const { rows } = await client.query(
    `SELECT c.id, c.business_no, c.stage::text AS stage
       FROM cases c
      WHERE NOT EXISTS (
        SELECT 1 FROM case_lawyer_assignments a
         WHERE a.case_id = c.id AND a.ended_at IS NULL)
        AND ($1::text[] IS NULL OR c.stage::text = ANY($1::text[]))
      ORDER BY c.created_at DESC
      LIMIT $2`,
    [stages, limit],
  );
  console.log(`候选案件 ${rows.length} 个（阶段：${stages?.join(',') ?? '全部'}）`);
  for (const row of rows) {
    await client.query('BEGIN');
    let reason = null;
    try {
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query('UPDATE cases SET version = version + 1 WHERE id = $1', [
        row.id,
      ]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      reason = String(error.message ?? error)
        .split('\n')[0]
        .slice(0, 140);
    } finally {
      await client.query('ROLLBACK');
    }
    results.push({ ...row, ok: reason === null, reason });
  }
} finally {
  await client.end();
}

const passed = results.filter((row) => row.ok);
const blocked = results.filter((row) => !row.ok);
const reasons = new Map();
for (const row of blocked) {
  const key = row.reason ?? 'unknown';
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
console.log(`可通过 ${passed.length}／${results.length}`);
for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]))
  console.log(`  受阻 ${count}：${reason}`);
if (passed.length)
  console.log(
    `可补指派样例：${passed
      .slice(0, 5)
      .map((row) => row.business_no)
      .join('、')}`,
  );

if (outPath) {
  const header = 'business_no,stage,case_id,result,reason';
  const lines = results.map((row) =>
    [
      row.business_no,
      row.stage,
      row.id,
      row.ok ? 'OK' : 'BLOCKED',
      `"${(row.reason ?? '').replaceAll('"', '""')}"`,
    ].join(','),
  );
  writeFileSync(outPath, `${[header, ...lines].join('\n')}\n`, 'utf8');
  console.log(`明细已写入 ${outPath}`);
}
