#!/usr/bin/env python3
"""抽取 NocoBase dump 的业务表到 jsonl（只读，不连数据库）。

用法：
    python scripts/legacy-import/extract.py dump.sql --out .local/legacy/staging
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

TABLES = {
    'ip_customer': 'customer',
    'ip_customer_main': 'customer_main',
    'ip_case': 'case',
    'ip_lawyer': 'lawyer',
    'ip_court': 'court',
    'ip_cost_case': 'cost_case',
    'ip_payment_case': 'payment_case',
}

# 旧库阶段字典（从 ip_fields 元数据解出，2026-11-18）
STAGE_DICT = {
    '101': 'PENDING_PUSH', '111': 'WAITING_LEAD_REVIEW', '121': 'WAITING_LEAD_CONFIRM',
    '131': 'WAITING_EVIDENCE', '141': 'WAITING_UNBOX', '151': 'WAITING_UNBOX_REVIEW',
    '161': 'WAITING_UNBOX_CONFIRM', '171': 'WAITING_ISSUANCE', '181': 'WAITING_RETURN',
    '191': 'PENDING_MATCH', '201': 'WAITING_COMPLAINT', '211': 'WAITING_COMPLAINT_CONFIRMATION',
    '221': 'WAITING_COMPLAINT_STAMP', '231': 'WAITING_FILING', '241': 'WAITING_FORMAL_ACCEPTANCE',
    '251': 'WAITING_FORMAL_ACCEPTANCE', '261': 'WAITING_HEARING', '271': 'WAITING_JUDGMENT',
    '281': 'WAITING_EXECUTION_FILING', '291': 'EXECUTING', '301': 'WAITING_ARCHIVE',
    '999': 'ARCHIVED',
}


def split_tuples(body: str):
    """按顶层逗号切分 VALUES 元组，正确处理引号与转义。"""
    rows, buf, in_str, esc, depth = [], [], False, False, 0
    for ch in body:
        if in_str:
            buf.append(ch)
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == "'":
                in_str = False
            continue
        if ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == '(':
            depth += 1
            if depth == 1:
                buf = []
            else:
                buf.append(ch)
        elif ch == ')':
            depth -= 1
            if depth == 0:
                rows.append(''.join(buf))
            else:
                buf.append(ch)
        elif depth > 0:
            buf.append(ch)
    return rows


def split_fields(row: str):
    fields, buf, in_str, esc = [], [], False, False
    for ch in row:
        if in_str:
            if esc:
                buf.append(ch)
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == "'":
                in_str = False
            else:
                buf.append(ch)
            continue
        if ch == "'":
            in_str = True
        elif ch == ',':
            fields.append(''.join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    fields.append(''.join(buf).strip())
    return fields


def parse(sql: str, table: str):
    m = re.search(rf"CREATE TABLE `{table}` \((.*?)\n\) ENGINE", sql, re.S)
    if not m:
        return [], []
    cols = re.findall(r"^\s+`([^`]+)`", m.group(1), re.M)
    rows = []
    for ins in re.finditer(rf"INSERT INTO `{table}` VALUES (.*?);\n", sql, re.S):
        for raw in split_tuples(ins.group(1)):
            vals = split_fields(raw)
            vals += ['NULL'] * (len(cols) - len(vals))
            rows.append(dict(zip(cols, vals)))
    return cols, rows


def clean(v: str):
    if v == 'NULL' or v == '':
        return None
    return v


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('dump')
    ap.add_argument('--out', default='.local/legacy/staging')
    args = ap.parse_args()

    sql = open(args.dump, encoding='utf-8', errors='replace').read()
    os.makedirs(args.out, exist_ok=True)
    summary = {}

    for table, name in TABLES.items():
        cols, rows = parse(sql, table)
        if not cols:
            summary[table] = {'rows': 0, 'note': 'table not found'}
            continue
        filled = Counter()
        for row in rows:
            for k, v in row.items():
                if clean(v) is not None:
                    filled[k] += 1
        with open(os.path.join(args.out, f'{name}.jsonl'), 'w', encoding='utf-8') as fh:
            for row in rows:
                fh.write(json.dumps({k: clean(v) for k, v in row.items()}, ensure_ascii=False) + '\n')
        summary[table] = {
            'rows': len(rows),
            'columns': len(cols),
            'columns_with_value': sum(1 for k in cols if filled[k] > 0),
            'empty_columns': [k for k in cols if filled[k] == 0],
        }

    if 'case' in [TABLES[t] for t in TABLES if t == 'ip_case']:
        cols, rows = parse(sql, 'ip_case')
        if 'case_progress' in cols:
            dist = Counter(clean(r['case_progress']) for r in rows)
            summary['ip_case']['stage_distribution'] = {
                STAGE_DICT.get(k or '', k or 'NULL'): v for k, v in dist.most_common()
            }

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
