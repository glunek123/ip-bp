import { BadRequestException } from '@nestjs/common';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { createRequire } from 'node:module';

type XmlTag = { local: string; attributes: Record<string, { value: string }> };
const attribute = (tag: XmlTag, name: string): string | undefined =>
  tag.attributes[name]?.value ?? tag.attributes[`r:${name}`]?.value;
interface XmlParser {
  on(event: 'doctype', callback: () => void): void;
  on(event: 'opentag', callback: (tag: XmlTag) => void): void;
  on(event: 'closetag', callback: (tag: XmlTag) => void): void;
  on(event: 'text', callback: (value: string) => void): void;
  write(value: string): XmlParser;
  close(): void;
}
const saxesPackage: unknown = createRequire(__filename)('saxes');
const SaxesParser = (
  saxesPackage as {
    SaxesParser: new (options: { xmlns: true }) => XmlParser;
  }
).SaxesParser;

export type WorkbookSheet = {
  name: string;
  rows: { rowNumber: number; cells: string[] }[];
};
const invalid = (): never => {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Excel 文件无效或超过导入限制',
  });
};
const workbookLimit = 2 * 1024 * 1024;
const expandedLimit = 12 * 1024 * 1024;
const text = new TextDecoder('utf-8', { fatal: true });

function xml(
  input: Uint8Array,
  handlers: {
    open?: (tag: XmlTag) => void;
    close?: (tag: XmlTag) => void;
    text?: (value: string) => void;
  },
): void {
  if (input.length > expandedLimit) invalid();
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', invalid);
  parser.on('opentag', (tag) => handlers.open?.(tag));
  parser.on('closetag', (tag) => handlers.close?.(tag));
  parser.on('text', (value) => handlers.text?.(value));
  parser.write(text.decode(input)).close();
}

function columnNumber(reference: string): number {
  const found = /^([A-Z]{1,3})[1-9]\d*$/u.exec(reference);
  if (!found) invalid();
  let value = 0;
  for (const character of found![1]!)
    value = value * 26 + character.charCodeAt(0) - 64;
  if (value > 620) invalid();
  return value - 1;
}

/** Parses only cell values. Formulas, macros, external links and drawings are never evaluated. */
export function parseLeadWorkbook(bytes: Uint8Array): WorkbookSheet[] {
  if (
    bytes.length > workbookLimit ||
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b
  )
    invalid();
  let entries: Record<string, Uint8Array>;
  try {
    let total = 0;
    entries = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > expandedLimit || file.originalSize > expandedLimit)
          invalid();
        return /^(?:xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet[1-9]\d*\.xml)|\[Content_Types\]\.xml)$/u.test(
          file.name,
        );
      },
    });
  } catch {
    return invalid();
  }
  const workbook = entries['xl/workbook.xml'];
  const relations = entries['xl/_rels/workbook.xml.rels'];
  if (!workbook || !relations) invalid();
  const targets = new Map<string, string>();
  xml(relations!, {
    open(tag) {
      if (tag.local !== 'Relationship') return;
      const id = attribute(tag, 'Id');
      const target = attribute(tag, 'Target');
      if (
        id &&
        target &&
        !tag.attributes.TargetMode &&
        /^\/?(?:xl\/)?worksheets\/sheet[1-9]\d*\.xml$/u.test(target)
      )
        targets.set(id, target.replace(/^\/?(?:xl\/)?/u, 'xl/'));
    },
  });
  const sheetSpecs: { name: string; id: string }[] = [];
  xml(workbook!, {
    open(tag) {
      if (
        tag.local === 'workbookPr' &&
        ['1', 'true'].includes(attribute(tag, 'date1904') ?? '')
      )
        invalid();
      if (tag.local !== 'sheet') return;
      const name = attribute(tag, 'name');
      const id = attribute(tag, 'id');
      if (name && id) sheetSpecs.push({ name, id });
    },
  });
  if (sheetSpecs.length < 1 || sheetSpecs.length > 20) invalid();
  const shared: string[] = [];
  const sharedXml = entries['xl/sharedStrings.xml'];
  if (sharedXml) {
    let active = false;
    let inText = false;
    let value = '';
    xml(sharedXml, {
      open(tag) {
        if (tag.local === 'si') {
          active = true;
          value = '';
        }
        if (active && tag.local === 't') inText = true;
      },
      text(part) {
        if (inText) value += part;
      },
      close(tag) {
        if (tag.local === 't') inText = false;
        if (tag.local === 'si') {
          shared.push(value);
          active = false;
          if (shared.length > 100000) invalid();
        }
      },
    });
  }
  let totalRows = 0;
  return sheetSpecs.map(({ name, id }) => {
    const target = targets.get(id);
    const sheet = target && entries[target];
    if (!sheet) return invalid();
    const rows: WorkbookSheet['rows'] = [];
    let rowNumber = 0;
    let cells: string[] = [];
    let cellIndex = -1;
    let cellType = '';
    let value = '';
    let inValue = false;
    let formula = false;
    xml(sheet!, {
      open(tag) {
        if (tag.local === 'row') {
          rowNumber = Number(tag.attributes.r?.value);
          totalRows += 1;
          if (
            !Number.isSafeInteger(rowNumber) ||
            rowNumber < 1 ||
            rowNumber > 1_048_576 ||
            totalRows > 1001
          )
            invalid();
          cells = [];
        }
        if (tag.local === 'c') {
          cellIndex = columnNumber(tag.attributes.r?.value ?? '');
          cellType = tag.attributes.t?.value ?? '';
          value = '';
          formula = false;
        }
        if (tag.local === 'f' && cellIndex >= 0) formula = true;
        if (
          tag.local === 'v' ||
          (tag.local === 't' && cellType === 'inlineStr')
        )
          inValue = true;
      },
      text(part) {
        if (inValue) value += part;
      },
      close(tag) {
        if (tag.local === 'v' || tag.local === 't') inValue = false;
        if (tag.local === 'c') {
          if (formula) invalid();
          if (cellIndex >= 0) {
            if (cellType === 's') {
              const index = Number(value);
              if (
                !Number.isSafeInteger(index) ||
                index < 0 ||
                index >= shared.length
              )
                invalid();
              value = shared[index]!;
            }
            if (cellType === 'e') invalid();
            if (cellType === 'b') value = value === '1' ? '是' : '否';
            cells[cellIndex] = value;
          }
          cellIndex = -1;
        }
        if (tag.local === 'row') {
          rows.push({
            rowNumber,
            cells: Array.from(
              { length: cells.length },
              (_, index) => cells[index] ?? '',
            ),
          });
        }
      },
    });
    return { name, rows };
  });
}

const templateColumns = [
  '客户',
  '权利主体',
  '案件单号（系统生成，请留空）',
  '线索发现日期',
  '案件类型',
  '线索来源',
  '平台',
  '店铺名',
  '店铺ID',
  '商品链接',
  '商品名称',
  '销量',
  '单价',
  '评论数',
  '截图',
  '线索备注',
  '是否需要披露',
  '侵权类型',
  '运营',
  ...Array.from({ length: 9 }, (_, index) => index + 2).flatMap((number) =>
    ['商品名称', '商品链接', '销量', '单价', '评论数', '截图'].map(
      (field) => `${field}${number}`,
    ),
  ),
];
function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
export function createLeadWorkbookTemplate(): Uint8Array {
  const header = templateColumns
    .map(
      (label, index) =>
        `<c r="${columnName(index)}1" t="inlineStr"><is><t>${label}</t></is></c>`,
    )
    .join('');
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="20" max="73" hidden="1" outlineLevel="1"/></cols><sheetData><row r="1">${header}</row></sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="线索导入" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(relationships),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
  });
}
