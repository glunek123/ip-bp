import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActorContext } from './actor-context';
import { IDENTITY_ADAPTER, IdentityAdapter } from './identity.adapter';
import { AuthService } from '../auth/auth.service';
import { Authentication } from '../auth/authenticated-session';
import { readCookie, SESSION_COOKIE_NAME } from '../auth/cookie';

export type AuthenticatedRequest = Request & {
  actor?: ActorContext;
  authentication?: Authentication;
};

@Injectable()
export class ActorContextGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_ADAPTER)
    private readonly identity: IdentityAdapter,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const bearerToken = this.readBearerToken(request.headers.authorization);
    const bearerActor =
      bearerToken === null ? null : await this.identity.resolve(bearerToken);
    const sessionToken = readCookie(
      request.headers.cookie,
      SESSION_COOKIE_NAME,
    );
    const session =
      bearerActor === null && sessionToken !== null
        ? await this.auth.resolveSession(sessionToken)
        : null;
    const actor = bearerActor ?? session?.actor ?? null;

    if (actor === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: '未登录或登录已失效',
      });
    }

    request.actor = actor;
    request.authentication =
      bearerActor === null ? session?.authentication : { kind: 'bearer' };
    return true;
  }

  private readBearerToken(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }
    const match = /^Bearer ([^\s]+)$/.exec(value);
    return match?.[1] ?? null;
  }
}
