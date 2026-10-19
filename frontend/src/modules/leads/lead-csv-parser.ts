export type LeadCsvRecord = Readonly<{
  startLine: number;
  cells: readonly string[];
}>;

export type LeadCsvLimits = Readonly<{
  maxBytes: number;
  maxRecords: number;
  maxColumns: number;
}>;

export type LeadCsvParseErrorCode =
  | 'INVALID_LIMIT'
  | 'BYTE_LIMIT'
  | 'RECORD_LIMIT'
  | 'COLUMN_LIMIT'
  | 'INVALID_UTF8'
  | 'UNEXPECTED_BOM'
  | 'BARE_CR'
  | 'UNEXPECTED_QUOTE'
  | 'TRAILING_QUOTE_TEXT'
  | 'UNCLOSED_QUOTE';

export class LeadCsvParseError extends Error {
  readonly code: LeadCsvParseErrorCode;
  readonly line: number;
  readonly column: number;

  constructor(code: LeadCsvParseErrorCode, line: number, column: number) {
    super(`CSV ${code} at ${line}:${column}`);
    this.name = 'LeadCsvParseError';
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

/** Lexes UTF-8 CSV only. Column means a one-based Unicode code point position. */
export function parseLeadCsvRecords(
  bytes: Uint8Array,
  limits: LeadCsvLimits,
): readonly LeadCsvRecord[] {
  if (
    ![limits.maxBytes, limits.maxRecords, limits.maxColumns].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new LeadCsvParseError('INVALID_LIMIT', 1, 1);
  if (bytes.byteLength > limits.maxBytes)
    throw new LeadCsvParseError('BYTE_LIMIT', 1, 1);

  let text: string;
  try {
    // Keep the BOM visible so that only one at the beginning can be accepted.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new LeadCsvParseError('INVALID_UTF8', 1, 1);
  }
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  if (text.length === 0) return Object.freeze([]);

  const records: LeadCsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let state: 'start' | 'unquoted' | 'quoted' | 'afterQuote' = 'start';
  let active = false;
  let line = 1;
  let column = 1;
  let startLine = 1;
  let quoteLine = 1;
  let quoteColumn = 1;

  function pushCell(): void {
    if (cells.length >= limits.maxColumns)
      throw new LeadCsvParseError('COLUMN_LIMIT', line, column);
    cells.push(cell);
    cell = '';
    state = 'start';
  }

  function pushRecord(): void {
    pushCell();
    if (records.length >= limits.maxRecords)
      throw new LeadCsvParseError('RECORD_LIMIT', startLine, 1);
    records.push(Object.freeze({ startLine, cells: Object.freeze(cells) }));
    cells = [];
    active = false;
  }

  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset);
    if (point === undefined) break;
    const character = String.fromCodePoint(point);
    const width = character.length;
    const next = text[offset + width];

    if (character === '\uFEFF')
      throw new LeadCsvParseError('UNEXPECTED_BOM', line, column);
    if (character === '\r' && next !== '\n')
      throw new LeadCsvParseError('BARE_CR', line, column);

    if (character === '\n' || character === '\r') {
      const lineBreak = character === '\r' ? '\r\n' : '\n';
      if (state === 'quoted') cell += lineBreak;
      else pushRecord();
      offset += lineBreak.length;
      line += 1;
      column = 1;
      if (state !== 'quoted') startLine = line;
      continue;
    }

    if (state === 'quoted') {
      if (character === '"') {
        if (next === '"') {
          cell += '"';
          offset += 2;
          column += 2;
          continue;
        }
        state = 'afterQuote';
      } else {
        cell += character;
      }
    } else if (state === 'afterQuote') {
      if (character === ',') pushCell();
      else throw new LeadCsvParseError('TRAILING_QUOTE_TEXT', line, column);
    } else if (character === ',') {
      pushCell();
    } else if (character === '"') {
      if (state !== 'start')
        throw new LeadCsvParseError('UNEXPECTED_QUOTE', line, column);
      quoteLine = line;
      quoteColumn = column;
      state = 'quoted';
    } else {
      cell += character;
      state = 'unquoted';
    }
    active = true;
    offset += width;
    column += 1;
  }

  if (state === 'quoted')
    throw new LeadCsvParseError('UNCLOSED_QUOTE', quoteLine, quoteColumn);
  if (active) pushRecord();
  return Object.freeze(records);
}
