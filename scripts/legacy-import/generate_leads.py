#!/usr/bin/env python3
"""旧库线索 / 公证中数据导入生成器。

- 101/111/121 → leads（WAITING_PUSH / WAITING_REVIEW / WAITING_EVIDENCE_DECISION）
- 131–181 → leads(TRANSFERRED_TO_NOTARY) + notary_matters
- 线索号沿用旧 case_number；公证号沿用旧 notarization_number，缺失时按导入日编号
"""

import argparse
import json
import os
import uuid

STAGING = '.local/legacy/staging'
DEPT = '97805e40-96f5-403b-a6b7-e67eed5d075c'
ACTOR = '001d63d6-d7e8-4fa2-8872-039caf269942'
NOTARY_OFFICE = 'bd17a0b1-f8d1-4c4a-a339-72255ae60587'

LEAD_STATUS = {
    '101': 'WAITING_PUSH',
    '111': 'WAITING_REVIEW',
    '121': 'WAITING_EVIDENCE_DECISION',
    '131': 'TRANSFERRED_TO_NOTARY',
    '141': 'TRANSFERRED_TO_NOTARY',
    '151': 'TRANSFERRED_TO_NOTARY',
    '161': 'TRANSFERRED_TO_NOTARY',
    '171': 'TRANSFERRED_TO_NOTARY',
    '181': 'TRANSFERRED_TO_NOTARY',
}
MATTER_STAGE = {
    '131': 'PENDING_EVIDENCE',
    '141': 'WAITING_UNBOX',
    '151': 'UNBOX_REVIEW',
    '161': 'ISSUANCE_DECISION',
    '171': 'WAITING_CERTIFICATE',
    '181': 'WAITING_RETURN',
}
PLATFORM = {
    '1': 'TAOBAO', '2': 'TMALL', '3': 'ALIBABA_1688', '4': 'PINDUODUO', '5': 'JD',
    '6': 'DOUYIN', '7': 'KUAISHOU', '8': 'XIAOHONGSHU', '9': 'OTHER', '10': 'XIANYU',
    '11': 'OTHER', '12': 'MEITUAN', '13': 'DIANPING', '14': 'MAP', '99': 'OTHER',
}
CASE_TYPE = {'1': 'CIVIL', '2': 'CRIMINAL', '3': 'ADMINISTRATIVE', '4': 'NOTARIZATION'}
INFRINGEMENT = {
    '1': 'TRADEMARK', '2': 'AUDIOVISUAL_COPYRIGHT', '3': 'SOFTWARE_COPYRIGHT',
    '4': 'ART_COPYRIGHT', '5': 'TEXT_COPYRIGHT', '6': 'INVENTION_PATENT',
    '7': 'DESIGN_PATENT', '8': 'UTILITY_MODEL_PATENT', '9': 'UNFAIR_COMPETITION',
    '10': 'NETWORK_DISSEMINATION', '11': 'PORTRAIT_RIGHT', '99': 'OTHER',
}


def q(v):
    if v is None or v == 'NULL' or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def day(v):
    if not v or v == 'NULL':
        return None
    return str(v)[:10]


def code_of(raw):
    if not raw or raw == 'NULL':
        return None
    text = str(raw).replace('[', ' ').replace(']', ' ').replace('"', ' ')
    for part in text.split(','):
        code = part.strip()
        if code:
            return code
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-dir', default='.local/legacy/sql-leads')
    ap.add_argument('--batch', type=int, default=100)
    ap.add_argument('--date', default='20261126')
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    cust_by_bid = {}
    for line in open('.local/legacy/maps-c.txt', encoding='utf-8'):
        p = line.strip().split('|')
        if len(p) >= 4:
            cust_by_bid[p[2]] = p[1]
    holder_by_name = {}
    for line in open('.local/legacy/maps-r.txt', encoding='utf-8'):
        p = line.strip().split('|')
        if len(p) >= 4:
            holder_by_name[p[3]] = p[1]
    mains = {
        r['id']: r.get('main_name')
        for r in map(json.loads, open(f'{STAGING}/customer_main.jsonl', encoding='utf-8'))
    }

    rows = [json.loads(l) for l in open(f'{STAGING}/case.jsonl', encoding='utf-8')]
    todo = [r for r in rows if str(r.get('case_progress')) in LEAD_STATUS]

    stats = {'leads': 0, 'matters': 0, 'skip_customer': 0, 'skip_holder': 0, 'files': 0}
    seq = 0
    for start in range(0, len(todo), args.batch):
        chunk = todo[start:start + args.batch]
        out = ['BEGIN;', 'SET LOCAL session_replication_role = replica;']
        for r in chunk:
            progress = str(r.get('case_progress'))
            bid = str(int(r['customer_id'])).zfill(3) if r.get('customer_id') else None
            cust = cust_by_bid.get(bid) if bid else None
            if not cust:
                stats['skip_customer'] += 1
                continue
            holder_name = mains.get(r.get('main_id')) or '未知权利主体'
            holder = holder_by_name.get(holder_name)
            if not holder:
                stats['skip_holder'] += 1
                continue

            lead_id = str(uuid.uuid4())
            business_no = r.get('case_number') or f"L{r['id']}"
            status = LEAD_STATUS[progress]
            platform = PLATFORM.get(str(r.get('clue_platform')), 'OTHER')
            # 美团/点评/地图属于线下场景，来源必须是 OFFLINE
            source = 'OFFLINE' if platform in ('MEITUAN', 'DIANPING', 'MAP') else 'ONLINE'
            found = day(r.get('clue_discovery_date')) or day(r.get('created_at')) or f'{args.date[:4]}-01-01'
            shop = r.get('clue_entity') or r.get('clue_account') or '未登记店铺'
            created = r.get('created_at') or f'{found}T00:00:00+08:00'

            out.append(
                "INSERT INTO leads (id, business_no, department_id, customer_id, rights_holder_id, "
                "responsible_user_id, status, case_type, source, platform, found_at, shop_name, "
                "need_disclose, creation_channel, external_source_ref, version, created_at, updated_at) VALUES "
                f"('{lead_id}', {q(business_no)}, '{DEPT}', '{cust}', '{holder}', '{ACTOR}', "
                f"'{status}', {q(CASE_TYPE.get(code_of(r.get('case_type')), 'CIVIL'))}, '{source}', "
                f"'{platform}', {q(found)}, {q(shop[:200])}, false, 'HISTORICAL', {q('nocobase:' + r['id'])}, 1, "
                f"{q(created)}, {q(created)});")
            stats['leads'] += 1

            if progress in MATTER_STAGE:
                seq += 1
                matter_no = (r.get('notarization_number') or '').strip()
                if matter_no in ('', 'None', 'NULL'):
                    matter_no = f'NT-{args.date}-{seq:03d}'
                matter_id = str(uuid.uuid4())
                snapshot = json.dumps({
                    'source': 'NOCOBASE',
                    'legacyId': r['id'],
                    'legacyCaseNumber': r.get('case_number'),
                    'notarizationNumber': r.get('notarization_number'),
                }, ensure_ascii=False)
                out.append(
                    "INSERT INTO notary_matters (id, business_no, department_id, source_type, source_lead_id, "
                    "customer_id, rights_holder_id, responsible_user_id, notary_office_id, stage, version, "
                    "batch_purpose, source_snapshot, created_by_user_id, from_lead_version, to_lead_version, "
                    "created_at) VALUES "
                    f"('{matter_id}', {q(matter_no[:40])}, '{DEPT}', 'LEAD', '{lead_id}', '{cust}', '{holder}', "
                    f"'{ACTOR}', '{NOTARY_OFFICE}', '{MATTER_STAGE[progress]}', 1, "
                    f"{q((r.get('notarization_type') or '历史迁移')[:200])}, {q(snapshot)}, '{ACTOR}', 1, 2, "
                    f"{q(created)});")
                stats['matters'] += 1

        out.append('COMMIT;')
        open(os.path.join(args.out_dir, f'leads-{start // args.batch:03d}.sql'), 'w', encoding='utf-8').write(
            '\n'.join(out) + '\n')
        stats['files'] += 1

    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
