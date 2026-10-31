import { Prisma } from '../../generated/prisma/client';
import {
  calculateSettlement,
  SETTLEMENT_V1,
  SETTLEMENT_V2,
} from '../settlements';
import { settlementSqlDifferentialVectors } from './case-archive-settlement-formula-subset.fixtures';
type DifferentialRow = {
  unsupported: boolean;
  customer_amount: string | null;
  lawyer_amount: string | null;
  customer_source: string | null;
  lawyer_source: string | null;
};
/** Dormant differential harness, NOT executed in this task. A future explicitly
 * authorized isolated PostgreSQL test runner must apply the exact draft migration
 * chain and supply its query callback. This function never opens a connection,
 * reads credentials, applies migrations or relaxes any write gate.
 * It compares SQL to the same TS vectors, taking numeric outputs as TEXT to avoid
 * JSON/JavaScript precision loss. The first mismatch throws, never certifies PASS.
 */
export async function verifySettlementSqlDifferential(
  query: (
    sql: string,
    values: readonly unknown[],
  ) => Promise<readonly DifferentialRow[]>,
): Promise<number> {
  for (const version of [SETTLEMENT_V1, SETTLEMENT_V2] as const) {
    for (const vector of settlementSqlDifferentialVectors) {
      const rows = await query(
        `WITH checked AS (SELECT ${version === SETTLEMENT_V1 ? 'archive_verified_settlement_outputs' : 'archive_verified_settlement_outputs_v2'}($1::jsonb) AS result)
      SELECT result IS NULL AS unsupported,result->>'customerAmount' AS customer_amount,
      result->>'lawyerAmount' AS lawyer_amount,result->>'customerSource' AS customer_source,
      result->>'lawyerSource' AS lawyer_source FROM checked`,
        [JSON.stringify(vector.input)],
      );
      const actual = rows[0];
      if (rows.length !== 1 || !actual)
        throw new Error(`SQL_DIFFERENTIAL_ROW:${vector.name}`);
      if (!vector.subset) {
        if (!actual.unsupported)
          throw new Error(`SQL_SUBSET_BROADENED:${vector.name}`);
        continue;
      }
      const expected = calculateSettlement(vector.input, version);
      const normalized = (value: string | null) =>
        value === null ? null : new Prisma.Decimal(value).toFixed(2);
      if (
        actual.unsupported ||
        normalized(actual.customer_amount) !== expected.customerAmount ||
        normalized(actual.lawyer_amount) !== expected.lawyerAmount ||
        actual.customer_source !== expected.customerSource ||
        actual.lawyer_source !== expected.lawyerSource
      )
        throw new Error(`SQL_CALCULATOR_DIFFERENCE:${vector.name}`);
    }
  }
  return settlementSqlDifferentialVectors.length * 2;
}
