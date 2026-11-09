import { unzipSync } from 'fflate';
import { createLitigationRefundWorkbook } from './litigation-refunds-workbook';
import type { LitigationRefundRow } from './litigation-refunds.service';

const row = (amount: string | null): LitigationRefundRow => ({
  caseId: 'case',
  itemId: 'item',
  inventoryVersionId: 'version',
  caseNo: 'CA-001',
  plaintiff: '甲&乙',
  defendant: '被告',
  courtNo: null,
  lawyer: null,
  party: 'COURT',
  amount,
  status: 'PENDING',
  description: '来源说明',
  remark: null,
  archived: false,
  archiveStatus: null,
  canFollow: true,
  canRecord: true,
  source: null,
});

describe('litigation refund workbook', () => {
  it('exports all nine fields, escapes text and uses numeric cents for known amount', () => {
    const files = unzipSync(
      createLitigationRefundWorkbook([row('12.30'), row(null)]),
    );
    const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('甲&amp;乙');
    expect(sheet).toContain('<c r="G2" s="1"><v>12.30</v></c>');
    expect(sheet).toContain(
      '<c r="G3" t="inlineStr"><is><t xml:space="preserve"></t></is></c>',
    );
    expect((sheet.match(/<c r="[A-I]1"/gu) ?? []).length).toBe(9);
    expect((sheet.match(/<c r="[A-I]2"/gu) ?? []).length).toBe(9);
  });
});
