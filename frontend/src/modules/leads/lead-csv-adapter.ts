import type {
  CreateLeadInput,
  LeadFormContext,
  LeadOption,
  LeadProductInput,
  LeadSource,
} from '../../api/leads';
import type { LeadCsvParsedRow } from './lead-csv-preview';
import { parseLeadCsvRecords, type LeadCsvRecord } from './lead-csv-parser';

export type LeadCsvMappingContext = Readonly<{
  formContext: LeadFormContext;
  operatorDisplayName: string;
}>;

export class LeadCsvHeaderError extends Error {
  readonly code = 'INVALID_CSV_HEADER';
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = 'LeadCsvHeaderError';
    this.line = line;
  }
}

const basicHeader = [
  '客户',
  '权利主体',
  '案件类型',
  '运营',
  '线索来源',
  '平台',
  '侵权类型',
  '线索发现日期',
  '店铺名',
  '店铺ID',
  '是否需要披露',
  '线索备注',
  '商品链接',
  '商品名称',
  '销量',
  '单价',
  '评论数',
] as const;
const maxProducts = 100;
const csvLimits = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxRecords: 1001,
  maxColumns: basicHeader.length + (maxProducts - 1) * 5,
});
type ValueResult<T> =
  { value: T; error?: never } | { value?: never; error: string };
const shanghaiFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function canonicalText(value: string): string {
  return value.normalize('NFKC').trim();
}

function utcMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(hour, minute, second, 0);
  return result.getTime();
}

function shanghaiParts(
  instant: Date,
): [number, number, number, number, number, number] {
  const parts = Object.fromEntries(
    shanghaiFormatter
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return [
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ];
}

function headerForProduct(number: number): string[] {
  return [
    `商品${number}链接`,
    `商品${number}名称`,
    `商品${number}销量`,
    `商品${number}单价`,
    `商品${number}评论数`,
  ];
}

function checkHeader(record: LeadCsvRecord | undefined): number {
  if (!record) throw new LeadCsvHeaderError(1, 'CSV缺少表头');
  const actual = record.cells;
  if (
    actual.length < basicHeader.length ||
    (actual.length - basicHeader.length) % 5 !== 0
  )
    throw new LeadCsvHeaderError(record.startLine, 'CSV表头列数不符');
  const expected: string[] = [...basicHeader];
  for (let product = 2; expected.length < actual.length; product++)
    expected.push(...headerForProduct(product));
  if (actual.some((cell, index) => cell !== expected[index]))
    throw new LeadCsvHeaderError(
      record.startLine,
      'CSV表头必须使用指定中文列名与顺序',
    );
  return actual.length;
}

function matchOption<T extends string>(
  raw: string,
  options: readonly LeadOption<T>[],
  label: string,
): ValueResult<T> {
  const value = raw.trim();
  const matches = options.filter(
    (option) => option.label === value || option.value === value,
  );
  return matches.length === 1
    ? { value: matches[0]!.value }
    : { error: `${label}${matches.length ? '有歧义' : '不在当前可选范围'}` };
}

function parseShanghaiTime(raw: string): ValueResult<string> {
  const value = raw.trim();
  const local =
    /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/u.exec(value);
  const offset =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  const parts = local ?? offset;
  if (!parts) return { error: '线索发现日期格式无效' };
  const [year, month, day, hour, minute, second] = [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
    Number(parts[4] ?? 0),
    Number(parts[5] ?? 0),
    Number(parts[6] ?? 0),
  ];
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (
    year < 1 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  )
    return { error: '线索发现日期不是有效日历时间' };

  if (offset) {
    const suffix = offset[8]!;
    const sign = suffix[0] === '-' ? -1 : 1;
    const offsetHours = suffix === 'Z' ? 0 : Number(suffix.slice(1, 3));
    const offsetMinutes = suffix === 'Z' ? 0 : Number(suffix.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59)
      return { error: '线索发现日期时区偏移无效' };
    const milliseconds = Number((offset[7] ?? '').padEnd(3, '0'));
    const instant =
      calendar.getTime() +
      milliseconds -
      sign * (offsetHours * 60 + offsetMinutes) * 60_000;
    return { value: new Date(instant).toISOString() };
  }

  // Infer candidate offsets from IANA zone observations around the wall time.
  // This also covers Shanghai's historical second-precision local mean time.
  const wallMillis = calendar.getTime();
  const offsets = new Set(
    [-24, 0, 24].map((hours) => {
      const sample = wallMillis + hours * 3_600_000;
      const parts = shanghaiParts(new Date(sample));
      return utcMillis(...parts) - sample;
    }),
  );
  const candidates = [...offsets].flatMap((zoneOffset) => {
    const instant = new Date(wallMillis - zoneOffset);
    const parts = shanghaiParts(instant);
    return parts.every(
      (part, index) => part === [year, month, day, hour, minute, second][index],
    )
      ? [instant.toISOString()]
      : [];
  });
  return candidates.length === 1
    ? { value: candidates[0]! }
    : { error: '线索发现日期在上海时区不存在或有歧义' };
}

function parseCount(raw: string, label: string): ValueResult<number> {
  const value = raw.trim() || '0';
  if (!/^\d+$/u.test(value)) return { error: `${label}必须是范围内的非负整数` };
  const digits = value.replace(/^0+/u, '') || '0';
  if (digits.length > 10 || BigInt(digits) > 2_147_483_647n)
    return { error: `${label}必须是范围内的非负整数` };
  return { value: Number(digits) };
}

function parsePrice(raw: string): ValueResult<string> {
  const value = raw.trim() || '0';
  return /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value)
    ? { value }
    : { error: '单价必须是非负金额，最多两位小数' };
}

function parseProduct(
  cells: readonly string[],
  offset: number,
  number: number,
  errors: string[],
): LeadProductInput {
  const url = canonicalText(cells[offset]!);
  const title = canonicalText(cells[offset + 1]!);
  if (!url && !title) errors.push(`商品${number}链接和名称至少填写一项`);
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Invalid URL');
    } catch {
      errors.push(`商品${number}链接仅支持有效的http/https地址`);
    }
  }
  if (url.length > 2048) errors.push(`商品${number}链接超过2048字符`);
  if (title.length > 200) errors.push(`商品${number}名称超过200字符`);
  const quantity = parseCount(cells[offset + 2]!, `商品${number}销量`);
  const unitPrice = parsePrice(cells[offset + 3]!);
  const commentCount = parseCount(cells[offset + 4]!, `商品${number}评论数`);
  if (quantity.error) errors.push(quantity.error);
  if (unitPrice.error) errors.push(`商品${number}${unitPrice.error}`);
  if (commentCount.error) errors.push(commentCount.error);
  if (
    quantity.value !== undefined &&
    unitPrice.value !== undefined &&
    commentCount.value !== undefined
  ) {
    const [integer, fraction = ''] = unitPrice.value.split('.');
    const cents = BigInt(integer!) * 100n + BigInt(fraction.padEnd(2, '0'));
    const basis = quantity.value > 0 ? quantity.value : commentCount.value;
    if (cents * BigInt(basis) > 999_999_999_999_999_999n)
      errors.push(`商品${number}估算额超过9999999999999999.99`);
  }
  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    quantity: quantity.value ?? 0,
    unitPrice: unitPrice.value ?? '0',
    commentCount: commentCount.value ?? 0,
  };
}

function mapRow(
  record: LeadCsvRecord,
  context: LeadCsvMappingContext,
): LeadCsvParsedRow {
  const cells = record.cells;
  const errors: string[] = [];
  const customerName = cells[0]!.trim();
  const customers = context.formContext.customers.filter(
    (item) => item.name.trim() === customerName,
  );
  if (!customerName || customers.length !== 1)
    errors.push('客户名称必须在当前可选范围内唯一匹配');
  const customer = customers.length === 1 ? customers[0] : undefined;
  const holderName = cells[1]!.trim();
  const holders =
    customer?.rightsHolders.filter((item) => item.name.trim() === holderName) ??
    [];
  const holder = holderName
    ? holders.length === 1
      ? holders[0]
      : undefined
    : customer?.rightsHolders.length === 1
      ? customer.rightsHolders[0]
      : undefined;
  if (!holder) errors.push('权利主体必须在该客户下唯一匹配');

  const caseType = matchOption(
    cells[2]!,
    context.formContext.dictionaries.caseTypes,
    '案件类型',
  );
  const operator = cells[3]!.trim();
  if (!context.operatorDisplayName.trim()) errors.push('当前运营身份不可用');
  if (operator && operator !== context.operatorDisplayName.trim())
    errors.push('运营必须为空或等于当前操作者实名');
  const source = matchOption(
    cells[4]!,
    context.formContext.dictionaries.sources,
    '线索来源',
  );
  const platformOptions = source.value
    ? context.formContext.dictionaries.platforms[source.value as LeadSource]
    : [];
  const platform = matchOption(cells[5]!, platformOptions, '平台');
  for (const result of [caseType, source, platform])
    if (result.error) errors.push(result.error);
  const infringementTypes: CreateLeadInput['infringementTypes'][number][] = [];
  const infringementText = cells[6]!.trim();
  if (!infringementText) errors.push('请至少填写一种侵权类型');
  else
    for (const item of infringementText.split('、')) {
      const mapped = matchOption(
        item,
        context.formContext.dictionaries.infringementTypes,
        '侵权类型',
      );
      if (mapped.error) errors.push(mapped.error);
      else if (
        mapped.value !== undefined &&
        !infringementTypes.includes(mapped.value)
      )
        infringementTypes.push(mapped.value);
    }
  const foundAt = parseShanghaiTime(cells[7]!);
  if (foundAt.error) errors.push(foundAt.error);
  const shopName = canonicalText(cells[8]!);
  if (!shopName || shopName.length > 200)
    errors.push('店铺名必填且最多200字符');
  const shopExternalId = canonicalText(cells[9]!);
  if (shopExternalId.length > 100) errors.push('店铺ID最多100字符');
  const disclosure = cells[10]!.trim();
  if (disclosure !== '是' && disclosure !== '否')
    errors.push('是否需要披露必须填写是或否');
  const remark = canonicalText(cells[11]!);
  if (remark.length > 5000) errors.push('线索备注最多5000字符');

  const products: LeadProductInput[] = [parseProduct(cells, 12, 1, errors)];
  for (
    let offset = basicHeader.length, number = 2;
    offset < cells.length;
    offset += 5, number++
  ) {
    const group = cells.slice(offset, offset + 5);
    if (group.every((cell) => cell.trim() === '')) continue;
    products.push(parseProduct(cells, offset, number, errors));
  }
  if (
    errors.length ||
    !customer ||
    !holder ||
    !caseType.value ||
    !source.value ||
    !platform.value ||
    !foundAt.value ||
    (disclosure !== '是' && disclosure !== '否')
  )
    return { rowNumber: record.startLine, status: 'invalid', errors };
  return {
    rowNumber: record.startLine,
    status: 'valid',
    suspectedDuplicates: [],
    input: {
      customerId: customer.id,
      rightsHolderId: holder.id,
      caseType: caseType.value,
      infringementTypes,
      source: source.value,
      platform: platform.value,
      foundAt: foundAt.value,
      shopName,
      ...(shopExternalId ? { shopExternalId } : {}),
      needDisclose: disclosure === '是',
      ...(remark ? { remark } : {}),
      products,
      leadScreenshotContentVersionIds: [],
    },
  };
}

function fingerprint(input: CreateLeadInput): string {
  return JSON.stringify({
    ...input,
    infringementTypes: [...input.infringementTypes].sort(),
    products: input.products.map((product) => ({
      ...product,
      unitPrice: `${product.unitPrice.split('.')[0]}.${(product.unitPrice.split('.')[1] ?? '').padEnd(2, '0')}`,
    })),
  });
}

export function parseLeadCsvPreview(
  bytes: Uint8Array,
  context: LeadCsvMappingContext,
): readonly LeadCsvParsedRow[] {
  const records = parseLeadCsvRecords(bytes, csvLimits);
  const width = checkHeader(records[0]);
  const seen = new Map<string, number>();
  const rows: LeadCsvParsedRow[] = [];
  for (const record of records.slice(1)) {
    if (record.cells.every((cell) => cell.trim() === '')) continue;
    if (record.cells.length !== width)
      throw new LeadCsvHeaderError(record.startLine, 'CSV数据行列数与表头不同');
    const row = mapRow(record, context);
    if (row.status === 'valid') {
      const key = fingerprint(row.input);
      const first = seen.get(key);
      if (first !== undefined)
        row.suspectedDuplicates = [`疑似与本文件第${first}行完整输入重复`];
      else seen.set(key, row.rowNumber);
    }
    rows.push(row);
  }
  return rows;
}

export function createLeadCsvTemplate(context: LeadCsvMappingContext): string {
  void context;
  return `${basicHeader.join(',')}\r\n`;
}
