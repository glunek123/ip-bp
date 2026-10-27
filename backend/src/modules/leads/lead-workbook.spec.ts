import { BadRequestException } from '@nestjs/common';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { createLeadWorkbookTemplate, parseLeadWorkbook } from './lead-workbook';

describe('lead XLSX workbook', () => {
  it('generates an official 10-product template that can be parsed', () => {
    const sheets = parseLeadWorkbook(createLeadWorkbookTemplate());
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.rows[0]?.cells).toHaveLength(73);
    expect(sheets[0]?.rows[0]?.cells[0]).toBe('客户');
    expect(sheets[0]?.rows[0]?.cells[2]).toContain('系统生成');
    expect(sheets[0]?.rows[0]?.cells[72]).toBe('截图10');
  });

  it('reads sparse reordered rows without changing column pairing', () => {
    const parts = unzipSync(createLeadWorkbookTemplate());
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="4"><c r="D4" t="inlineStr"><is><t>2026-10-27</t></is></c><c r="J4" t="inlineStr"><is><t>https://example.com/a</t></is></c></row></sheetData></worksheet>`,
    );
    const rows = parseLeadWorkbook(zipSync(parts))[0]?.rows;
    expect(rows).toEqual([
      {
        rowNumber: 4,
        cells: [
          '',
          '',
          '',
          '2026-10-27',
          '',
          '',
          '',
          '',
          '',
          'https://example.com/a',
        ],
      },
    ]);
  });

  it('rejects expansion beyond the package limit before inflation', () => {
    const parts = unzipSync(createLeadWorkbookTemplate());
    parts['xl/worksheets/sheet1.xml'] = new Uint8Array(13 * 1024 * 1024);
    expect(() => parseLeadWorkbook(zipSync(parts))).toThrow(
      BadRequestException,
    );
  });
});
