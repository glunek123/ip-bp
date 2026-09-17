import { ActorContext } from './actor-context';
import {
  IdentityAdapter,
  UnavailableIdentityAdapter,
} from './identity.adapter';
import { TestIdentityAdapter } from './test-identity.adapter';

type IdentityEnvironment = {
  NODE_ENV?: string;
  E2E_IDENTITY_FIXTURES?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseActor(value: unknown): ActorContext | null {
  if (!isRecord(value)) return null;
  const { userId, departmentId, authorizationRevision } = value;
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof departmentId !== 'string' ||
    departmentId.length === 0 ||
    !Number.isInteger(authorizationRevision) ||
    (authorizationRevision as number) < 1
  ) {
    return null;
  }
  return {
    userId,
    departmentId,
    authorizationRevision: authorizationRevision as number,
  };
}

export function createIdentityAdapterFromEnvironment(
  environment: IdentityEnvironment,
): IdentityAdapter {
  const fixtures = environment.E2E_IDENTITY_FIXTURES;
  if (environment.NODE_ENV !== 'test' || fixtures === undefined) {
    return new UnavailableIdentityAdapter();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fixtures);
  } catch {
    throw new Error('E2E_IDENTITY_FIXTURES must be valid JSON');
  }
  if (!isRecord(parsed)) {
    throw new Error('E2E_IDENTITY_FIXTURES must contain an identity map');
  }

  const adapter = new TestIdentityAdapter();
  for (const [token, value] of Object.entries(parsed)) {
    const actor = parseActor(value);
    if (token.length === 0 || actor === null) {
      throw new Error('E2E_IDENTITY_FIXTURES contains an invalid identity');
    }
    adapter.register(token, actor);
  }
  return adapter;
}
