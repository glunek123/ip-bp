import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = (path: string) =>
  readFileSync(
    resolve(process.cwd(), 'prisma/migrations', path, 'migration.sql'),
    'utf8',
  );
const sql = read('20261030630000_case_refund_zero_amount_readiness');
function body(text: string, name: string): string {
  const m = new RegExp(
    'CREATE(?: OR REPLACE)? FUNCTION\\s+(?:public\\.)?"?' +
      name +
      '"?\\s*\\([^]*?\\bAS\\s+(\\$[A-Za-z_0-9]*\\$)([^]*?)\\1\\s*;',
    'iu',
  ).exec(text);
  if (!m) throw Error('Function missing ' + name);
  return m[2]!.replaceAll('\r\n', '\n');
}
describe('268 financial protocol source contract (not PostgreSQL runtime proof)', () => {
  it('adds an immutable nullable amount sidecar without rewriting legacy items, receipts or snapshot rows', () => {
    expect(sql).toContain(
      'CREATE TABLE public.case_refund_inventory_item_amounts',
    );
    expect(sql).toContain('amount numeric(16,2)');
    expect(sql).toContain('PRIMARY KEY(inventory_version_id,item_id)');
    expect(sql).toContain(
      'REFERENCES public.case_refund_inventory_items(inventory_version_id,item_id)',
    );
    expect(sql).not.toMatch(/ALTER TABLE\s+"?case_refund_inventory_items/iu);
    expect(sql).not.toMatch(
      /UPDATE\s+(?:public\.)?(?:case_refund_inventory_items|case_refund_inventory_receipts|case_archive_evidence_snapshots)\s+SET/iu,
    );
    expect(sql).not.toMatch(/amount[^\n]*DEFAULT\s+0/iu);
  });
  it('seals every new item amount before receipt, rejects later mutation and attaches both existing source-order seals', () => {
    const guard = body(sql, 'guard_refund_item_amount_268');
    expect(guard).toContain("TG_OP<>'INSERT'");
    expect(guard).toContain('v.creation_xid=pg_current_xact_id()');
    expect(guard).toContain('i.xmin=pg_current_xact_id()::text::xid');
    expect(guard).toContain('case_refund_inventory_receipts');
    expect(sql).toContain(
      'FOR EACH ROW EXECUTE FUNCTION guard_archive_snapshot_source_order()',
    );
    expect(sql).toContain(
      'FOR EACH ROW EXECUTE FUNCTION seal_payment_correction_sources_3059()',
    );
    expect(body(sql, 'validate_case_refund_inventory_snapshot')).toContain(
      'new refund item requires explicit amount sidecar, NULL means unknown',
    );
    expect(sql).toContain(
      'AFTER INSERT ON case_refund_inventory_item_amounts DEFERRABLE INITIALLY DEFERRED',
    );
  });
  it('known zero exempts only payment/customer/lawyer and retains historical validator exact body', () => {
    const next = body(sql, 'validate_archive_snapshot_readiness'),
      old = body(
        read('20261030260000_settlement_manual_cents_v2_draft'),
        'validate_archive_snapshot_readiness',
      );
    expect(body(sql, 'validate_archive_snapshot_readiness_legacy_268')).toBe(
      old,
    );
    expect(next).toContain(
      's.creation_xid IS DISTINCT FROM pg_current_xact_id()',
    );
    expect(next).toContain(
      "refund_state:=refund_inventory_readiness_268(r.id)->>'state'",
    );
    expect(next).not.toContain("refund_state:='EXEMPT'");
    expect(
      body(sql, 'check_new_archive_required_financial_snapshot_draft'),
    ).toContain(
      "ROW('PASSED'::varchar,'EXEMPT'::varchar,'PASSED'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar)",
    );
  });
  it('new receipts bind canonical amount JSON; money edits reset confirmed scope and unknown is not zero', () => {
    expect(body(sql, 'check_case_refund_inventory_receipt')).toContain(
      'refund_inventory_items_projection_268(v.id,true)',
    );
    expect(body(sql, 'validate_case_refund_inventory_snapshot')).toContain(
      'i.description,a.amount',
    );
    const review = body(sql, 'refund_inventory_readiness_268');
    expect(review).toContain("a.amount>0 AND i.status='UNKNOWN'");
    expect(review).toContain(
      "i.party='DEFENDANT' AND i.status='CONVERTED_TO_COST'",
    );
    expect(review).toContain("reason:='REFUND_AMOUNT_UNKNOWN'");
    expect(review).toContain("v.declaration<>'COMPLETE' OR count_items=0");
  });
  it('zero required side needs no fake allocation but still verifies current calculation/source and correction refund review', () => {
    const next = body(sql, 'validate_archive_snapshot_readiness');
    expect(next).not.toContain('required_customer=0 AND NOT EXISTS');
    expect(next).not.toContain('required_lawyer=0 AND NOT EXISTS');
    expect(next).toContain('zero_outputs:=payment_settlement_outputs_3059');
    expect(body(sql, 'assert_payment_financial_review_3059')).toContain(
      'CUSTOMER_REQUIRED_AMOUNT_ZERO',
    );
    expect(body(sql, 'assert_payment_correction_3059')).toContain(
      "OR r.result_snapshot#>>'{review,financialReadiness}' IS DISTINCT FROM 'PASSED'",
    );
    expect(body(sql, 'assert_payment_financial_review_3059')).not.toContain(
      "refund_state:='EXEMPT'",
    );
  });
});
