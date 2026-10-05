import {
  ApiError,
  getJson,
  requestJson,
  setCsrfToken,
  setSessionIdentity,
} from './http';

export type DepartmentChoice = { id: string; name: string };
export type NotaryOfficeChoice = { id: string; name: string };
export type AuthSession = {
  principalType: 'INTERNAL' | 'CLIENT' | 'NOTARY' | 'LAWYER';
  user: { id: string; displayName: string; username: string };
  department: DepartmentChoice | null;
  departments: DepartmentChoice[];
  customer: { id: string; name: string } | null;
  notaryOffice: NotaryOfficeChoice | null;
  authorizationRevision: number;
  expiresAt: string;
  csrfToken: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSession(value: unknown): AuthSession {
  if (!isRecord(value) || !isRecord(value.user))
    throw new ApiError('服务返回了无效的登录信息', 200, 'INVALID_RESPONSE');
  const session = value as unknown as AuthSession;
  const validDepartment =
    session.department === null ||
    (isRecord(session.department) &&
      typeof session.department.id === 'string' &&
      typeof session.department.name === 'string');
  const validCustomer =
    session.customer === null ||
    (isRecord(session.customer) &&
      typeof session.customer.id === 'string' &&
      typeof session.customer.name === 'string');
  const validNotaryOffice =
    session.notaryOffice === null ||
    (isRecord(session.notaryOffice) &&
      typeof session.notaryOffice.id === 'string' &&
      typeof session.notaryOffice.name === 'string');
  if (
    (session.principalType !== 'INTERNAL' &&
      session.principalType !== 'CLIENT' &&
      session.principalType !== 'NOTARY' &&
      session.principalType !== 'LAWYER') ||
    typeof session.user.id !== 'string' ||
    typeof session.user.displayName !== 'string' ||
    typeof session.user.username !== 'string' ||
    !validDepartment ||
    !Array.isArray(session.departments) ||
    !session.departments.every(
      (department) =>
        typeof department?.id === 'string' &&
        typeof department?.name === 'string',
    ) ||
    typeof session.authorizationRevision !== 'number' ||
    typeof session.expiresAt !== 'string' ||
    typeof session.csrfToken !== 'string' ||
    !validCustomer ||
    !validNotaryOffice ||
    (session.principalType === 'INTERNAL' &&
      (session.department === null || session.customer !== null)) ||
    (session.principalType === 'CLIENT' &&
      (session.department !== null ||
        session.customer === null ||
        session.notaryOffice !== null)) ||
    (session.principalType === 'NOTARY' &&
      (session.department !== null ||
        session.departments.length !== 0 ||
        session.customer !== null ||
        session.notaryOffice === null)) ||
    (session.principalType === 'LAWYER' &&
      (session.department !== null ||
        session.departments.length !== 0 ||
        session.customer !== null ||
        session.notaryOffice !== null))
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
