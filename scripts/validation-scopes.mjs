const scope = (level, commands) =>
  Object.freeze({
    level,
    commands: Object.freeze(commands.map((command) => Object.freeze(command))),
  });

export const validationScopes = Object.freeze({
  customer: scope('L2', [
    { id: 'prepare:prisma', args: ['prepare:prisma'] },
    { id: 'test:unit:customer', args: ['test:unit:customer'] },
    { id: 'check:fast:prepared', args: ['check:fast:prepared'] },
    {
      id: 'format:check:slice:customer',
      args: ['format:check:slice:customer'],
    },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    {
      id: 'test:e2e:customer',
      args: ['test:e2e:customer'],
      testEnvironment: true,
    },
  ]),
  'right-holder': scope('L2', [
    { id: 'prepare:prisma', args: ['prepare:prisma'] },
    { id: 'test:unit:right-holder', args: ['test:unit:right-holder'] },
    { id: 'check:fast:prepared', args: ['check:fast:prepared'] },
    {
      id: 'format:check:slice:right-holder',
      args: ['format:check:slice:right-holder'],
    },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    {
      id: 'test:e2e:right-holder',
      args: ['test:e2e:right-holder'],
      testEnvironment: true,
    },
  ]),
  'auth-focused': scope('L3', [
    { id: 'prepare:prisma', args: ['prepare:prisma'] },
    { id: 'test:unit:auth', args: ['test:unit:auth'] },
    { id: 'check:fast:prepared', args: ['check:fast:prepared'] },
    { id: 'format:check:slice:auth', args: ['format:check:slice:auth'] },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    {
      id: 'test:e2e:auth',
      args: ['test:e2e:auth'],
      testEnvironment: true,
    },
  ]),
  'core-ld': scope('L3', [
    { id: 'prepare:prisma', args: ['prepare:prisma'] },
    { id: 'test:unit:core-ld', args: ['test:unit:core-ld'] },
    { id: 'check:fast:prepared', args: ['check:fast:prepared'] },
    {
      id: 'format:check:slice:core-ld',
      args: ['format:check:slice:core-ld'],
    },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    {
      id: 'test:e2e:core-ld',
      args: ['test:e2e:core-ld'],
      testEnvironment: true,
    },
  ]),
});

export function validationScope(name) {
  const configured = validationScopes[name];
  if (!configured) throw new Error(`Unknown validation scope: ${name}`);
  return configured;
}
