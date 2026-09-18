import {
  ForbiddenException,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import type { Prisma } from '../generated/prisma/client';
import { createOpaqueToken, digestSource, digestToken } from './auth-token';
import { LoginDto } from './auth.dto';
import {
  normalizeUsername,
  validatePassword,
  verifyPassword,
} from './password';
import {
  ResolvedSession,
  SessionAuthentication,
} from './authenticated-session';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const SESSION_MS = 12 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH =
  'scrypt$v1$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg$6HM_5A1jwyfQgoZBQhpyC4I_N3xAKZ2WhriqXhQx71D2EC9F7X5wDSsVKDqbTYDI0T9f5cTzK3VA5pK9bD3fPA';

export type AuthSessionView = {
  user: { id: string; displayName: string; username: string };
  department: { id: string; name: string };
  departments: Array<{ id: string; name: string }>;
  authorizationRevision: number;
  expiresAt: string;
  csrfToken: string;
};

export type LoginResult = { sessionToken: string; view: AuthSessionView };

type LoginTransactionOutcome =
  | { kind: 'blocked'; retryAfterSeconds: number }
  | { kind: 'failed' }
  | {
      kind: 'department-required';
      departments: Array<{ id: string; name: string }>;
    }
  | { kind: 'success'; result: LoginResult };

@Injectable()
export class AuthService {
  private readonly throttleSecret: string;
  private readonly logger = new Logger('AuthSecurity');

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    this.throttleSecret = config.getOrThrow<string>('AUTH_THROTTLE_SECRET');
  }

  async login(input: LoginDto, source: string): Promise<LoginResult> {
    let username: string;
    try {
      username = normalizeUsername(input.username);
      validatePassword(input.password);
    } catch {
      username = input.username.trim().normalize('NFKC').toLowerCase();
    }
    const usernameDigest = digestToken(username);
    const sourceDigest = digestSource(source, this.throttleSecret);
    const outcome = await this.database.$transaction(
      async (transaction): Promise<LoginTransactionOutcome> => {
        for (const lockKey of [
          `source:${sourceDigest}`,
          `username:${usernameDigest}`,
        ].sort()) {
          await transaction.$queryRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS "lockAcquired"
          `;
        }
        const blockedUntil = await this.blockedUntil(
          transaction,
          usernameDigest,
          sourceDigest,
        );
        if (blockedUntil !== null) {
          return {
            kind: 'blocked',
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((blockedUntil.getTime() - Date.now()) / 1000),
            ),
          };
        }
        const credential = await transaction.localCredential.findUnique({
          where: { username },
          include: {
            user: {
              include: {
                memberships: {
                  where: { active: true },
                  include: { department: true },
                  orderBy: { department: { name: 'asc' } },
                },
              },
            },
          },
        });
        const passwordMatches = await verifyPassword(
          input.password,
          credential?.passwordHash ?? DUMMY_PASSWORD_HASH,
        );
        if (
          credential === null ||
          !passwordMatches ||
          !credential.user.active
        ) {
          await this.recordFailure(transaction, usernameDigest, sourceDigest);
          return { kind: 'failed' };
        }
        const memberships = credential.user.memberships;
        const departments = memberships.map(({ department }) => ({
          id: department.id,
          name: department.name,
        }));
        if (input.departmentId === undefined && memberships.length > 1) {
          return { kind: 'department-required', departments };
        }
        const membership =
          input.departmentId === undefined
            ? memberships[0]
            : memberships.find(
                (item) => item.departmentId === input.departmentId,
              );
        if (membership === undefined) {
          await this.recordFailure(transaction, usernameDigest, sourceDigest);
          return { kind: 'failed' };
        }
        const sessionToken = createOpaqueToken();
        const csrfToken = createOpaqueToken();
        const expiresAt = new Date(Date.now() + SESSION_MS);
        await transaction.authThrottle.deleteMany({
          where: { kind: 'USERNAME', identifierDigest: usernameDigest },
        });
        await transaction.authSession.create({
          data: {
            tokenDigest: digestToken(sessionToken),
            csrfDigest: digestToken(csrfToken),
            userId: credential.userId,
            departmentId: membership.departmentId,
            authorizationRevision: credential.user.authorizationRevision,
            expiresAt,
          },
        });
        return {
          kind: 'success',
          result: {
            sessionToken,
            view: {
              user: {
                id: credential.user.id,
                displayName: credential.user.displayName,
                username: credential.username,
              },
              department: {
                id: membership.department.id,
                name: membership.department.name,
              },
              departments,
              authorizationRevision: credential.user.authorizationRevision,
              expiresAt: expiresAt.toISOString(),
              csrfToken,
            },
          },
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
    if (outcome.kind === 'blocked') {
      this.logger.warn({ event: 'auth_login_rate_limited' });
      throw new HttpException(
        {
          code: 'LOGIN_RATE_LIMITED',
          message: '登录尝试过多，请稍后再试',
          details: { retryAfterSeconds: outcome.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome.kind === 'failed') {
      this.logger.warn({ event: 'auth_login_failed' });
      this.authenticationFailed();
    }
    if (outcome.kind === 'department-required') {
      this.logger.log({ event: 'auth_department_required' });
      throw new UnauthorizedException({
        code: 'DEPARTMENT_REQUIRED',
        message: '请选择登录部门',
        details: { departments: outcome.departments },
      });
    }
    this.logger.log({ event: 'auth_login_succeeded' });
    return outcome.result;
  }

  async resolveSession(token: string): Promise<ResolvedSession | null> {
    const now = new Date();
    const session = await this.database.authSession.findUnique({
      where: { tokenDigest: digestToken(token) },
      include: { user: true },
    });
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      !session.user.active
    )
      return null;
    const membership = await this.database.departmentMembership.findUnique({
      where: {
        userId_departmentId: {
          userId: session.userId,
          departmentId: session.departmentId,
        },
      },
    });
    if (membership === null || !membership.active) return null;
    await this.database.authSession.update({
      where: { id: session.id },
      data: {
        lastUsedAt: now,
        authorizationRevision: session.user.authorizationRevision,
      },
    });
    return {
      actor: {
        userId: session.userId,
        departmentId: session.departmentId,
        authorizationRevision: session.user.authorizationRevision,
      },
      authentication: {
        kind: 'session',
        sessionId: session.id,
        csrfDigest: session.csrfDigest,
      },
    };
  }

  async restoreSession(
    token: string,
    csrfToken: string,
  ): Promise<AuthSessionView> {
    const resolved = await this.resolveSession(token);
    if (resolved === null) this.unauthorized();
    if (!this.verifyCsrf(resolved.authentication, csrfToken))
      this.unauthorized();
    const session = await this.database.authSession.findUniqueOrThrow({
      where: { id: resolved.authentication.sessionId },
      include: {
        user: {
          include: {
            localCredential: true,
            memberships: {
              where: { active: true },
              include: { department: true },
              orderBy: { department: { name: 'asc' } },
            },
          },
        },
        department: true,
      },
    });
    if (session.user.localCredential === null) this.unauthorized();
    return {
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        username: session.user.localCredential.username,
      },
      department: { id: session.department.id, name: session.department.name },
      departments: session.user.memberships.map(({ department }) => ({
        id: department.id,
        name: department.name,
      })),
      authorizationRevision: session.user.authorizationRevision,
      expiresAt: session.expiresAt.toISOString(),
      csrfToken,
    };
  }

  verifyCsrf(
    authentication: SessionAuthentication,
    csrfToken: string,
  ): boolean {
    const actual = Buffer.from(digestToken(csrfToken), 'hex');
    const expected = Buffer.from(authentication.csrfDigest, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  async logout(token: string, csrfToken?: string): Promise<void> {
    const resolved = await this.resolveSession(token);
    if (resolved === null) {
      this.logger.log({ event: 'auth_logout_repeated' });
      return;
    }
    if (
      csrfToken === undefined ||
      !this.verifyCsrf(resolved.authentication, csrfToken)
    ) {
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: '请求校验已失效，请重新登录',
      });
    }
    await this.database.authSession.update({
      where: { id: resolved.authentication.sessionId },
      data: { revokedAt: new Date() },
    });
    this.logger.log({ event: 'auth_logout_succeeded' });
  }

  private async blockedUntil(
    transaction: Prisma.TransactionClient,
    usernameDigest: string,
    sourceDigest: string,
  ): Promise<Date | null> {
    const blocked = await transaction.authThrottle.findFirst({
      where: {
        OR: [
          { kind: 'USERNAME', identifierDigest: usernameDigest },
          { kind: 'SOURCE', identifierDigest: sourceDigest },
        ],
        blockedUntil: { gt: new Date() },
      },
    });
    return blocked?.blockedUntil ?? null;
  }

  private async recordFailure(
    transaction: Prisma.TransactionClient,
    usernameDigest: string,
    sourceDigest: string,
  ): Promise<void> {
    for (const [kind, identifierDigest] of [
      ['USERNAME', usernameDigest],
      ['SOURCE', sourceDigest],
    ] as const) {
      const now = new Date();
      const windowStartedBefore = new Date(now.getTime() - WINDOW_MS);
      const blockedUntil = new Date(now.getTime() + BLOCK_MS);
      await transaction.$executeRaw`
          INSERT INTO "auth_throttles" (
            "id", "kind", "identifier_digest", "failure_count",
            "window_started_at", "blocked_until", "updated_at"
          ) VALUES (
            ${randomUUID()}::uuid, ${kind}, ${identifierDigest}, 1,
            ${now}::timestamptz, NULL, ${now}::timestamptz
          )
          ON CONFLICT ("kind", "identifier_digest") DO UPDATE SET
            "failure_count" = CASE
              WHEN "auth_throttles"."window_started_at" <= ${windowStartedBefore}::timestamptz
                THEN 1
              ELSE "auth_throttles"."failure_count" + 1
            END,
            "window_started_at" = CASE
              WHEN "auth_throttles"."window_started_at" <= ${windowStartedBefore}::timestamptz
                THEN ${now}::timestamptz
              ELSE "auth_throttles"."window_started_at"
            END,
            "blocked_until" = CASE
              WHEN (
                CASE
                  WHEN "auth_throttles"."window_started_at" <= ${windowStartedBefore}::timestamptz
                    THEN 1
                  ELSE "auth_throttles"."failure_count" + 1
                END
              ) >= ${MAX_FAILURES}
                THEN ${blockedUntil}::timestamptz
              ELSE NULL
            END,
            "updated_at" = ${now}::timestamptz
        `;
    }
  }

  private authenticationFailed(): never {
    throw new UnauthorizedException({
      code: 'AUTHENTICATION_FAILED',
      message: '用户名、密码或部门不正确',
    });
  }

  private unauthorized(
    code = 'UNAUTHORIZED',
    message = '未登录或登录已失效',
  ): never {
    throw new UnauthorizedException({ code, message });
  }
}
