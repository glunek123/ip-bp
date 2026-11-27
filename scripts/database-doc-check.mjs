#!/usr/bin/env node
/**
 * 数据库结构文档与 schema 的一致性检查。
 *
 * 事实基线是数据库（manifest 由 information_schema 导出），schema.prisma 是代码意图。
 * 两类差异分别处理：
 *   代码有模型、库中无表  → 迁移未执行，失败（运行时会找不到表）
 *   库中有表、代码无模型  → 编外表，警告（当前 15 张，待纳入 schema）
 *
 * 用法：node scripts/database-doc-check.mjs
 * 退出码：0 通过（可能带警告）；1 存在阻断性问题
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(root, 'backend/prisma/schema.prisma');
const manifestPath = join(root, 'docs/design/database/schema-manifest.json');

function schemaTables(source) {
  const out = new Set();
  for (const m of source.matchAll(/^model (\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const map = m[2].match(/@@map\("([^"]+)"\)/);
    out.add(map ? map[1] : m[1]);
  }
  return out;
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`[db-doc] 无法读取 ${manifestPath}: ${err.message}`);
  process.exit(1);
}

const dbTables = new Set(manifest.tables.map((t) => t.table));
const codeTables = schemaTables(readFileSync(schemaPath, 'utf8'));

const missing = [...codeTables].filter((t) => !dbTables.has(t)).sort();
const unmanaged = [...dbTables].filter((t) => !codeTables.has(t)).sort();

console.log(
  `[db-doc] 文档 ${dbTables.size} 表 / ${manifest.totals.fields} 字段 / ` +
    `${manifest.totals.relations} 外键；schema ${codeTables.size} 表`,
);

if (unmanaged.length) {
  console.warn(`[db-doc] 警告：${unmanaged.length} 张表在库中但无模型（编外表），待纳入 schema`);
  for (const t of unmanaged.slice(0, 20)) console.warn(`  - ${t}`);
  if (unmanaged.length > 20) console.warn(`  ... 另有 ${unmanaged.length - 20} 张`);
}

if (missing.length) {
  console.error(`[db-doc] 失败：${missing.length} 张表有模型但库中不存在（迁移未执行？）`);
  for (const t of missing) console.error(`  - ${t}`);
  process.exit(1);
}

console.log('[db-doc] 通过');
