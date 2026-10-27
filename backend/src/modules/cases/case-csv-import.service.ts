import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CustomerCaseEntrySourceService } from '../customers';
import { CreateCaseExternalEntryDto } from './case-external-entry.dto';
import { CaseExternalEntryService } from './case-external-entry.service';
import {
  CaseCsvCommitDto,
  CaseCsvCommitResultDto,
  CaseCsvDuplicateCandidatesDto,
  CaseCsvPreviewDto,
  CaseCsvPreviewResultDto,
  CaseCsvPreviewRowDto,
} from './case-csv-import.dto';
import {
  caseCsvLabels,
  caseCsvTemplate,
  decodeCaseCsv,
  type CaseCsvRecord,
} from './case-csv-format';

type Options = Awaited<ReturnType<CaseExternalEntryService['options']>>;
type Customers = Awaited<
  ReturnType<CustomerCaseEntrySourceService['listForCsv']>
>;
type RowError = CaseCsvPreviewRowDto['errors'][number];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function named<T extends string>(
  value: string,
  labels: Record<T, string>,
): T | null {
  const matches = (Object.keys(labels) as T[]).filter(
    (key) => labels[key] === value || key === value,
  );
  return matches.length === 1 ? matches[0] : null;
}

@Injectable()
export class CaseCsvImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly customers: CustomerCaseEntrySourceService,
    private readonly external: CaseExternalEntryService,
    private readonly access: AccessControlService,
  ) {}

  template(): string {
    return caseCsvTemplate();
  }

  async preview(
    actor: ActorContext,
    input: CaseCsvPreviewDto,
  ): Promise<CaseCsvPreviewResultDto> {
    const { records } = decodeCaseCsv(input.csvBase64);
    return this.database.$transaction(
      async (tx) => {
        await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
        const [options, customers] = await Promise.all([
          this.external.options(actor, tx, true),
          this.customers.listForCsv(actor, tx),
        ]);
        if (!options.canCreate)
          throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
        const rows = records.map((record) =>
          this.parseRow(record, options, customers, 'preview'),
        );
        await this.attachDuplicateCandidates(tx, actor, rows);
        return {
          rows,
          validCount: rows.filter((row) => row.valid).length,
          errorCount: rows.filter((row) => !row.valid).length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async commit(
    actor: ActorContext,
    input: CaseCsvCommitDto,
  ): Promise<CaseCsvCommitResultDto> {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !==
        'csvBase64,duplicateConfirmations,idempotencyKey,rowNumbers' ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      !Array.isArray(input.rowNumbers) ||
      input.rowNumbers.length < 1 ||
      input.rowNumbers.length > 20 ||
      input.rowNumbers.some((n) => !Number.isSafeInteger(n) || n < 2) ||
      new Set(input.rowNumbers).size !== input.rowNumbers.length ||
      !Array.isArray(input.duplicateConfirmations) ||
      input.duplicateConfirmations.length > input.rowNumbers.length ||
      new Set(input.duplicateConfirmations.map((item) => item?.rowNumber))
        .size !== input.duplicateConfirmations.length ||
      input.duplicateConfirmations.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          Object.keys(item).sort().join(',') !==
            'caseIds,rowNumber,rowNumbers' ||
          !input.rowNumbers.includes(item.rowNumber) ||
          !Array.isArray(item.caseIds) ||
          item.caseIds.length > 1000 ||
          item.caseIds.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
          new Set(item.caseIds).size !== item.caseIds.length ||
          !Array.isArray(item.rowNumbers) ||
          item.rowNumbers.length > 20 ||
          item.rowNumbers.some(
            (n) => !Number.isSafeInteger(n) || n < 2 || n === item.rowNumber,
          ) ||
          new Set(item.rowNumbers).size !== item.rowNumbers.length,
      )
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    const { bytes, records } = decodeCaseCsv(input.csvBase64);
    const fileFingerprint = createHash('sha256').update(bytes).digest('hex');
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          fileFingerprint,
          rowNumbers: input.rowNumbers,
          duplicateConfirmations: input.duplicateConfirmations,
        }),
      )
      .digest('hex');
    const rowsByNumber = new Map(
      records.map((record) => [record.rowNumber, record]),
    );
    const selectedRecords = input.rowNumbers.map((number) => {
      const record = rowsByNumber.get(number);
      if (!record)
        throw new BadRequestException({
          code: 'CASE_CSV_ROW_NOT_FOUND',
          details: { rowNumber: number },
        });
      return record;
    });
    const key = {
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      idempotencyKey: input.idempotencyKey,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
            const prior = await tx.caseCsvImportReceipt.findUnique({
              where: { departmentId_actorUserId_idempotencyKey: key },
            });
            if (
              prior &&
              (prior.requestFingerprint !== requestFingerprint ||
                prior.fileFingerprint !== fileFingerprint)
            )
              throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
            if (!prior) {
              const duplicate = await tx.caseCsvImportedRow.findFirst({
                where: {
                  departmentId: actor.departmentId,
                  fileFingerprint,
                  rowNumber: { in: input.rowNumbers },
                },
                select: { rowNumber: true },
              });
              if (duplicate)
                throw new ConflictException({
                  code: 'CASE_CSV_ROW_ALREADY_IMPORTED',
                  details: { rowNumber: duplicate.rowNumber },
                });
            }
            let selected: Array<{
              rowNumber: number;
              input: CreateCaseExternalEntryDto;
            }>;
            if (prior) {
              const snapshot = prior.resultSnapshot as { rowInputs?: unknown };
              if (
                !snapshot ||
                !Array.isArray(snapshot.rowInputs) ||
                snapshot.rowInputs.length !== input.rowNumbers.length
              )
                throw new ConflictException({ code: 'INVALID_RECEIPT' });
              selected = snapshot.rowInputs as typeof selected;
              if (
                selected.some(
                  (row, index) =>
                    !row ||
                    row.rowNumber !== input.rowNumbers[index] ||
                    !row.input ||
                    typeof row.input !== 'object',
                )
              )
                throw new ConflictException({ code: 'INVALID_RECEIPT' });
            } else {
              const [options, customers] = await Promise.all([
                this.external.options(actor, tx, true),
                this.customers.listForCsv(actor, tx),
              ]);
              if (!options.canCreate)
                throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
              const currentRows = records.map((record) =>
                this.parseRow(record, options, customers, input.idempotencyKey),
              );
              const currentByNumber = new Map(
                currentRows.map((row) => [row.rowNumber, row]),
              );
              selected = selectedRecords.map((record) => {
                const parsed = currentByNumber.get(record.rowNumber)!;
                if (!parsed.valid || !parsed.input)
                  throw new BadRequestException({
                    code: 'CASE_CSV_ROW_INVALID',
                    details: {
                      rowNumber: record.rowNumber,
                      errors: parsed.errors,
                    },
                  });
                return { rowNumber: record.rowNumber, input: parsed.input };
              });
              await this.attachDuplicateCandidates(tx, actor, currentRows);
              const confirmations = new Map(
                input.duplicateConfirmations.map((value) => [
                  value.rowNumber,
                  value,
                ]),
              );
              for (const selectedRow of selected) {
                const row = currentByNumber.get(selectedRow.rowNumber)!;
                const expected = row.duplicateCandidates;
                const given = confirmations.get(row.rowNumber);
                if (
                  expected.cases.length === 0 &&
                  expected.rowNumbers.length === 0 &&
                  !given
                )
                  continue;
                if (
                  (expected.cases.length === 0 &&
                    expected.rowNumbers.length === 0) ||
                  !given ||
                  !this.sameIds(
                    given.caseIds,
                    expected.cases.map((item) => item.id),
                  ) ||
                  !this.sameNumbers(given.rowNumbers, expected.rowNumbers)
                )
                  throw new ConflictException({
                    code: 'CASE_CSV_DUPLICATES_CHANGED',
                    details: {
                      rowNumber: row.rowNumber,
                      duplicateCandidates: expected,
                    },
                  });
              }
            }
            const items = [] as CaseCsvCommitResultDto['items'];
            for (const row of selected) {
              const result = await this.external.createInTransaction(
                tx,
                actor,
                row.input,
              );
              items.push({ rowNumber: row.rowNumber, ...result });
            }
            if (prior) {
              const imported = await tx.caseCsvImportedRow.findMany({
                where: {
                  receiptId: prior.id,
                  departmentId: actor.departmentId,
                  fileFingerprint,
                },
                select: { rowNumber: true, caseId: true },
              });
              if (
                imported.length !== items.length ||
                imported.some(
                  (record) =>
                    !items.some(
                      (item) =>
                        item.rowNumber === record.rowNumber &&
                        item.id === record.caseId,
                    ),
                )
              )
                throw new ConflictException({ code: 'INVALID_RECEIPT' });
              return { items };
            }
            const receipt = await tx.caseCsvImportReceipt.create({
              data: {
                ...key,
                requestFingerprint,
                fileFingerprint,
                rowNumbers: input.rowNumbers,
                resultSnapshot: {
                  items: items.map((item) => ({ ...item })),
                  rowInputs: selected.map((row) => ({
                    rowNumber: row.rowNumber,
                    input: {
                      ...row.input,
                      known: { ...row.input.known },
                      defendants: row.input.defendants.map((party) => ({
                        ...party,
                      })),
                    },
                  })),
                  duplicateConfirmations: input.duplicateConfirmations.map(
                    (value) => ({ ...value }),
                  ),
                },
              },
              select: { id: true },
            });
            await tx.caseCsvImportedRow.createMany({
              data: items.map((item) => ({
                departmentId: actor.departmentId,
                fileFingerprint,
                rowNumber: item.rowNumber,
                caseId: item.id,
                receiptId: receipt.id,
              })),
            });
            return { items };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 30_000,
          },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          if (attempt < 2) continue;
          throw new ConflictException({
            code: 'CASE_CSV_ROW_ALREADY_IMPORTED',
          });
        }
        throw error;
      }
    }
    throw new ConflictException({ code: 'CASE_CSV_CONCURRENT_CONFLICT' });
  }

  private sameIds(
    actual: readonly string[],
    expected: readonly string[],
  ): boolean {
    if (actual.length !== expected.length) return false;
    const sorted = [...expected].sort();
    return [...actual].sort().every((value, index) => value === sorted[index]);
  }

  private sameNumbers(
    actual: readonly number[],
    expected: readonly number[],
  ): boolean {
    if (actual.length !== expected.length) return false;
    const sorted = [...expected].sort((a, b) => a - b);
    return [...actual]
      .sort((a, b) => a - b)
      .every((value, index) => value === sorted[index]);
  }

  private async attachDuplicateCandidates(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    rows: CaseCsvPreviewRowDto[],
  ): Promise<void> {
    const eligible = rows.filter(
      (row) =>
        row.valid && row.input?.known.courtId && row.input.known.courtCaseNo,
    );
    if (eligible.length === 0) return;
    const customerIds = [
      ...new Set(eligible.map((row) => row.input!.customerId)),
    ];
    const caseNos = [
      ...new Set(eligible.map((row) => row.input!.known.courtCaseNo!)),
    ];
    const existing = await tx.case.findMany({
      where: {
        departmentId: actor.departmentId,
        customerId: { in: customerIds },
        courtCaseNo: { in: caseNos },
      },
      select: {
        id: true,
        businessNo: true,
        customerId: true,
        courtCaseNo: true,
        externalEntry: { select: { known: true } },
        filingSubmission: { select: { courtId: true } },
        acceptance: { select: { courtId: true } },
      },
    });
    const byKey = new Map<string, CaseCsvDuplicateCandidatesDto['cases']>();
    for (const current of existing) {
      const known = current.externalEntry?.known;
      const externalCourtId =
        known &&
        typeof known === 'object' &&
        !Array.isArray(known) &&
        typeof known.courtId === 'string'
          ? known.courtId
          : null;
      const courtId =
        current.acceptance?.courtId ??
        current.filingSubmission?.courtId ??
        externalCourtId;
      if (!courtId || !current.courtCaseNo) continue;
      const key = JSON.stringify([
        current.customerId,
        courtId,
        current.courtCaseNo,
      ]);
      const bucket = byKey.get(key) ?? [];
      bucket.push({ id: current.id, businessNo: current.businessNo });
      byKey.set(key, bucket);
    }
    for (const bucket of byKey.values())
      bucket.sort(
        (a, b) =>
          a.businessNo.localeCompare(b.businessNo) || a.id.localeCompare(b.id),
      );
    for (const row of eligible) {
      const own = row.input!;
      const key = JSON.stringify([
        own.customerId,
        own.known.courtId,
        own.known.courtCaseNo,
      ]);
      row.duplicateCandidates = {
        cases: byKey.get(key) ?? [],
        rowNumbers: eligible
          .filter(
            (other) =>
              other.rowNumber !== row.rowNumber &&
              JSON.stringify([
                other.input!.customerId,
                other.input!.known.courtId,
                other.input!.known.courtCaseNo,
              ]) === key,
          )
          .map((other) => other.rowNumber)
          .sort((a, b) => a - b),
      };
    }
  }

  private parseRow(
    record: CaseCsvRecord,
    options: Options,
    customers: Customers,
    batchKey: string,
  ): CaseCsvPreviewRowDto {
    const errors: RowError[] = [];
    const duplicateCandidates: CaseCsvDuplicateCandidatesDto = {
      cases: [],
      rowNumbers: [],
    };
    const bad = (field: string, code: string, message: string) =>
      errors.push({ field, code, message });
    if (record.cells.length !== 22)
      bad('row', 'COLUMN_COUNT', '列数与模板不一致');
    const c = (index: number) => record.cells[index]?.trim() ?? '';
    const required = (index: number, field: string) => {
      const value = c(index);
      if (!value) bad(field, 'REQUIRED', `${field}必填`);
      return value;
    };
    const kind = named(required(0, '外录类型'), caseCsvLabels.entryKind);
    const stage = named(required(1, '当前阶段'), caseCsvLabels.stage);
    if (!kind) bad('外录类型', 'INVALID_ENUM', '外录类型无效');
    if (!stage) bad('当前阶段', 'INVALID_ENUM', '当前阶段无效');
    const stageReachedOn = required(2, '到达日期');
    const source = required(3, '来源');
    const reason = required(4, '原因');
    const customerCode = required(5, '客户编号');
    const matchingCustomers = customers.filter(
      (customer) => customer.businessId === customerCode,
    );
    if (matchingCustomers.length !== 1)
      bad(
        '客户编号',
        'CUSTOMER_NOT_UNIQUE',
        '当前权限内客户编号不存在或不唯一',
      );
    const holderName = required(6, '权利主体');
    const matchingHolders =
      matchingCustomers.length === 1
        ? matchingCustomers[0].rightsHolders.filter(
            (holder) => holder.name === holderName,
          )
        : [];
    if (matchingHolders.length !== 1)
      bad(
        '权利主体',
        'RIGHTS_HOLDER_NOT_UNIQUE',
        '该客户关联权利主体不存在或名称不唯一',
      );
    const defendantColumns = [7, 8, 9, 10, 11].map(
      (index) => record.cells[index] ?? '',
    );
    const defendants: CreateCaseExternalEntryDto['defendants'] = [];
    if (defendantColumns.some(Boolean)) {
      const lines = defendantColumns.map((value) =>
        value ? value.split(/\r\n|\n/u) : [],
      );
      const count = lines[1].length;
      if (
        count === 0 ||
        count > 20 ||
        lines.slice(0, 2).some((parts) => parts.length !== count) ||
        lines
          .slice(2)
          .some((parts) => parts.length !== 0 && parts.length !== count)
      )
        bad('被告', 'DEFENDANT_COLUMNS_MISALIGNED', '被告各列换行条数不一致');
      else
        for (let index = 0; index < count; index++) {
          const partKind = named(
            lines[0][index].trim(),
            caseCsvLabels.defendantKind,
          );
          const name = lines[1][index].trim();
          if (!partKind || !name) {
            bad(
              '被告',
              'DEFENDANT_INVALID',
              `第${index + 1}名被告类型或姓名无效`,
            );
            continue;
          }
          const extra = (column: number) =>
            lines[column][index]?.trim() || undefined;
          defendants.push({
            kind: partKind,
            name,
            ...(extra(2) ? { idNo: extra(2) } : {}),
            ...(extra(3) ? { phone: extra(3) } : {}),
            ...(extra(4) ? { address: extra(4) } : {}),
          });
        }
    }
    const lawyerName = c(12);
    const lawyers = lawyerName
      ? options.lawyers.filter((lawyer) => lawyer.fullName === lawyerName)
      : [];
    if (lawyerName && lawyers.length !== 1)
      bad('律师', 'LAWYER_NOT_UNIQUE', '当前可选律师不存在或姓名不唯一');
    const courtName = c(13);
    const courts = courtName
      ? options.dictionaries.courts.filter((court) => court.name === courtName)
      : [];
    if (courtName && courts.length !== 1)
      bad('法院', 'COURT_NOT_UNIQUE', '当前可选法院不存在或名称不唯一');
    const platform = c(17) ? named(c(17), caseCsvLabels.platform) : null;
    const caseType = c(20) ? named(c(20), caseCsvLabels.caseType) : null;
    if (c(17) && !platform) bad('平台', 'INVALID_ENUM', '平台无效');
    if (c(20) && !caseType) bad('案件类型', 'INVALID_ENUM', '案件类型无效');
    const infringementTypes = c(21)
      ? c(21)
          .split('；')
          .map((value) => named(value.trim(), caseCsvLabels.infringement))
      : null;
    if (
      infringementTypes?.some((value) => !value) ||
      (infringementTypes &&
        new Set(infringementTypes).size !== infringementTypes.length)
    )
      bad(
        '侵权类型',
        'INVALID_ENUM',
        '侵权类型无效或重复；多个类型使用中文分号',
      );
    if (stage === 'PENDING_MATCH' && (defendants.length > 0 || lawyerName))
      bad('被告', 'PENDING_MATCH_PARTIES', '待匹配阶段不能填写被告或律师');
    if (stage === 'ARCHIVED' && !options.canCreateArchived)
      bad('当前阶段', 'ARCHIVE_FORBIDDEN', '无权创建已归档外录案件');
    if (
      errors.length > 0 ||
      !kind ||
      !stage ||
      matchingCustomers.length !== 1 ||
      matchingHolders.length !== 1
    )
      return {
        rowNumber: record.rowNumber,
        valid: false,
        errors,
        duplicateCandidates,
      };
    const input: CreateCaseExternalEntryDto = {
      idempotencyKey: createHash('sha256')
        .update(JSON.stringify({ batchKey, rowNumber: record.rowNumber }))
        .digest('hex'),
      entryKind: kind,
      initialStage: stage,
      stageReachedOn,
      source,
      reason,
      customerId: matchingCustomers[0].id,
      rightsHolderId: matchingHolders[0].id,
      defendants,
      lawyerAccountId: lawyers[0]?.accountId ?? null,
      lawyerProfileId: lawyers[0]?.profileId ?? null,
      known: {
        courtId: courts[0]?.id ?? null,
        courtCaseNo: c(14) || null,
        acceptedOn: c(15) || null,
        secondInstanceAcceptedOn: c(16) || null,
        platform,
        shopName: c(18) || null,
        shopExternalId: c(19) || null,
        caseType,
        infringementTypes: infringementTypes as NonNullable<
          CreateCaseExternalEntryDto['known']['infringementTypes']
        > | null,
      },
    };
    try {
      this.external.validateInput(input);
    } catch {
      bad('row', 'EXTERNAL_ENTRY_INVALID', '字段或日期不符合单案外录规则');
    }
    return errors.length > 0
      ? {
          rowNumber: record.rowNumber,
          valid: false,
          errors,
          duplicateCandidates,
        }
      : {
          rowNumber: record.rowNumber,
          valid: true,
          errors,
          input,
          duplicateCandidates,
        };
  }
}
