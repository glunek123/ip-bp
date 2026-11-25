#!/usr/bin/env python3
"""按「5 事实压缩」模型为指定旧案件生成导入 SQL。

用法：python scripts/legacy-import/generate.py --ids 634,631,421 --out .local/legacy/import.sql
"""

import argparse
import json
import uuid
from datetime import datetime

STAGING = '.local/legacy/staging'
MAPS = '.local/legacy/template/maps.json'
DEPT = '97805e40-96f5-403b-a6b7-e67eed5d075c'
ACTOR = '001d63d6-d7e8-4fa2-8872-039caf269942'

OUTCOME = {
    '1': 'LINK_REMOVED', '2': 'NO_INFRINGEMENT', '3': 'NO_EVIDENCE',
    '4': 'NOT_SHIPPED_REFUND_ONLY', '5': 'RECEIVED_NO_RETURN',
    '6': 'RECEIVED_RETURN_REFUND', '7': 'NOT_RECEIVED_REFUND_ONLY',
    '8': 'CASE_VOID', '9': 'MEDIATION', '10': 'JUDGMENT_PERFORMED',
    '11': 'EXECUTION_TERMINATED', '12': 'EXECUTION_RECOVERED', '20': 'NOTARY_ONLY',
}


ARCHIVE_TYPE = {
    '1': 'VOIDED', '2': 'VOIDED', '3': 'VOIDED', '4': 'SETTLEMENT',
    '5': 'SETTLEMENT', '6': 'SETTLEMENT', '7': 'SETTLEMENT', '8': 'VOIDED',
    '9': 'MEDIATION', '10': 'JUDGMENT_PERFORMED', '11': 'EXECUTION_CLOSED',
    '12': 'EXECUTION_COLLECTED', '20': 'VOIDED',
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
    return f'{float(v):.2f}'


def load(name):
    return {r['id']: r for r in map(json.loads, open(f'{STAGING}/{name}.jsonl', encoding='utf-8'))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ids', required=True)
    ap.add_argument('--out', default='.local/legacy/import.sql')
    ap.add_argument('--start-seq', type=int, default=1)
    ap.add_argument('--business-date', default='20261125')
    args = ap.parse_args()

    cases = load('case')
    maps = json.load(open(MAPS, encoding='utf-8'))
    customer = maps['customer'][0]
    holder = maps['rightsHolder'][0]
    court = maps['court'][0]
    business_prefix = f"{customer['business_id']}{args.business_date}"

    out = ['BEGIN;', 'SET LOCAL session_replication_role = replica;']
    report = []
    seq = args.start_seq

    for raw_id in args.ids.split(','):
        raw_id = raw_id.strip()
        c = cases[raw_id]
        business_no = f'{business_prefix}{seq:03d}'
        seq += 1

        ids = {k: str(uuid.uuid4()) for k in (
            'case', 'entry', 'entryAudit', 'round', 'acc', 'accAudit', 'judg', 'judgAudit',
            'filing', 'filingAudit', 'finish', 'finishAudit',
            'closure', 'closureVersion', 'closureAudit',
            'archive', 'archiveVersion', 'archiveAudit')}

        accepted = day(c.get('official_register_date'))
        judged = day(c.get('judgement_date'))
        executed = day(c.get('execution_date')) or judged
        finished = day(c.get('completed_date')) or judged
        archived = day(c.get('case_archive_date')) or finished
        close_amt = money(c.get('completed_amount'))
        judge_amt = money(c.get('judgement_amount'))
        paid_fee = money(c.get('cost_legal_paid'))
        court_no = c.get('case_court_number')
        exec_no = c.get('execution_number')
        raw_type = str(c.get('case_archive_type') or '').strip()
        outcome = OUTCOME.get(raw_type)
        archive_type = ARCHIVE_TYPE.get(raw_type, 'VOIDED')

        # case
        out.append(
            'INSERT INTO cases (id, business_no, department_id, customer_id, rights_holder_id, '
            'responsible_user_id, stage, version, court_case_no, source_lead_ordinal, '
            f"responsibility_epoch, created_at) VALUES ('{ids['case']}', {q(business_no)}, "
            f"'{DEPT}', '{customer['id']}', '{holder['id']}', '{ACTOR}', 'ARCHIVED', 7, "
            f"{q(court_no)}, NULL, 0, {q(c.get('created_at'))});")

        # 来源：历史回填入口（normalSource 要求完整公证链，旧库无开箱/出证过程）
        known = {
            'courtId': court['id'] if court_no else None,
            'courtCaseNo': court_no,
            'acceptedOn': accepted,
            'secondInstanceAcceptedOn': None,
            'caseType': 'CIVIL',
            'platform': 'PINDUODUO' if str(c.get('clue_platform')) == '4' else 'OTHER',
            'shopName': c.get('clue_account') or None,
            'shopExternalId': None,
            'infringementTypes': ['TRADEMARK'],
        }
        stage_reached = day(c.get('created_at')) or accepted or archived
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['entryAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.external-entry.created', "
            f"'{{\"entryKind\": \"HISTORICAL_BACKFILL\", \"initialStage\": \"ARCHIVED\"}}');")
        out.append(
            "INSERT INTO case_external_entries (id, case_id, department_id, entry_kind, initial_stage, "
            "stage_reached_on, source, reason, recorded_by_user_id, audit_event_id, known) VALUES "
            f"('{ids['entry']}', '{ids['case']}', '{DEPT}', 'HISTORICAL_BACKFILL', 'ARCHIVED', "
            f"{q(stage_reached)}, '旧系统 (NocoBase) 数据迁移', '历史数据回填', '{ACTOR}', "
            f"'{ids['entryAudit']}', '{json.dumps(known, ensure_ascii=False)}');")

        out.append(
            f"INSERT INTO case_trial_rounds (id, case_id, department_id, sequence) "
            f"VALUES ('{ids['round']}', '{ids['case']}', '{DEPT}', 1);")

        # 受理 1→2
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['accAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.acceptance.registered', "
            f"""'{json.dumps({"toVersion": 2, "acceptedAt": accepted, "courtCaseNo": court_no, "fromVersion": 1, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
        out.append(
            "INSERT INTO case_acceptances (id, department_id, case_id, accepted_at, court_case_no, "
            f"recorded_by_user_id, audit_event_id, trial_round_id) VALUES ('{ids['acc']}', '{DEPT}', "
            f"'{ids['case']}', {q(accepted)}, {q(court_no)}, '{ACTOR}', '{ids['accAudit']}', '{ids['round']}');")

        # 判决 2→3
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['judgAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.judgment.registered', "
            f"""'{json.dumps({"toVersion": 3, "judgmentId": ids['judg'], "fromVersion": 2, "judgmentAmount": judge_amt, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
        out.append(
            "INSERT INTO case_judgment_facts (id, department_id, case_id, kind, judgment_received_at, "
            "judgment_amount_state, judgment_amount, paid_litigation_fee_state, paid_litigation_fee, "
            f"recorded_by_user_id, from_version, to_version, audit_event_id, trial_round_id) VALUES "
            f"('{ids['judg']}', '{DEPT}', '{ids['case']}', 'REGISTER', {q(judged)}, "
            f"'KNOWN', {judge_amt or 'NULL'}, 'KNOWN', {paid_fee or 'NULL'}, '{ACTOR}', 2, 3, "
            f"'{ids['judgAudit']}', '{ids['round']}');")

        # 执行立案 3→4
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['filingAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.execution.filing.submitted', "
            f"""'{json.dumps({"filingId": ids['filing'], "toVersion": 4, "fromVersion": 3, "submittedAt": executed, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
        out.append(
            "INSERT INTO case_execution_filings (id, case_id, department_id, from_version, to_version, "
            f"submitted_at, submitted_by_user_id, audit_event_id) VALUES ('{ids['filing']}', "
            f"'{ids['case']}', '{DEPT}', 3, 4, {q(executed)}, '{ACTOR}', '{ids['filingAudit']}');")

        # 执行结束 4→5
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['finishAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.execution.finished', "
            f"""'{json.dumps({"reason": "历史迁移：执行结束", "filingId": ids['filing'], "finishId": ids['finish'], "toVersion": 5, "fromVersion": 4, "finishedAt": finished, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
        out.append(
            "INSERT INTO case_execution_finishes (id, case_id, department_id, filing_id, reason, "
            f"from_version, to_version, finished_at, recorded_by_user_id, audit_event_id) VALUES "
            f"('{ids['finish']}', '{ids['case']}', '{DEPT}', '{ids['filing']}', "
            f"'历史迁移：执行结束', 4, 5, {q(finished)}, '{ACTOR}', '{ids['finishAudit']}');")

        # 结案 5→6
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['closureAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.closure.recorded', "
            f"""'{json.dumps({"closeAt": finished, "closeAmt": close_amt, "finishId": ids['finish'], "closureId": ids['closure'], "closureVersionId": ids['closureVersion'], "toVersion": 6, "fromVersion": 5, "closeOutcome": outcome, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
        out.append(
            f"INSERT INTO case_closures (id, case_id, department_id, finish_id, current_version_id) "
            f"VALUES ('{ids['closure']}', '{ids['case']}', '{DEPT}', '{ids['finish']}', '{ids['closureVersion']}');")
        out.append(
            "INSERT INTO case_closure_versions (id, closure_id, case_id, department_id, finish_id, kind, "
            "from_version, to_version, close_at, close_amount_state, close_amt, close_outcome, "
            f"recorded_by_user_id, audit_event_id) VALUES ('{ids['closureVersion']}', '{ids['closure']}', "
            f"'{ids['case']}', '{DEPT}', '{ids['finish']}', 'REGISTER', 5, 6, {q(finished)}, "
            f"'KNOWN', {close_amt or 'NULL'}, {q(outcome)}, '{ACTOR}', '{ids['closureAudit']}');")

        # 归档 6→7
        out.append(
            "INSERT INTO audit_events (id, department_id, actor_user_id, internal_actor_user_id, "
            f"resource_type, resource_id, action, details) VALUES ('{ids['archiveAudit']}', '{DEPT}', "
            f"'{ACTOR}', '{ACTOR}', 'case', '{ids['case']}', 'case.archived', "
            f"""'{json.dumps({"archiveAt": archived, "archiveId": ids['archive'], "closureId": ids['closure'], "toVersion": 7, "fromVersion": 6, "migration": "NOCOBASE_BACKFILL"}, ensure_ascii=False)}');""")
        out.append(
            f"INSERT INTO case_archives (id, case_id, department_id, closure_id, closure_version_id, "
            f"current_version_id) VALUES ('{ids['archive']}', '{ids['case']}', '{DEPT}', "
            f"'{ids['closure']}', '{ids['closureVersion']}', '{ids['archiveVersion']}');")
        out.append(
            "INSERT INTO case_archive_versions (id, archive_id, case_id, department_id, closure_version_id, "
            "kind, from_version, to_version, archive_at, archive_type, archive_reason, "
            f"recorded_by_user_id, audit_event_id) VALUES ('{ids['archiveVersion']}', '{ids['archive']}', "
            f"'{ids['case']}', '{DEPT}', '{ids['closureVersion']}', 'ARCHIVE', 6, 7, {q(archived)}, "
            f"{q(archive_type)}, '历史迁移归档', '{ACTOR}', '{ids['archiveAudit']}');")

        # 回填当前指针
        out.append(
            f"UPDATE cases SET current_trial_round_id='{ids['round']}', current_acceptance_id='{ids['acc']}', "
            f"current_judgment_id='{ids['judg']}' WHERE id='{ids['case']}';")

        # 费用
        fees = [
            ('公证费', '支出', money(c.get('cost_notarization')), accepted or executed, '旧系统公证费'),
            ('披露费', '支出', money(c.get('cost_disclosure')), accepted or executed, '旧系统披露费'),
            ('样品费', '支出', money(c.get('cost_shopping')), accepted or executed, '旧系统购物费'),
            ('诉讼费', '支出', money(c.get('cost_legal_prepay')), accepted or executed, '旧系统预缴诉讼费'),
            ('诉讼费', '支出', money(c.get('cost_legal_paid')), accepted or executed, '旧系统实缴诉讼费'),
            ('诉讼退费', '收入', money(c.get('cost_legal_refund')), archived, '旧系统诉讼费退费'),
        ]
        for fee_index, (ftype, direction, amount, fdate, note) in enumerate(fees):
            if not amount:
                continue
            status = '退原告' if ftype == '诉讼退费' else '已支付'
            out.append(
                f"INSERT INTO fee_records (id, case_id, department_id, type, direction, status, amount, "
                f"fee_date, source, source_kind, source_id, note) VALUES "
                f"('{uuid.uuid4()}', '{ids['case']}', '{DEPT}', {q(ftype)}, {q(direction)}, {q(status)}, "
                f"{amount}, {q(fdate or archived)}, 'auto', 'NOCOBASE_BACKFILL', {q('nocobase:' + raw_id + '-' + str(fee_index))}, "
                f"{q(note)});")

        # 旧号别名
        out.append(
            f"INSERT INTO business_number_aliases (entity_type, entity_id, old_number) VALUES "
            f"('CASE', '{ids['case']}', {q('nocobase:' + raw_id)});")

        report.append({'old_id': raw_id, 'case_id': ids['case'], 'business_no': business_no,
                       'court_case_no': court_no, 'fees': sum(1 for f in fees if f[2])})

    out.append('COMMIT;')
    open(args.out, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(json.dumps({'sql': args.out, 'cases': report}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
