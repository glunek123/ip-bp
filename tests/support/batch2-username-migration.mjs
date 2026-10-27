import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertBatch2UsernameTarget } from './batch2-username-guard.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { AuthService } = requireBackend('./dist/auth/auth.service.js');
const { hashPassword } = requireBackend('./dist/auth/password.js');
const directory = resolve(root, 'backend/prisma/migrations');
const previous = '20261026150000_v6_fee_cancellation';
const current = '20261027010000_expand_local_username_format';
const migrations = readdirSync(directory)
  .filter((name) => /^\d{14}_/u.test(name) && name <= current)
  .sort();

function check(value, message) {
  if (!value) throw new Error(message);
}

async function insertCredential(
  client,
  username,
  passwordHash = 'migration-fixture-only',
) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
    [id, `local:${id}`, '用户名迁移合成账号'],
  );
  await client.query(
    'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
    [randomUUID(), id, username, passwordHash],
  );
  return id;
}

async function expectRejected(client, username, code) {
  await client.query('SAVEPOINT username_invalid');
  let error;
  try {
    await insertCredential(client, username);
  } catch (failure) {
    error = failure;
  }
  await client.query('ROLLBACK TO SAVEPOINT username_invalid');
  await client.query('RELEASE SAVEPOINT username_invalid');
  check(
    error?.code === code,
    `${JSON.stringify(username)} expected SQLSTATE ${code}`,
  );
}

export async function verifyBatch2UsernameMigration() {
  const url = assertBatch2UsernameTarget();
  check(migrations.length === 185, 'Expected the exact 185-migration chain');
  check(
    migrations.at(-2) === previous && migrations.at(-1) === current,
    'Username migration boundary changed',
  );
  const schema = `bu_${randomUUID().replaceAll('-', '')}`;
  check(/^bu_[a-f0-9]{32}$/u.test(schema), 'Invalid owned schema');
  const quoted = `"${schema}"`;
  const client = new Client({ connectionString: url });
  let connected = false;
  let created = false;
  let primaryError;
  let result;
  try {
    await client.connect();
    connected = true;
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    check(
      identity.db === 'dev_cor_test' && identity.schema === 'public',
      'Unexpected database namespace',
    );
    await client.query(`CREATE SCHEMA ${quoted}`);
    created = true;
    await client.query(`SET search_path TO ${quoted}`);
    for (const name of migrations.slice(0, -1))
      await client.query(
        readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'),
      );

    const legacyPassword = 'Legacy-user-pass-2026!';
    const legacyId = await insertCredential(
      client,
      'legacy.user',
      await hashPassword(legacyPassword),
    );
    const departmentId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
      [departmentId, '用户名升级合成部门'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
      [randomUUID(), legacyId, departmentId],
    );
    const before = (
      await client.query(
        'SELECT username FROM local_credentials WHERE user_id=$1',
        [legacyId],
      )
    ).rows[0].username;
    const uniqueBefore = (
      await client.query(
        `SELECT count(*)::int AS count FROM pg_indexes
      WHERE schemaname=$1 AND tablename='local_credentials' AND indexname='local_credentials_username_key'`,
        [schema],
      )
    ).rows[0].count;
    check(uniqueBefore === 1, 'Previous username unique index missing');

    await client.query(
      readFileSync(resolve(directory, current, 'migration.sql'), 'utf8'),
    );
    check(
      (
        await client.query(
          'SELECT username FROM local_credentials WHERE user_id=$1',
          [legacyId],
        )
      ).rows[0].username === before,
      'Migration rewrote the legacy username',
    );
    const scopedUrl = new URL(url);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    const prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: scopedUrl.toString() },
        { schema },
      ),
    });
    let legacyLoginUsername;
    try {
      const auth = new AuthService(prisma, {
        getOrThrow: () => 'a'.repeat(64),
      });
      const login = await auth.login(
        { username: ' LEGACY.USER ', password: legacyPassword },
        '127.0.0.1',
      );
      legacyLoginUsername = login.view.user.username;
    } finally {
      await prisma.$disconnect();
    }
    check(
      legacyLoginUsername === 'legacy.user',
      'Preserved legacy row cannot log in',
    );
    await client.query('BEGIN');
    await insertCredential(client, 'user+tag@example.com');
    await insertCredential(client, '自定义 用户');
    await insertCredential(client, '😀'.repeat(64));
    await insertCredential(client, 'admin.user');
    await expectRejected(client, 'user+tag@example.com', '23505');
    for (const value of [
      '',
      'ab',
      'a'.repeat(65),
      'ab\ncd',
      '\tadmin',
      'admin\u200b',
      'admin\u202e',
    ])
      await expectRejected(client, value, '23514');
    const uniqueAfter = (
      await client.query(
        `SELECT count(*)::int AS count FROM pg_indexes
      WHERE schemaname=$1 AND tablename='local_credentials' AND indexname='local_credentials_username_key'`,
        [schema],
      )
    ).rows[0].count;
    check(uniqueAfter === 1, 'Username unique index did not survive');
    result = {
      migrationCount: 185,
      legacyUsername: before,
      legacyLoginUsername,
      uniqueIndexRetained: true,
    };
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  if (connected) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (created) {
      try {
        await client.query('RESET search_path');
        await client.query(`DROP SCHEMA ${quoted} CASCADE`);
        const remains = (
          await client.query(
            'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1',
            [schema],
          )
        ).rows[0].count;
        check(remains === 0, 'Owned schema remains');
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await client.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (primaryError && cleanupErrors.length)
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Migration check and cleanup failed',
    );
  if (primaryError) throw primaryError;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Migration cleanup failed');
  return result;
}
