import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = process.cwd();
const requireProject = createRequire(resolve(root, 'package.json'));
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { validateBrowserTestDatabaseUrl } = requireProject(
  './scripts/test-environment.mjs',
);
const { Client } = requireBackend('pg');
const syntheticDepartmentId = '10000000-0000-4000-8000-000000000001';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function withLitigationRefundCommitFault(caseId, callback) {
  if (process.env.NODE_ENV !== 'test' || !uuid.test(caseId))
    throw new Error(
      'Litigation refund fault requires a synthetic test case UUID',
    );
  const target = validateBrowserTestDatabaseUrl(process.env.DATABASE_URL, root);
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== 15433 ||
    target.database !== 'dev_cor_test' ||
    target.username !== 'dev_cor_test'
  )
    throw new Error(
      'Litigation refund fault requires the standard test database',
    );

  const name = `litigation_refund_fault_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: target.connectionString });
  let functionCreated = false;
  let triggerCreated = false;
  let result;
  let operationError;
  const cleanupErrors = [];
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS database, current_schema() AS schema, current_user AS username',
      )
    ).rows[0];
    if (
      identity.database !== 'dev_cor_test' ||
      identity.schema !== 'public' ||
      identity.username !== 'dev_cor_test'
    )
      throw new Error('Litigation refund fault database identity differs');
    const ownedCase = (
      await client.query('SELECT department_id FROM cases WHERE id=$1::uuid', [
        caseId,
      ])
    ).rows[0];
    if (ownedCase?.department_id !== syntheticDepartmentId)
      throw new Error(
        'Litigation refund fault target is outside synthetic department A',
      );

    await client.query(`
      CREATE FUNCTION public."${name}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.case_id='${caseId}'::uuid AND
           NEW.department_id='${syntheticDepartmentId}'::uuid THEN
          RAISE EXCEPTION 'litigation refund injected commit fault' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $$`);
    functionCreated = true;
    await client.query(`
      CREATE CONSTRAINT TRIGGER "${name}"
      AFTER INSERT ON public.case_litigation_refund_commands
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public."${name}"()`);
    triggerCreated = true;
    result = await callback();
  } catch (error) {
    operationError = error;
  } finally {
    try {
      if (triggerCreated)
        await client.query(
          `DROP TRIGGER "${name}" ON public.case_litigation_refund_commands`,
        );
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (functionCreated)
        await client.query(`DROP FUNCTION public."${name}"()`);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await client.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (operationError && cleanupErrors.length)
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      'Litigation refund fault and cleanup failed',
    );
  if (operationError) throw operationError;
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      'Litigation refund fault cleanup failed',
    );
  return result;
}
