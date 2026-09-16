import { TestIdentityAdapter } from './test-identity.adapter';

describe('TestIdentityAdapter', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('is impossible to construct outside the test environment', () => {
    process.env.NODE_ENV = 'production';

    expect(() => new TestIdentityAdapter()).toThrow(
      'Test identity adapter is disabled outside NODE_ENV=test',
    );
  });

  it('returns an explicitly registered synthetic actor in tests', () => {
    process.env.NODE_ENV = 'test';
    const adapter = new TestIdentityAdapter();
    adapter.register('synthetic-token', {
      userId: 'user-a',
      departmentId: 'department-a',
      authorizationRevision: 4,
    });

    expect(adapter.resolve('synthetic-token')).toEqual({
      userId: 'user-a',
      departmentId: 'department-a',
      authorizationRevision: 4,
    });
    expect(adapter.resolve('missing-token')).toBeNull();
  });
});
