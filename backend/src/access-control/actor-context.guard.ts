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

export type AuthenticatedRequest = Request & { actor?: ActorContext };

@Injectable()
export class ActorContextGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_ADAPTER)
    private readonly identity: IdentityAdapter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.readBearerToken(request.headers.authorization);
    const actor = token === null ? null : await this.identity.resolve(token);

    if (actor === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: '未登录或登录已失效',
      });
    }

    request.actor = actor;
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
