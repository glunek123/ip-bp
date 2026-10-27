import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type NumberTransaction = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

function numberNotInitialized(): ConflictException {
  return new ConflictException({
    code: 'CUSTOMER_NUMBER_NOT_INITIALIZED',
    message: '客户编号尚未初始化',
  });
}

export async function assertReadyCustomerBusinessId(
  tx: NumberTransaction,
  businessId: string | null,
): Promise<void> {
  if (businessId === null || !/^\d{3,}$/u.test(businessId))
    throw numberNotInitialized();
  const rows = await tx.$queryRawUnsafe<Array<{ last_value: bigint }>>(
    `SELECT "last_value" FROM "customer_business_number_counters"
     WHERE "singleton_id" = 1`,
  );
  if (rows.length !== 1 || BigInt(rows[0]!.last_value) < 0n)
    throw numberNotInitialized();
}

export function formatCustomerBusinessId(value: bigint): string {
  if (value < 1n)
    throw new Error('Customer business sequence must be positive');
  return value.toString().padStart(3, '0');
}

export async function allocateCustomerBusinessId(
  tx: NumberTransaction,
): Promise<string> {
  const rows = await tx.$queryRawUnsafe<Array<{ last_value: bigint }>>(
    `UPDATE "customer_business_number_counters"
       SET "last_value" = "last_value" + 1
     WHERE "singleton_id" = 1 AND "last_value" >= 0
     RETURNING "last_value"`,
  );
  if (rows.length !== 1) throw numberNotInitialized();
  return formatCustomerBusinessId(BigInt(rows[0]!.last_value));
}

export async function allocateCustomerDailyNumber(
  tx: NumberTransaction,
  input: Readonly<{ customerId: string; businessId: string | null }>,
): Promise<string> {
  await assertReadyCustomerBusinessId(tx, input.businessId);
  const rows = await tx.$queryRawUnsafe<
    Array<{ sequence: bigint; business_date: Date | string }>
  >(
    `INSERT INTO "customer_daily_number_counters" ("customer_id", "business_date", "last_value")
     VALUES ($1::uuid, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date, 1)
     ON CONFLICT ("customer_id", "business_date") DO UPDATE
       SET "last_value" = "customer_daily_number_counters"."last_value" + 1
     RETURNING "last_value" AS "sequence", "business_date"`,
    input.customerId,
  );
  const row = rows[0];
  if (!row || BigInt(row.sequence) < 1n)
    throw new Error('Daily number allocation failed');
  const date =
    row.business_date instanceof Date
      ? row.business_date.toISOString().slice(0, 10)
      : String(row.business_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date))
    throw new Error('Invalid business date');
  return `${input.businessId}${date.replaceAll('-', '')}${BigInt(row.sequence).toString().padStart(3, '0')}`;
}

export async function resolveHistoricalNumber(
  tx: Pick<Prisma.TransactionClient, 'businessNumberAlias'>,
  input: Readonly<{
    entityType: 'LEAD' | 'CASE';
    entityId: string;
    receiptNumber: string;
    currentNumber: string;
  }>,
): Promise<boolean> {
  if (input.receiptNumber === input.currentNumber) return true;
  const alias = await tx.businessNumberAlias.findUnique({
    where: {
      entityType_entityId: {
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    select: { oldNumber: true },
  });
  return alias?.oldNumber === input.receiptNumber;
}
