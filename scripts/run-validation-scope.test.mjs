import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validationScopes } from './validation-scopes.mjs';
import { runValidationScope } from './run-validation-scope.mjs';

test('scope owns the exact commands and canonical evidence identifiers', async () => {
  const executed = [];
  let recorded;

  await runValidationScope('C:/repo', 'right-holder', {
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
    execute: async (command) => executed.push(command),
    record: (_root, scopeName, environment) => {
      recorded = { scopeName, environment };
      return { tree: 'tree' };
    },
  });

  assert.deepEqual(executed, validationScopes['right-holder'].commands);
  assert.deepEqual(recorded, {
    scopeName: 'right-holder',
    environment: {
      nodeVersion: 'v24.21.0',
      pnpmVersion: '11.27.0',
    },
  });
  const ids = validationScopes['right-holder'].commands.map(({ id }) => id);
  assert.ok(ids.includes('build:backend:prepared'));
  assert.ok(!ids.includes('build:prepared'));
});

test('failed command stops the scope and never records evidence', async () => {
  const executed = [];
  let recordCalls = 0;

  await assert.rejects(
    runValidationScope('C:/repo', 'customer', {
      nodeVersion: 'v24.21.0',
      pnpmVersion: '11.27.0',
      execute: async (command) => {
        executed.push(command.id);
        if (command.id === 'check:fast') throw new Error('failed');
      },
      record: () => {
        recordCalls += 1;
      },
    }),
    /failed/,
  );

  assert.deepEqual(executed, ['test:unit:customer', 'check:fast']);
  assert.equal(recordCalls, 0);
});

test('unknown validation scope is rejected', async () => {
  await assert.rejects(
    runValidationScope('C:/repo', 'made-up', {
      execute: async () => {},
      record: () => {},
      nodeVersion: 'v24.21.0',
      pnpmVersion: '11.27.0',
    }),
    /Unknown validation scope/,
  );
});
