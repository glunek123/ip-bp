import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const rootEnv = resolve(root, '.env');
if (!existsSync(rootEnv)) {
  writeFileSync(
    rootEnv,
    `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nPOSTGRES_TEST_PASSWORD=${randomBytes(24).toString('hex')}\n`,
    { flag: 'wx', mode: 0o600 },
  );
}
const values = parseEnv(readFileSync(rootEnv, 'utf8'));
for (const key of ['POSTGRES_PASSWORD', 'POSTGRES_TEST_PASSWORD']) {
  if (!/^[a-f0-9]{48}$/.test(values[key] ?? '')) {
    throw new Error(
      `${key} must be a 48-character random hexadecimal local password. Existing configuration was preserved.`,
    );
  }
}
const configs = [
  [
    'backend/.env',
    'development',
    3000,
    'dev_cor',
    55432,
    values.POSTGRES_PASSWORD,
  ],
  [
    'backend/.env.test',
    'test',
    3101,
    'dev_cor_test',
    55433,
    values.POSTGRES_TEST_PASSWORD,
  ],
];
for (const [file, mode, port, database, dbPort, password] of configs) {
  const target = resolve(root, file);
  const url = `postgresql://${database}:${password}@127.0.0.1:${dbPort}/${database}`;
  if (existsSync(target)) {
    const current = parseEnv(readFileSync(target, 'utf8'));
    if (
      current.DATABASE_URL !== url ||
      current.NODE_ENV !== mode ||
      current.PORT !== String(port)
    ) {
      throw new Error(
        `${file} differs from the local Compose configuration. Existing file was preserved; reconcile it before continuing.`,
      );
    }
  } else {
    writeFileSync(
      target,
      `NODE_ENV=${mode}\nPORT=${port}\nDATABASE_URL=${url}\n`,
      { flag: 'wx', mode: 0o600 },
    );
  }
}
console.log(
  'Local development and isolated test configuration ready. Existing files preserved; no secrets printed.',
);
