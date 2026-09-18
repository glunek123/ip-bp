import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../access-control/actor-context.guard';
import { AuthService } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      SAFE_METHODS.has(request.method) ||
      request.authentication?.kind === 'bearer'
    )
      return true;
    const csrfToken = request.header('X-CSRF-Token');
    if (
      request.authentication?.kind !== 'session' ||
      csrfToken === undefined ||
      !this.auth.verifyCsrf(request.authentication, csrfToken)
    ) {
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: '请求校验已失效，请刷新后重试',
      });
    }
    return true;
  }
}
