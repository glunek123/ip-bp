import 'reflect-metadata';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../common/configure-app';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(),
    restoreSession: jest.fn(),
    logout: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('sets a protected same-origin session cookie without returning its token', async () => {
    auth.login.mockResolvedValue({
      sessionToken: 'opaque-token',
      view: {
        user: { id: 'u1', displayName: '管理员', username: 'admin' },
        csrfToken: 'csrf-token',
      },
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://127.0.0.1')
      .set('Host', '127.0.0.1')
      .send({ username: 'admin', password: 'correct horse battery staple' })
      .expect(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][1]).toContain('dev_cor_csrf');
    expect(response.body).not.toHaveProperty('sessionToken');
  });

  it('rejects cross-site login before checking credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ username: 'admin', password: 'correct horse battery staple' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ORIGIN_FORBIDDEN'));
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('delegates idempotent logout and always clears both cookies', async () => {
    const empty = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .expect(204);
    expect(empty.headers['set-cookie']).toHaveLength(2);
    const active = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'dev_cor_session=opaque-token')
      .set('X-CSRF-Token', 'csrf-token')
      .expect(204);
    expect(active.headers['set-cookie']).toHaveLength(2);
    expect(auth.logout).toHaveBeenCalledWith('opaque-token', 'csrf-token');
  });

  it('preserves a validated department list in the HTTP error contract', async () => {
    auth.login.mockRejectedValueOnce(
      new UnauthorizedException({
        code: 'DEPARTMENT_REQUIRED',
        message: '请选择登录部门',
        details: {
          departments: [
            { id: '10000000-0000-4000-8000-000000000001', name: '知产部' },
            { id: '10000000-0000-4000-8000-000000000002', name: '品维部' },
          ],
        },
      }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://127.0.0.1')
      .set('Host', '127.0.0.1')
      .send({ username: 'admin', password: 'correct horse battery staple' })
      .expect(401)
      .expect(({ body }) => expect(body.details.departments).toHaveLength(2));
  });

  it('does not trust a client-supplied forwarded host', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example')
      .set('Host', '127.0.0.1')
      .set('X-Forwarded-Host', 'attacker.example')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'admin', password: 'correct horse battery staple' })
      .expect(403);
  });
});
