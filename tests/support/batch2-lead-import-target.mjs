export function assertBatch2ImportTarget() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.BATCH2_IMPORT_E2E_READY !== '1'
  ) {
    throw new Error('Batch-2 owned acceptance environment is not ready');
  }
  const value = process.env.BATCH2_IMPORT_DATABASE_URL;
  if (!value || value !== process.env.DATABASE_URL)
    throw new Error('Batch-2 database target mismatch');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '15440' ||
    url.pathname !== '/dev_cor_test' ||
    url.username !== 'dev_cor_test' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Batch-2 target must be the exact owned loopback database');
  }
  if (
    process.env.DEV_COR_TEST_DATABASE_URL !== value ||
    process.env.DEV_COR_TEST_DATABASE_PROJECT !==
      'dev-cor-ops-batch2-20261027' ||
    !/^[a-f0-9]{64}$/u.test(
      process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID ?? '',
    )
  ) {
    throw new Error(
      'Batch-2 target requires its owned Compose container binding',
    );
  }
  return value;
}
