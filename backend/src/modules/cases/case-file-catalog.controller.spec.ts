import { validateHeaderValue } from 'node:http';
import type { Response } from 'express';
import { CaseFileCatalogController } from './case-file-catalog.controller';
import { CaseFileCatalogService } from './case-file-catalog.service';

it('exports Unicode file metadata without putting it into HTTP headers', async () => {
  const materialId = '22222222-2222-4222-8222-222222222222';
  const contentVersionId = '33333333-3333-4333-8333-333333333333';
  const bytes = Buffer.from('zip bytes');
  const results = [
    {
      materialId,
      contentVersionId,
      status: 'SUCCESS',
      path: '00120261101001/公证书/中文文书🙂.pdf',
      filename: '中文文书🙂.pdf',
      labels: ['入案冻结版本'],
    },
    {
      materialId: '44444444-4444-4444-8444-444444444444',
      contentVersionId: '55555555-5555-4555-8555-555555555555',
      status: 'FAILED',
      reason: 'VERSION_UNAVAILABLE',
    },
  ];
  const service = {
    export: jest.fn().mockResolvedValue({ bytes, results }),
  };
  const headers = new Map<string, string>();
  const response = {
    setHeader: jest.fn((name: string, value: string) => {
      validateHeaderValue(name, value);
      headers.set(name, value);
    }),
    send: jest.fn(),
  };
  const controller = new CaseFileCatalogController(
    service as unknown as CaseFileCatalogService,
  );

  await controller.export(
    {
      userId: 'operator',
      departmentId: 'department',
      authorizationRevision: 1,
    },
    '11111111-1111-4111-8111-111111111111',
    {
      selections: results.map(({ materialId, contentVersionId }) => ({
        materialId,
        contentVersionId,
      })),
    },
    response as unknown as Response,
  );

  expect(JSON.parse(headers.get('X-Case-Export-Result')!)).toEqual([
    { materialId, contentVersionId, status: 'SUCCESS' },
    {
      materialId: results[1]!.materialId,
      contentVersionId: results[1]!.contentVersionId,
      status: 'FAILED',
      reason: 'VERSION_UNAVAILABLE',
    },
  ]);
  expect(headers.get('Content-Type')).toBe('application/zip');
  expect(response.send).toHaveBeenCalledWith(bytes);
  expect(results[0]!.path).toBe('00120261101001/公证书/中文文书🙂.pdf');
});
