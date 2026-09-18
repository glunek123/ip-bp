import {
  clearCsrfCookie,
  clearSessionCookie,
  csrfCookie,
  readCookie,
  sessionCookie,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from './cookie';

describe('auth cookie serialization', () => {
  it('marks every cookie Secure when the deployment requires it', () => {
    expect(sessionCookie('session-value', true)).toContain('; Secure');
    expect(csrfCookie('csrf-value', true)).toContain('; Secure');
    expect(clearSessionCookie(true)).toContain('; Secure');
    expect(clearCsrfCookie(true)).toContain('; Secure');
  });

  it('omits Secure on plain-http development while keeping fixed attributes', () => {
    const session = sessionCookie('session-value', false);
    expect(session).not.toContain('Secure');
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Path=/');
    expect(session).toContain('Max-Age=43200');

    const csrf = csrfCookie('csrf-value', false);
    expect(csrf).not.toContain('Secure');
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Lax');
    expect(csrf).toContain('Max-Age=43200');
  });

  it('url-encodes values and expires the cookies on clear', () => {
    expect(sessionCookie('a b/c', false)).toContain(
      `${SESSION_COOKIE_NAME}=${encodeURIComponent('a b/c')}`,
    );
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
    expect(clearCsrfCookie(false)).toContain(`${CSRF_COOKIE_NAME}=;`);
  });

  it('reads a named cookie and rejects malformed values', () => {
    expect(
      readCookie('a=1; dev_cor_csrf=token%2Bvalue; b=2', CSRF_COOKIE_NAME),
    ).toBe('token+value');
    expect(readCookie(undefined, SESSION_COOKIE_NAME)).toBeNull();
    expect(readCookie('broken', SESSION_COOKIE_NAME)).toBeNull();
    expect(
      readCookie(`${SESSION_COOKIE_NAME}=%E0%A4%A`, SESSION_COOKIE_NAME),
    ).toBeNull();
  });

  it('does not accept a name that merely shares a prefix', () => {
    expect(
      readCookie('dev_cor_session_extra=x', SESSION_COOKIE_NAME),
    ).toBeNull();
  });
});
