import {
  mapLegacyLeadRecord,
  type LeadCsvMappingContext,
} from './lead-csv-adapter';
import type { LeadCsvRecord } from './lead-csv-parser';
import type { LeadCsvParsedRow } from './lead-csv-preview';

export const officialLeadColumns = [
  '客户',
  '权利主体',
  '案件单号',
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
] as const;
const productFields = [
  '商品名称',
  '商品链接',
  '销量',
  '单价',
  '评论数',
  '截图',
] as const;
export const maxLeadImportProducts = 100;
export type LeadTableRecord = Readonly<{
  rowNumber: number;
  cells: readonly string[];
}>;
export type LeadColumnMapping = Readonly<{
  fields: Readonly<Record<string, number | null>>;
  unknownColumns: readonly number[];
  ambiguousColumns: readonly number[];
  missingFields: readonly string[];
}>;
const aliases: Readonly<Record<string, string>> = {
  '案件单号(系统生成,请留空)': '案件单号',
  店铺名称: '店铺名',
  商品网址: '商品链接',
  商品地址: '商品链接',
  店铺编号: '店铺ID',
  发现日期: '线索发现日期',
  备注: '线索备注',
  销售量: '销量',
  商品价格: '单价',
  评论量: '评论数',
  截图链接: '截图',
  权利人: '权利主体',
};
const optional = new Set(['案件单号', '店铺ID', '线索备注', '运营', '截图']);
const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/gu, '');
function dateCell(value: string): string {
  if (!/^\d{2,7}(?:\.\d+)?$/u.test(value.trim())) return value;
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 61 || serial > 2_958_465)
    return value;
  const instant = new Date(
    Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000),
  );
  if (Number.isNaN(instant.getTime())) return value;
  return instant.toISOString().slice(0, 19).replace('T', ' ');
}

function fieldOf(raw: string): string | null {
  const label = normalize(raw);
  const numbered =
    /^(商品名称|商品链接|商品网址|销量|单价|评论数|截图|截图链接)([1-9]\d{0,2})$/u.exec(
      label,
    );
  if (numbered) {
    const number = Number(numbered[2]);
    if (number < 2 || number > maxLeadImportProducts) return null;
    const base = aliases[numbered[1]!] ?? numbered[1]!;
    return `${base}${number}`;
  }
  return officialLeadColumns.includes(
    label as (typeof officialLeadColumns)[number],
  )
    ? label
    : (aliases[label] ?? null);
}

export function leadImportFields(maxProduct = 10): string[] {
  const result: string[] = [...officialLeadColumns];
  for (let number = 2; number <= maxProduct; number++)
    result.push(...productFields.map((field) => `${field}${number}`));
  return result;
}

export function suggestLeadColumnMapping(
  headers: readonly string[],
): LeadColumnMapping {
  const fields: Record<string, number | null> = {};
  const unknownColumns: number[] = [];
  const ambiguousColumns: number[] = [];
  headers.forEach((header, index) => {
    const field = fieldOf(header);
    if (!field) {
      if (header.trim()) unknownColumns.push(index);
      return;
    }
    if (Object.hasOwn(fields, field)) {
      fields[field] = null;
      ambiguousColumns.push(index);
      return;
    }
    fields[field] = index;
  });
  const missingFields = officialLeadColumns.filter(
    (field) => !optional.has(field) && fields[field] === undefined,
  );
  return { fields, unknownColumns, ambiguousColumns, missingFields };
}

function sourceIndex(mapping: LeadColumnMapping, field: string): number | null {
  return mapping.fields[field] ?? null;
}

/** Call only after the user confirms unresolved columns and ignored data. */
export function mapLeadTableRows(
  records: readonly LeadTableRecord[],
  mapping: LeadColumnMapping,
  context: LeadCsvMappingContext,
): readonly LeadCsvParsedRow[] {
  const presentNumbers = Object.keys(mapping.fields).flatMap((field) => {
    const match =
      /^(?:商品名称|商品链接|销量|单价|评论数|截图)([1-9]\d{0,2})$/u.exec(
        field,
      );
    return match && Number(match[1]) > 1 && mapping.fields[field] !== null
      ? [Number(match[1])]
      : [];
  });
  const highest = Math.max(1, ...presentNumbers);
  const results: LeadCsvParsedRow[] = [];
  const seen = new Map<string, number>();
  for (const record of records) {
    if (record.cells.every((cell) => !cell?.trim())) continue;
    const get = (field: string) => {
      const index = sourceIndex(mapping, field);
      return index === null ? '' : (record.cells[index] ?? '');
    };
    const legacy = [
      get('客户'),
      get('权利主体'),
      get('案件类型'),
      get('运营'),
      get('线索来源'),
      get('平台'),
      get('侵权类型'),
      dateCell(get('线索发现日期')),
      get('店铺名'),
      get('店铺ID'),
      get('是否需要披露'),
      get('线索备注'),
      get('商品链接'),
      get('商品名称'),
      get('销量'),
      get('单价'),
      get('评论数'),
    ];
    for (let number = 2; number <= highest; number++)
      legacy.push(
        get(`商品链接${number}`),
        get(`商品名称${number}`),
        get(`销量${number}`),
        get(`单价${number}`),
        get(`评论数${number}`),
      );
    const row = mapLegacyLeadRecord(
      { startLine: record.rowNumber, cells: legacy } as LeadCsvRecord,
      context,
    );
    const errors = row.status === 'invalid' ? [...row.errors] : [];
    if (get('案件单号').trim())
      errors.push('案件单号由系统生成，请清空文件中的号码');
    if (!get('运营').trim())
      errors.push(
        '运营不能为空，须填写负责运营的实名；重名时填写唯一登录用户名',
      );
    const remoteScreenshots: {
      productNumber: number;
      sourceGroupNumber: number;
      urls: string[];
    }[] = [];
    let storedPosition = 1;
    for (let number = 1; number <= highest; number++) {
      const field = number === 1 ? '截图' : `截图${number}`;
      const urls = get(field)
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean);
      if (urls.length > 20) errors.push(`商品${number}截图不能超过20张`);
      if (new Set(urls).size !== urls.length)
        errors.push(`商品${number}截图链接重复`);
      for (const url of urls) {
        let valid = false;
        try {
          const parsed = new URL(url);
          valid =
            url.length <= 2048 &&
            !/[\s<>\\]/u.test(url) &&
            ['http:', 'https:'].includes(parsed.protocol) &&
            !parsed.username &&
            !parsed.password &&
            !parsed.hash;
        } catch {
          valid = false;
        }
        if (!valid)
          errors.push(`商品${number}截图链接无效：${url.slice(0, 120)}`);
      }
      const productFieldsForGroup =
        number === 1
          ? ['商品名称', '商品链接', '销量', '单价', '评论数']
          : ['商品名称', '商品链接', '销量', '单价', '评论数'].map(
              (base) => `${base}${number}`,
            );
      const hasProduct = productFieldsForGroup.some((name) => get(name).trim());
      if (number > 1 && hasProduct) storedPosition += 1;
      if (urls.length && !hasProduct)
        errors.push(`商品${number}只有截图，商品字段不能全空`);
      if (urls.length && hasProduct)
        remoteScreenshots.push({
          productNumber: storedPosition,
          sourceGroupNumber: number,
          urls,
        });
    }
    if (
      remoteScreenshots.reduce((total, group) => total + group.urls.length, 0) >
      20
    )
      errors.push('每条线索最多20张截图');
    if (errors.length)
      results.push({ rowNumber: record.rowNumber, status: 'invalid', errors });
    else if (row.status === 'valid') {
      const fingerprint = JSON.stringify(row.input);
      const first = seen.get(fingerprint);
      results.push({
        ...row,
        remoteScreenshots,
        operatorText: get('运营').trim(),
        suspectedDuplicates: first ? [`疑似与本文件第${first}行重复`] : [],
      });
      if (!first) seen.set(fingerprint, record.rowNumber);
    }
  }
  return results;
}
