import {
  ApiError,
  getJson,
  requestJson,
  setCsrfToken,
  setSessionIdentity,
} from './http';

export type DepartmentChoice = { id: string; name: string };
export type AuthSession = {
  user: { id: string; displayName: string; username: string };
  department: DepartmentChoice;
  departments: DepartmentChoice[];
  authorizationRevision: number;
  expiresAt: string;
  csrfToken: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.department))
    throw new ApiError('服务返回了无效的登录信息', 200, 'INVALID_RESPONSE');
  const session = value as unknown as AuthSession;
  if (
    typeof session.user.id !== 'string' ||
    typeof session.user.displayName !== 'string' ||
    typeof session.user.username !== 'string' ||
    typeof session.department.id !== 'string' ||
    typeof session.department.name !== 'string' ||
    !Array.isArray(session.departments) ||
    !session.departments.every(
      (department) =>
        typeof department?.id === 'string' &&
        typeof department?.name === 'string',
    ) ||
    typeof session.authorizationRevision !== 'number' ||
    typeof session.expiresAt !== 'string' ||
    typeof session.csrfToken !== 'string'
  )
    throw new ApiError('服务返回了无效的登录信息', 200, 'INVALID_RESPONSE');
  setCsrfToken(session.csrfToken);
  setSessionIdentity(session.user.id);
  return session;
}

export async function login(
  username: string,
  password: string,
  departmentId?: string,
): Promise<AuthSession> {
  return parseSession(
    await requestJson('/auth/login', {
      method: 'POST',
      body: { username, password, ...(departmentId ? { departmentId } : {}) },
    }),
  );
}

export async function getSession(): Promise<AuthSession> {
  return parseSession(await getJson('/auth/session'));
}

export async function logout(): Promise<void> {
  await requestJson('/auth/logout', { method: 'POST' });
  setCsrfToken(null);
  setSessionIdentity(null);
}
