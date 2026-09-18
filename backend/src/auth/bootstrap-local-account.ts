import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { bootstrapLocalAccount } from './bootstrap-local-account.service';
import {
  assertSafeBootstrapDatabaseTarget,
  parseBootstrapOptions,
} from './bootstrap-local-account-target';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '');
  }
  process.stdout.write('密码（输入不会显示）: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = '';
  try {
    for await (const chunk of process.stdin) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          process.stdout.write('\n');
          return password;
        }
        if (character === '\u0003') throw new Error('Bootstrap cancelled');
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
        } else {
          password += character;
        }
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  return password;
}

async function main(): Promise<void> {
  const logger = new Logger('AuthSecurity');
  const options = parseBootstrapOptions(process.argv.slice(2));
  assertSafeBootstrapDatabaseTarget({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    expectedHost: options.expectedHost,
    expectedPort: options.expectedPort,
    expectedDatabase: options.expectedDatabase,
  });
  const password = await readPassword();
  const database = new DatabaseService(new ConfigService(process.env));
  try {
    const result = await bootstrapLocalAccount(database, {
      departmentName: options.departmentName,
      username: options.username,
      displayName: options.displayName,
      password,
    });
    console.log(
      `Local account initialized for ${result.username} in ${result.departmentName}.`,
    );
    logger.log({ event: 'auth_bootstrap_succeeded' });
  } finally {
    await database.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const logger = new Logger('AuthSecurity');
  const message = error instanceof Error ? error.message : 'Bootstrap failed';
  logger.warn({ event: 'auth_bootstrap_failed', code: message });
  console.error(`Local account bootstrap failed: ${message}`);
  process.exitCode = 1;
});
