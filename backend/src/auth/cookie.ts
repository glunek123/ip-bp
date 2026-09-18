export const SESSION_COOKIE_NAME = 'dev_cor_session';
export const CSRF_COOKIE_NAME = 'dev_cor_csrf';

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`;
}

export function csrfCookie(value: string, secure: boolean): string {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(value)}; SameSite=Lax; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function clearCsrfCookie(secure: boolean): string {
  return `${CSRF_COOKIE_NAME}=; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
