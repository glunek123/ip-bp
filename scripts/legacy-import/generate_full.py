#!/usr/bin/env python3
"""全量重导生成器：旧 case_number 作业务号，客户号沿用旧 id，1:1 还原有值字段。

usage: python scripts/legacy-import/generate_full.py --out-dir .local/legacy/sql --batch 200
"""

import argparse
import json
import os
import uuid

STAGING = '.local/legacy/staging'
DEPTS = '97805e40-96f5-403b-a6b7-e67eed5d075c'
ACTOR = '001d63d6-d7e8-4fa2-8872-039caf269942'

STAGE_FROM_PROGRESS = {
    '191': 'PENDING_MATCH', '201': 'WAITING_COMPLAINT', '211': 'WAITING_COMPLAINT_CONFIRMATION',
    '221': 'WAITING_COMPLAINT_STAMP', '231': 'WAITING_FILING',
    '241': 'WAITING_FORMAL_ACCEPTANCE', '251': 'WAITING_FORMAL_ACCEPTANCE',
    '261': 'WAITING_HEARING', '271': 'WAITING_JUDGMENT',
    '281': 'WAITING_EXECUTION_FILING', '291': 'EXECUTING',
    '301': 'WAITING_ARCHIVE', '999': 'ARCHIVED',
}
OUTCOME = {
    '1': 'LINK_REMOVED', '2': 'NO_INFRINGEMENT', '3': 'NO_EVIDENCE',
    '4': 'NOT_SHIPPED_REFUND_ONLY', '5': 'RECEIVED_NO_RETURN',
    '6': 'RECEIVED_RETURN_REFUND', '7': 'NOT_RECEIVED_REFUND_ONLY',
    '8': 'CASE_VOID', '9': 'MEDIATION', '10': 'JUDGMENT_PERFORMED',
    '11': 'EXECUTION_TERMINATED', '12': 'EXECUTION_RECOVERED', '20': 'NOTARY_ONLY',
}
ARCHIVE_TYPE = {
    '1': 'VOIDED', '2': 'VOIDED', '3': 'VOIDED', '4': 'SETTLEMENT', '5': 'SETTLEMENT',
    '6': 'SETTLEMENT', '7': 'SETTLEMENT', '8': 'VOIDED', '9': 'MEDIATION',
    '10': 'JUDGMENT_PERFORMED', '11': 'EXECUTION_CLOSED', '12': 'EXECUTION_COLLECTED',
    '20': 'VOIDED',
}
PLATFORM = {
    '1': 'TAOBAO', '2': 'TMALL', '3': 'ALIBABA_1688', '4': 'PINDUODUO', '5': 'JD',
    '6': 'DOUYIN', '7': 'KUAISHOU', '8': 'XIAOHONGSHU', '9': 'OTHER', '10': 'XIANYU',
    '11': 'OTHER', '12': 'MEITUAN', '13': 'DIANPING', '14': 'MAP', '99': 'OTHER',
}


def q(v):
    if v is None or v == 'NULL' or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def day(v):
    if not v or v == 'NULL':
        return None
    return str(v)[:10]


def money(v):
    if v in (None, 'NULL', ''):
        return None
    try:
        return f'{float(v):.2f}'
    except ValueError:
        return None


def load_maps():
    col = {'C': {}, 'R': {}, 'F': {}, 'L': {}}
    for line in open('.local/legacy/maps-all.txt', encoding='utf-8'):
        parts = line.rstrip('\n').split('|')
        if len(parts) < 4:
            continue
        kind, rid, bid, name = parts[0], parts[1], parts[2], parts[3]
        col.setdefault(kind, {})
        col[kind].setdefault(name, (rid, bid))
    return col


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-dir', default='.local/legacy/sql')
    ap.add_argument('--batch', type=int, default=200)
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    maps = load_maps()
    cases = [json.loads(l) for l in open(f'{STAGING}/case.jsonl', encoding='utf-8')]
    mains = {r['id']: r.get('main_name') for r in map(json.loads, open(f'{STAGING}/customer_main.jsonl', encoding='utf-8'))}

    todo = [c for c in cases if c.get('case_progress') in STAGE_FROM_PROGRESS]
    if args.only:
        keep = set(args.only.split(','))
        todo = [c for c in todo if c['id'] in keep]

    stats = {'cases': 0, 'skip_no_customer': 0, 'skip_no_holder': 0, 'miss_court': 0, 'files': 0}
    for start in range(0, len(todo), args.batch):
        chunk = todo[start:start + args.batch]
        out = ['BEGIN;', 'SET LOCAL session_replication_role = replica;']
        for c in chunk:
            cust_no = str(int(c['customer_id'])).zfill(3) if c.get('customer_id') else None
            cust = None
            if cust_no:
                for name, (rid, bid) in maps['C'].items():
                    if bid == cust_no:
                        cust = rid
                        break
            holder_name = mains.get(c.get('main_id')) or '未知权利主体'
            holder = maps['R'].get(holder_name, (None, None))[0]
            if not cust:
                stats['skip_no_customer'] += 1
                continue
            if not holder:
                stats['skip_no_holder'] += 1
                continue

            court_name = c.get('case_court_name')
            court = maps['F'].get(court_name, (None, None))[0] if court_name else None
            if court_name and not court:
                stats['miss_court'] += 1

            business_no = c.get('case_number') or f"OLD{c['id']}"
            stage = STAGE_FROM_PROGRESS[str(c.get('case_progress'))]
            accepted = day(c.get('official_register_date'))
            judged = day(c.get('judgement_date'))
            judged_eff = judged or accepted or day(c.get('created_at'))
            # 只有旧库确有执行日期/案号才建执行立案；结案但无执行信息时用结案日兜底
            executed = day(c.get('execution_date')) or (judged if c.get('execution_number') else None)
            finished = day(c.get('completed_date'))
            archived = day(c.get('case_archive_date'))
            # 待归档/已归档必须有结案；已归档必须有归档记录（旧库日期常缺，用邻近节点兜底）
            if stage in ('WAITING_ARCHIVE', 'ARCHIVED'):
                finished = finished or archived or judged or day(c.get('created_at'))
            if stage == 'ARCHIVED':
                archived = archived or finished
            if finished and not executed:
                executed = finished
            has_closure = stage in ('WAITING_ARCHIVE', 'ARCHIVED') and bool(finished)
            has_archive = stage == 'ARCHIVED' and bool(archived)
            case_version = (7 if has_archive else 6 if has_closure else 5 if finished
                            else 4 if executed else 3 if (judge_amt and judged_eff)
                            else 2 if accepted else 1)
            court_no = c.get('case_court_number') or (f"待补充-{c['id']}" if accepted else None)
            judge_amt = money(c.get('judgement_amount'))
            close_amt = money(c.get('completed_amount'))
            paid_fee = money(c.get('cost_legal_paid'))
            raw_type = str(c.get('case_archive_type') or '').strip()

            ids = {k: str(uuid.uuid4()) for k in (
                'case', 'entry', 'entryAudit', 'round', 'defendant', 'acc', 'accAudit',
                'judg', 'judgAudit', 'filing', 'filingAudit', 'finish', 'finishAudit',
                'closure', 'closureVersion', 'closureAudit', 'archive', 'archiveVersion', 'archiveAudit')}

            out.append(
                "INSERT INTO cases (id, business_no, department_id, customer_id, rights_holder_id, "
                "responsible_user_id, stage, version, court_case_no, source_lead_ordinal, responsibility_epoch, created_at) "
                f"VALUES ('{ids['case']}', {q(business_no)}, '{DEPTS}', '{cust}', '{holder}', '{ACTOR}', "
                f"'{stage}', {case_version}, {q(court_no)}, NULL, 0, {q(c.get('created_at'))});")

            out.append(
                "INSERT INTO case_external_entries (id, case_id, department_id, entry_kind, initial_stage, "
                "stage_reached_on, source, reason, recorded_by_user_id, audit_event_id, known) VALUES "
                f"('{ids['entry']}', '{ids['case']}', '{DEPTS}', 'HISTORICAL_BACKFILL', '{stage}', "
                f"{q(day(c.get('created_at')) or accepted or archived)}, '旧系统 (NocoBase) 数据迁移', '历史数据回填', "
                f"'{ACTOR}', '{ids['entryAudit']}', "
                f"""'{json.dumps({"courtId": court, "courtCaseNo": court_no, "acceptedOn": accepted,
                                  "caseType": "CIVIL", "platform": PLATFORM.get(str(c.get('clue_platform')), 'OTHER'),
                                  "shopName": c.get('clue_account'), "shopExternalId": None,
                                  "infringementTypes": ["TRADEMARK"], "legacyId": c['id'],
                                  "legacyCaseNumber": c.get('case_number')}, ensure_ascii=False)}');""")

            out.append(
                "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                f"resource_id, action, details) VALUES ('{ids['entryAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', "
                f"'case', '{ids['case']}', 'case.external-entry.created', "
                f"""'{{"entryKind": "HISTORICAL_BACKFILL", "legacyId": "{c['id']}"}}');""")

            defendant = c.get('clue_entity') or c.get('disclosure_name')
            if defendant:
                out.append(
                    "INSERT INTO case_defendants (id, case_id, department_id, kind, name) VALUES "
                    f"('{ids['defendant']}', '{ids['case']}', '{DEPTS}', 'PERSON', {q(defendant + '经营主体')});")

            out.append(
                f"INSERT INTO case_trial_rounds (id, case_id, department_id, sequence) VALUES "
                f"('{ids['round']}', '{ids['case']}', '{DEPTS}', 1);")

            if accepted:
                out.append(
                    "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                    f"resource_id, action, details) VALUES ('{ids['accAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', 'case', "
                    f"'{ids['case']}', 'case.acceptance.registered', "
                    f"""'{json.dumps({"toVersion": 2, "acceptedAt": accepted, "courtCaseNo": court_no, "fromVersion": 1, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
                out.append(
                    "INSERT INTO case_acceptances (id, department_id, case_id, accepted_at, court_case_no, "
                    f"recorded_by_user_id, audit_event_id, trial_round_id) VALUES ('{ids['acc']}', '{DEPTS}', "
                    f"'{ids['case']}', {q(accepted)}, {q(court_no)}, '{ACTOR}', '{ids['accAudit']}', '{ids['round']}');")

            if judge_amt and judged_eff:
                out.append(
                    "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                    f"resource_id, action, details) VALUES ('{ids['judgAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', 'case', "
                    f"'{ids['case']}', 'case.judgment.registered', "
                    f"""'{json.dumps({"toVersion": 3, "judgmentId": ids['judg'], "fromVersion": 2, "judgmentAmount": judge_amt, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
                out.append(
                    "INSERT INTO case_judgment_facts (id, department_id, case_id, kind, judgment_received_at, "
                    "judgment_amount_state, judgment_amount, paid_litigation_fee_state, paid_litigation_fee, "
                    f"recorded_by_user_id, from_version, to_version, audit_event_id, trial_round_id) VALUES "
                    f"('{ids['judg']}', '{DEPTS}', '{ids['case']}', 'REGISTER', {q(judged_eff)}, 'KNOWN', {judge_amt}, "
                    f"{q('KNOWN' if paid_fee else 'PENDING')}, {paid_fee or 'NULL'}, '{ACTOR}', 2, 3, "
                    f"'{ids['judgAudit']}', '{ids['round']}');")

            if executed:
                out.append(
                    "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                    f"resource_id, action, details) VALUES ('{ids['filingAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', 'case', "
                    f"'{ids['case']}', 'case.execution.filing.submitted', "
                    f"""'{json.dumps({"filingId": ids['filing'], "toVersion": 4, "fromVersion": 3, "submittedAt": executed, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
                out.append(
                    "INSERT INTO case_execution_filings (id, case_id, department_id, from_version, to_version, "
                    f"submitted_at, submitted_by_user_id, audit_event_id) VALUES ('{ids['filing']}', '{ids['case']}', "
                    f"'{DEPTS}', 3, 4, {q(executed)}, '{ACTOR}', '{ids['filingAudit']}');")

            if finished:
                out.append(
                    "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                    f"resource_id, action, details) VALUES ('{ids['finishAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', 'case', "
                    f"'{ids['case']}', 'case.execution.finished', "
                    f"""'{json.dumps({"reason": c.get('execution_number') or '历史迁移：执行结束', "filingId": ids['filing'], "finishId": ids['finish'], "toVersion": 5, "fromVersion": 4, "finishedAt": finished, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
                out.append(
                    "INSERT INTO case_execution_finishes (id, case_id, department_id, filing_id, reason, from_version, "
                    f"to_version, finished_at, recorded_by_user_id, audit_event_id) VALUES ('{ids['finish']}', "
                    f"'{ids['case']}', '{DEPTS}', '{ids['filing']}', {q(c.get('execution_number') or '历史迁移：执行结束')}, "
                    f"4, 5, {q(finished)}, '{ACTOR}', '{ids['finishAudit']}');")

            # 只有走到待归档/已归档才建结案与归档，避免判决中的案件带归档记录
            if stage in ('WAITING_ARCHIVE', 'ARCHIVED') and finished:
                out.append(
                    "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                    f"resource_id, action, details) VALUES ('{ids['closureAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', 'case', "
                    f"'{ids['case']}', 'case.closure.recorded', "
                    f"""'{json.dumps({"closeAt": finished, "closeAmt": close_amt, "finishId": ids['finish'], "closureId": ids['closure'], "closureVersionId": ids['closureVersion'], "toVersion": 6, "fromVersion": 5, "closeOutcome": OUTCOME.get(raw_type), "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
                out.append(
                    f"INSERT INTO case_closures (id, case_id, department_id, finish_id, current_version_id) VALUES "
                    f"('{ids['closure']}', '{ids['case']}', '{DEPTS}', '{ids['finish']}', '{ids['closureVersion']}');")
                out.append(
                    "INSERT INTO case_closure_versions (id, closure_id, case_id, department_id, finish_id, kind, "
                    "from_version, to_version, close_at, close_amount_state, close_amt, close_outcome, "
                    f"recorded_by_user_id, audit_event_id) VALUES ('{ids['closureVersion']}', '{ids['closure']}', "
                    f"'{ids['case']}', '{DEPTS}', '{ids['finish']}', 'REGISTER', 5, 6, {q(finished)}, "
                    f"{q('KNOWN' if close_amt else 'PENDING')}, {close_amt or 'NULL'}, {q(OUTCOME.get(raw_type))}, "
                    f"'{ACTOR}', '{ids['closureAudit']}');")

                if archived and stage == 'ARCHIVED':
                    out.append(
                        "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, resource_type, "
                        f"resource_id, action, details) VALUES ('{ids['archiveAudit']}', '{DEPTS}', '{ACTOR}', '{ACTOR}', 'case', "
                        f"'{ids['case']}', 'case.archived', "
                        f"""'{json.dumps({"archiveAt": archived, "archiveId": ids['archive'], "closureId": ids['closure'], "toVersion": 7, "fromVersion": 6, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
                    out.append(
                        "INSERT INTO case_archives (id, case_id, department_id, closure_id, closure_version_id, "
                        f"current_version_id) VALUES ('{ids['archive']}', '{ids['case']}', '{DEPTS}', "
                        f"'{ids['closure']}', '{ids['closureVersion']}', '{ids['archiveVersion']}');")
                    out.append(
                        "INSERT INTO case_archive_versions (id, archive_id, case_id, department_id, closure_version_id, "
                        "kind, from_version, to_version, archive_at, archive_type, archive_reason, recorded_by_user_id, "
                        f"audit_event_id) VALUES ('{ids['archiveVersion']}', '{ids['archive']}', '{ids['case']}', "
                        f"'{DEPTS}', '{ids['closureVersion']}', 'ARCHIVE', 6, 7, {q(archived)}, "
                        f"{q(ARCHIVE_TYPE.get(raw_type, 'VOIDED'))}, {q(c.get('case_archive_notes') or '历史迁移归档')}, "
                        f"'{ACTOR}', '{ids['archiveAudit']}');")

            fees = [
                ('公证费', '支出', money(c.get('cost_notarization')), accepted or executed, '旧系统公证费'),
                ('披露费', '支出', money(c.get('cost_disclosure')), accepted or executed, '旧系统披露费'),
                ('样品费', '支出', money(c.get('cost_shopping')), accepted or executed, '旧系统购物费'),
                ('诉讼费', '支出', money(c.get('cost_legal_prepay')), accepted or executed, '旧系统预缴诉讼费'),
                ('诉讼费', '支出', money(c.get('cost_legal_paid')), accepted or executed, '旧系统实缴诉讼费'),
                ('诉讼退费', '收入', money(c.get('cost_legal_refund')), archived, '旧系统诉讼费退费'),
            ]
            fallback_date = day(c.get('created_at')) or accepted or archived or '2020-01-01'
            for idx, (ftype, direction, amount, fdate, note) in enumerate(fees):
                if not amount:
                    continue
                status = '退原告' if ftype == '诉讼退费' else '已支付'
                out.append(
                    "INSERT INTO fee_records (id, case_id, department_id, type, direction, status, amount, fee_date, "
                    "source, source_kind, source_id, note) VALUES "
                    f"('{uuid.uuid4()}', '{ids['case']}', '{DEPTS}', {q(ftype)}, {q(direction)}, {q(status)}, {amount}, "
                    f"{q(fdate or archived or fallback_date)}, 'auto', 'NOCOBASE_BACKFILL', {q('nocobase:' + c['id'] + '-' + str(idx))}, "
                    f"{q(note)});")

            out.append(
                f"INSERT INTO business_number_aliases (entity_type, entity_id, old_number) VALUES "
                f"('CASE', '{ids['case']}', {q('nocobase:' + c['id'])});")
            stats['cases'] += 1

        out.append('COMMIT;')
        path = os.path.join(args.out_dir, f'batch-{start // args.batch:03d}.sql')
        open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
        stats['files'] += 1

    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
