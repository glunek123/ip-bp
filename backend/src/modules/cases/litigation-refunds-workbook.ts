import { strToU8, zipSync } from 'fflate';
import type { LitigationRefundRow } from './litigation-refunds.service';

const xml = (value: string) => value
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;')
  .replace(/'/gu, '&apos;');
const textCell = (reference: string, value: string | null) =>
  `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`;
const amountCell = (reference: string, value: string | null) =>
  value === null
    ? textCell(reference, null)
    : `<c r="${reference}" s="1"><v>${value}</v></c>`;

/** Same minimal fflate/OOXML envelope as the existing lead workbook template. */
export function createLitigationRefundWorkbook(rows: readonly LitigationRefundRow[]): Uint8Array {
  const headers = ['案件单号', '原告', '被告', '案号', '办案律师', '退费方式', '应退金额', '退费状态', '跟进备注'];
  const statusLabels: Record<LitigationRefundRow['status'], string> = {
    UNKNOWN: '待确认',
    PENDING: '待退',
    SUBMITTED: '已提交',
    RETURNED_UNSETTLED: '已退未结算',
    SETTLED: '客户已收公司未收',
    RECEIVED: '公司已收',
    CONVERTED_TO_COST: '转成本',
  };
  const data = [
    `<row r="1">${headers.map((value, index) => textCell(`${String.fromCharCode(65 + index)}1`, value)).join('')}</row>`,
    ...rows.map((row, index) => {
      const number = index + 2;
      const values = [
        row.caseNo,
        row.plaintiff,
        row.defendant,
        row.courtNo,
        row.lawyer,
        row.party === 'COURT' ? '法院退费' : '被告径付',
        row.amount,
        statusLabels[row.status],
        row.remark,
      ];
      return `<row r="${number}">${values.map((value, column) => {
        const reference = `${String.fromCharCode(65 + column)}${number}`;
        return column === 6 ? amountCell(reference, value) : textCell(reference, value);
      }).join('')}</row>`;
    }),
  ];
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data.join('')}</sheetData></worksheet>`;
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="诉讼退费" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relations = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(relations),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
  });
}
