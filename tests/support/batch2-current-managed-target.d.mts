export interface Batch2Current269Environment {
  NODE_ENV?: string;
  BATCH2_CURRENT_269_SCOPE?: string;
  DEV_COR_TEST_DATABASE_PROJECT?: string;
  DEV_COR_TEST_DATABASE_CONTAINER_ID?: string;
  DEV_COR_TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
}

export function isBatch2Current269(
  environment?: Batch2Current269Environment,
): boolean;

export function assertBatch2Current269Target(
  environment?: Batch2Current269Environment,
  root?: string,
): string;
