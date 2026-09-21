import 'reflect-metadata';
import { Readable } from 'node:stream';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import {
  IDENTITY_ADAPTER,
  IdentityAdapter,
} from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import { configureApp } from '../../common/configure-app';
import { MaterialController } from './material.controller';
import { MaterialService } from './material.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const draftId = '33333333-3333-4333-8333-333333333333';
const materialId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';

describe('MaterialController', () => {
  const createUploadDraft = jest.fn();
  const finalizeUpload = jest.fn();
  const listOwnerMaterials = jest.fn();
  const openVersion = jest.fn();
  const softDelete = jest.fn();
  const restore = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed-token' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [MaterialController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: MaterialService,
          useValue: {
            createUploadDraft,
            finalizeUpload,
            listOwnerMaterials,
            openVersion,
            softDelete,
            restore,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('accepts JSON draft metadata and rejects forged fields', async () => {
    createUploadDraft.mockResolvedValue({ id: draftId, ownerId: materialId });
    await request(app.getHttpServer())
      .post('/api/v1/materials/upload-drafts')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        ownerType: 'LEAD_DRAFT',
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.png',
        declaredMimeType: 'image/png',
      })
      .expect(201);
    expect(createUploadDraft).toHaveBeenCalledWith(actor, {
      ownerType: 'LEAD_DRAFT',
      category: 'LEAD_SCREENSHOT',
      purpose: 'LEAD_SCREENSHOT',
      originalFilename: 'capture.png',
      declaredMimeType: 'image/png',
    });

    createUploadDraft.mockClear();
    await request(app.getHttpServer())
      .post('/api/v1/materials/upload-drafts')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        ownerType: 'LEAD_DRAFT',
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        originalFilename: 'capture.png',
        declaredMimeType: 'image/png',
        departmentId: 'forged',
      })
      .expect(400);
    expect(createUploadDraft).not.toHaveBeenCalled();
  });

  it('passes the untouched octet-stream request to finalizeUpload without buffering', async () => {
    let observed = Buffer.alloc(0);
    finalizeUpload.mockImplementation(async (_actor, _id, source) => {
      const chunks: Buffer[] = [];
      for await (const chunk of source as NodeJS.ReadableStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      observed = Buffer.concat(chunks);
      return { materialId, contentVersionId: versionId };
    });
    const bytes = Buffer.from('%PDF-1.7\nraw-body');

    await request(app.getHttpServer())
      .put(`/api/v1/materials/upload-drafts/${draftId}/content`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(200);

    expect(observed).toEqual(bytes);
    expect(finalizeUpload).toHaveBeenCalledWith(
      actor,
      draftId,
      expect.objectContaining({ pipe: expect.any(Function) }),
    );
  });

  it('requires octet-stream and rejects JSON/base64 content', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/materials/upload-drafts/${draftId}/content`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Content-Type', 'application/json')
      .send({ bytes: 'base64' })
      .expect(400);
    expect(finalizeUpload).not.toHaveBeenCalled();
  });

  it('downloads authorized bytes with private headers and a sanitized filename', async () => {
    openVersion.mockResolvedValue({
      stream: Readable.from(Buffer.from('exact')),
      originalFilename: 'bad\r\n"name.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/materials/${materialId}/versions/${versionId}/content`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-length']).toBe('5');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).not.toMatch(/[\r\n]/);
    expect(response.body).toEqual(Buffer.from('exact'));
  });

  it('routes list, delete and restore with validated identifiers and versions', async () => {
    listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
    await request(app.getHttpServer())
      .get('/api/v1/materials')
      .query({ ownerType: 'LEAD_DRAFT', ownerId: materialId })
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);
    expect(listOwnerMaterials).toHaveBeenCalledWith(
      actor,
      'LEAD_DRAFT',
      materialId,
    );

    softDelete.mockResolvedValue({
      id: materialId,
      status: 'DELETED',
      version: 2,
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/materials/${materialId}`)
      .query({ expectedVersion: 1 })
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);
    expect(softDelete).toHaveBeenCalledWith(actor, materialId, 1);

    restore.mockResolvedValue({ id: materialId, status: 'ACTIVE', version: 3 });
    await request(app.getHttpServer())
      .post(`/api/v1/materials/${materialId}/restore`)
      .set('Authorization', 'Bearer allowed-token')
      .send({ expectedVersion: 2 })
      .expect(201);
    expect(restore).toHaveBeenCalledWith(actor, materialId, 2);
  });
});
