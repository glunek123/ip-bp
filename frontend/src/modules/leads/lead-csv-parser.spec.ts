import { describe, expect, it } from 'vitest';
import {
  LeadCsvParseError,
  parseLeadCsvRecords,
  type LeadCsvLimits,
  type LeadCsvParseErrorCode,
} from './lead-csv-parser';

const encoder = new TextEncoder();
const limits: LeadCsvLimits = {
  maxBytes: 1024,
  maxRecords: 10,
  maxColumns: 5,
};

function parse(text: string, bounds = limits) {
  return parseLeadCsvRecords(encoder.encode(text), bounds);
}

function expectError(
  bytes: Uint8Array,
  code: LeadCsvParseErrorCode,
  line: number,
  column: number,
  bounds = limits,
): void {
  try {
    parseLeadCsvRecords(bytes, bounds);
    throw new Error('Expected a CSV parse error');
  } catch (error) {
    expect(error).toBeInstanceOf(LeadCsvParseError);
    expect(error).toMatchObject({ code, line, column });
  }
}

describe('lead CSV byte lexer', () => {
  it('preserves BOM-free UTF-8 cell text, quotes, commas and physical line positions', () => {
    const bytes = encoder.encode(
      '\uFEFF客户,说明\r\n甲,"首行,甲\r\n次行""引号"\r\n乙,尾行\n',
    );
    const original = bytes.slice();
    const records = parseLeadCsvRecords(bytes, limits);
    expect(records).toEqual([
      { startLine: 1, cells: ['客户', '说明'] },
      { startLine: 2, cells: ['甲', '首行,甲\r\n次行"引号'] },
      { startLine: 4, cells: ['乙', '尾行'] },
    ]);
    expect(bytes).toEqual(original);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[1])).toBe(true);
    expect(Object.isFrozen(records[1]?.cells)).toBe(true);
  });

  it('keeps empty records and cells for the adapter, without inventing a record after terminal newline', () => {
    expect(parse('')).toEqual([]);
    expect(parse('\uFEFF')).toEqual([]);
    expect(parse('a,\n\n,""\n')).toEqual([
      { startLine: 1, cells: ['a', ''] },
      { startLine: 2, cells: [''] },
      { startLine: 3, cells: ['', ''] },
    ]);
  });

  it.each([
    ['a"b', 'UNEXPECTED_QUOTE', 1, 2],
    ['"a" b', 'TRAILING_QUOTE_TEXT', 1, 4],
    ['a,"b\nnext', 'UNCLOSED_QUOTE', 1, 3],
    ['a\rb', 'BARE_CR', 1, 2],
    ['a\n\uFEFFb', 'UNEXPECTED_BOM', 2, 1],
    ['😀"bad', 'UNEXPECTED_QUOTE', 1, 2],
  ] as const)(
    'rejects malformed CSV with %s location',
    (input, code, line, column) => {
      expectError(encoder.encode(input), code, line, column);
    },
  );

  it('rejects invalid UTF-8 and resource overruns with stable error codes', () => {
    expectError(new Uint8Array([0x61, 0xff]), 'INVALID_UTF8', 1, 1);
    expectError(encoder.encode('ab'), 'BYTE_LIMIT', 1, 1, {
      ...limits,
      maxBytes: 1,
    });
    expectError(encoder.encode('h\na'), 'RECORD_LIMIT', 2, 1, {
      ...limits,
      maxRecords: 1,
    });
    expectError(encoder.encode('a,b,c'), 'COLUMN_LIMIT', 1, 6, {
      ...limits,
      maxColumns: 2,
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'requires finite positive safe integer limits (%s)',
    (maxBytes) => {
      expectError(encoder.encode('a'), 'INVALID_LIMIT', 1, 1, {
        ...limits,
        maxBytes,
      });
    },
  );
});
