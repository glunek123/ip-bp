const scope = (level, commands) =>
  Object.freeze({
    level,
    commands: Object.freeze(commands.map((command) => Object.freeze(command))),
  });

export const validationScopes = Object.freeze({
  customer: scope('L2', [
    { id: 'test:unit:customer', args: ['test:unit:customer'] },
    { id: 'check:fast', args: ['check:fast'] },
    {
      id: 'format:check:slice:customer',
      args: ['format:check:slice:customer'],
    },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    { id: 'test:e2e:customer', args: ['test:e2e:customer'] },
  ]),
  'right-holder': scope('L2', [
    { id: 'test:unit:right-holder', args: ['test:unit:right-holder'] },
    { id: 'check:fast', args: ['check:fast'] },
    {
      id: 'format:check:slice:right-holder',
      args: ['format:check:slice:right-holder'],
    },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    { id: 'test:e2e:right-holder', args: ['test:e2e:right-holder'] },
  ]),
  'auth-focused': scope('L3', [
    { id: 'test:unit:auth', args: ['test:unit:auth'] },
    { id: 'check:fast', args: ['check:fast'] },
    { id: 'format:check:slice:auth', args: ['format:check:slice:auth'] },
    {
      id: 'build:backend:prepared',
      args: ['--filter', '@dev-cor/backend', 'build:prepared'],
    },
    { id: 'test:e2e:auth', args: ['test:e2e:auth'] },
  ]),
});

export function validationScope(name) {
  const configured = validationScopes[name];
  if (!configured) throw new Error(`Unknown validation scope: ${name}`);
  return configured;
}
