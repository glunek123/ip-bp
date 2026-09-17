import { createIdentityAdapterFromEnvironment } from './identity-adapter.factory';

const fixtureJson = JSON.stringify({
  'fixture-token': {
    userId: '20000000-0000-4000-8000-000000000001',
    departmentId: '10000000-0000-4000-8000-000000000001',
    authorizationRevision: 1,
  },
});

describe('createIdentityAdapterFromEnvironment', () => {
  it('keeps synthetic identities disabled outside the test environment', async () => {
    const adapter = createIdentityAdapterFromEnvironment({
      NODE_ENV: 'production',
      E2E_IDENTITY_FIXTURES: fixtureJson,
    });

    expect(await adapter.resolve('fixture-token')).toBeNull();
  });

  it('resolves explicitly configured identities in the test environment', async () => {
    const adapter = createIdentityAdapterFromEnvironment({
      NODE_ENV: 'test',
      E2E_IDENTITY_FIXTURES: fixtureJson,
    });

    expect(await adapter.resolve('fixture-token')).toEqual({
      userId: '20000000-0000-4000-8000-000000000001',
      departmentId: '10000000-0000-4000-8000-000000000001',
      authorizationRevision: 1,
    });
    expect(await adapter.resolve('unknown')).toBeNull();
  });

  it('rejects malformed test identity fixtures instead of weakening authentication', () => {
    expect(() =>
      createIdentityAdapterFromEnvironment({
        NODE_ENV: 'test',
        E2E_IDENTITY_FIXTURES: '{"fixture-token":{"userId":3}}',
      }),
    ).toThrow('E2E_IDENTITY_FIXTURES');
  });
});
