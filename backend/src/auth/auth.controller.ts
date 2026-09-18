import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';
import {
  clearSessionCookie,
  clearCsrfCookie,
  csrfCookie,
  CSRF_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
  sessionCookie,
} from './cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertSameOrigin(request);
    const result = await this.auth.login(input, request.ip ?? 'unknown');
    response.setHeader('Set-Cookie', [
      sessionCookie(
        result.sessionToken,
        request.app.get('env') === 'production',
      ),
      csrfCookie(
        result.view.csrfToken,
        request.app.get('env') === 'production',
      ),
    ]);
    return result.view;
  }

  @Get('session')
  session(@Req() request: Request) {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const csrfToken = readCookie(request.headers.cookie, CSRF_COOKIE_NAME);
    if (token === null || csrfToken === null) this.unauthorized();
    return this.auth.restoreSession(token, csrfToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const csrfToken = request.header('X-CSRF-Token');
    const secure = request.app.get('env') === 'production';
    try {
      if (token !== null) await this.auth.logout(token, csrfToken);
    } finally {
      response.setHeader('Set-Cookie', [
        clearSessionCookie(secure),
        clearCsrfCookie(secure),
      ]);
    }
  }

  private assertSameOrigin(request: Request): void {
    const site = request.header('Sec-Fetch-Site');
    if (site !== undefined && site !== 'same-origin') this.originRejected();
    const origin = request.header('Origin');
    if (origin === undefined) return;
    try {
      const parsed = new URL(origin);
      const expectedHost = request.header('Host');
      const expectedProtocol = request.protocol;
      if (
        parsed.host !== expectedHost ||
        parsed.protocol !== `${expectedProtocol}:`
      )
        this.originRejected();
    } catch {
      this.originRejected();
    }
  }

  private originRejected(): never {
    throw new ForbiddenException({
      code: 'ORIGIN_FORBIDDEN',
      message: '不允许从该来源登录',
    });
  }

  private unauthorized(): never {
    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: '未登录或登录已失效',
    });
  }
}
