import { ForbiddenException } from '@nestjs/common';
import { unzipSync, strFromU8 } from 'fflate';
import {
  CaseComplaintExportService,
  safeZipSegment,
} from './case-complaint-export.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const cases = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const materials = [
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];
const versions = [
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
];
function stream(bytes: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(bytes));
      controller.close();
    },
  });
}
function fixture() {
  const db = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    case: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        cases.includes(where.id)
          ? {
              businessNo: where.id === cases[0] ? 'A/..' : 'B',
              departmentId: actor.departmentId,
              responsibleUserId: actor.userId,
              responsibleMembership: { teamId: null },
            }
          : null,
      ),
    },
    caseComplaintConfirmation: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    materialReference: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    authorizeCase: jest.fn().mockResolvedValue(undefined),
  };
  const materialService = {
    listOwnerMaterials: jest.fn(
      async (_actor: unknown, _owner: string, caseId: string) => ({
        items: [
          {
            id: materials[cases.indexOf(caseId)],
            ownerType: 'CASE',
            ownerId: caseId,
            category: 'COMPLAINT',
            contentVersions: [
              {
                id: versions[cases.indexOf(caseId)],
                originalFilename: '../诉状.pdf',
                sizeBytes: 3,
              },
            ],
          },
        ],
        total: 1,
      }),
    ),
    openVersion: jest.fn().mockResolvedValue({
      stream: stream('abc'),
      originalFilename: '../诉状.pdf',
      sizeBytes: 3,
    }),
  };
  return {
    db,
    access,
    materialService,
    service: new CaseComplaintExportService(
      db as never,
      access as never,
      materialService as never,
    ),
  };
}

describe('CaseComplaintExportService', () => {
  it('sanitizes zip segments and never preserves a traversal path', () => {
    expect(safeZipSegment('../a\\b')).not.toMatch(/[\\/]/u);
    expect(safeZipSegment('..')).toBe('_');
  });
  it('previews explicit complaint candidates without guessing a version', async () => {
    const f = fixture();
    const result = await f.service.preview(actor, { caseIds: [cases[0]!] });
    expect(result.items[0]).toMatchObject({
      status: 'READY',
      candidates: [
        {
          materialId: materials[0],
          contentVersionId: versions[0],
          tags: ['UPLOADED'],
        },
      ],
    });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.export',
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.read',
      expect.anything(),
    );
  });
  it('builds a truthful partial zip and short result, without a failed file', async () => {
    const f = fixture();
    f.materialService.openVersion
      .mockResolvedValueOnce({
        stream: stream('abc'),
        originalFilename: '../诉状.pdf',
        sizeBytes: 3,
      })
      .mockRejectedValueOnce(new ForbiddenException());
    const result = await f.service.download(actor, {
      selections: cases.map((caseId, index) => ({
        caseId,
        materialId: materials[index]!,
        contentVersionId: versions[index]!,
      })),
    });
    const entries = unzipSync(result.bytes);
    const paths = Object.keys(entries);
    expect(paths).toHaveLength(2);
    expect(paths).toContain('manifest.json');
    expect(paths.every((path) => !path.includes('../'))).toBe(true);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as {
      files: Array<{ status: string; errorCode?: string }>;
    };
    expect(manifest.files.map((file) => file.status)).toEqual([
      'SUCCESS',
      'FAILED',
    ]);
    expect(result.results).toEqual([
      { caseId: cases[0], successCount: 1, failCount: 0 },
      {
        caseId: cases[1],
        successCount: 0,
        failCount: 1,
        errorCode: 'CASE_UNAVAILABLE',
      },
    ]);
  });
  it('puts two explicitly selected same-name versions in one case folder with distinct bytes', async () => {
    const f = fixture();
    f.materialService.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: materials[0],
          ownerType: 'CASE',
          ownerId: cases[0],
          category: 'COMPLAINT',
          contentVersions: [
            { id: versions[0], originalFilename: '诉状.pdf', sizeBytes: 3 },
            { id: versions[1], originalFilename: '诉状.pdf', sizeBytes: 4 },
          ],
        },
      ],
      total: 1,
    });
    f.materialService.openVersion.mockImplementation(
      async (_actor: unknown, _materialId: string, versionId: string) => ({
        stream: stream(versionId === versions[0] ? 'one' : 'two!'),
        originalFilename: '诉状.pdf',
        sizeBytes: versionId === versions[0] ? 3 : 4,
      }),
    );
    const result = await f.service.download(actor, {
      selections: versions.map((contentVersionId) => ({
        caseId: cases[0]!,
        materialId: materials[0]!,
        contentVersionId,
      })),
    });
    const entries = unzipSync(result.bytes);
    const paths = Object.keys(entries).filter(
      (path) => path !== 'manifest.json',
    );
    expect(paths).toHaveLength(2);
    expect(paths[0]?.split('/')[0]).toBe(paths[1]?.split('/')[0]);
    expect(paths.map((path) => strFromU8(entries[path]!)).sort()).toEqual([
      'one',
      'two!',
    ]);
    expect(result.results).toEqual([
      { caseId: cases[0], successCount: 2, failCount: 0 },
    ]);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as {
      files: Array<{ contentVersionId: string }>;
    };
    expect(manifest.files.map((entry) => entry.contentVersionId)).toEqual(
      versions,
    );
  });
  it('continues other files in the same case and another case after one file fails', async () => {
    const f = fixture();
    f.materialService.listOwnerMaterials.mockImplementation(
      async (_actor: unknown, _owner: string, caseId: string) => ({
        items: [
          {
            id: materials[cases.indexOf(caseId)],
            ownerType: 'CASE',
            ownerId: caseId,
            category: 'COMPLAINT',
            contentVersions:
              caseId === cases[0]
                ? [
                    {
                      id: versions[0],
                      originalFilename: '诉状.pdf',
                      sizeBytes: 3,
                    },
                    {
                      id: versions[1],
                      originalFilename: '诉状.pdf',
                      sizeBytes: 3,
                    },
                  ]
                : [
                    {
                      id: versions[1],
                      originalFilename: '诉状.pdf',
                      sizeBytes: 3,
                    },
                  ],
          },
        ],
        total: 1,
      }),
    );
    f.materialService.openVersion.mockImplementation(
      async (_actor: unknown, _materialId: string, versionId: string) => {
        if (versionId === versions[0]) throw new ForbiddenException();
        return {
          stream: stream('ok!'),
          originalFilename: '诉状.pdf',
          sizeBytes: 3,
        };
      },
    );
    const result = await f.service.download(actor, {
      selections: [
        {
          caseId: cases[0]!,
          materialId: materials[0]!,
          contentVersionId: versions[0]!,
        },
        {
          caseId: cases[0]!,
          materialId: materials[0]!,
          contentVersionId: versions[1]!,
        },
        {
          caseId: cases[1]!,
          materialId: materials[1]!,
          contentVersionId: versions[1]!,
        },
      ],
    });
    expect(result.results).toEqual([
      {
        caseId: cases[0],
        successCount: 1,
        failCount: 1,
        errorCode: 'CASE_UNAVAILABLE',
      },
      { caseId: cases[1], successCount: 1, failCount: 0 },
    ]);
    expect(Object.keys(unzipSync(result.bytes))).toHaveLength(3);
  });
  it('refuses all-failed exports and preserves each failure reason', async () => {
    const f = fixture();
    f.materialService.openVersion
      .mockRejectedValueOnce(new ForbiddenException())
      .mockRejectedValueOnce(new Error('unreadable'));
    await expect(
      f.service.download(actor, {
        selections: cases.map((caseId, index) => ({
          caseId,
          materialId: materials[index]!,
          contentVersionId: versions[index]!,
        })),
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CASE_EXPORT_EMPTY',
        details: {
          files: [
            {
              caseId: cases[0],
              materialId: materials[0],
              contentVersionId: versions[0],
              filename: '../诉状.pdf',
              reason: 'CASE_UNAVAILABLE',
            },
            {
              caseId: cases[1],
              materialId: materials[1],
              contentVersionId: versions[1],
              filename: '../诉状.pdf',
              reason: 'FILE_UNAVAILABLE',
            },
          ],
        },
      },
    });
  });
  it('never packages a zero-byte or truncated complaint as a successful document', async () => {
    const f = fixture();
    f.materialService.openVersion.mockResolvedValue({
      stream: stream(''),
      originalFilename: '诉状.pdf',
      sizeBytes: 3,
    });
    await expect(
      f.service.download(actor, {
        selections: [
          {
            caseId: cases[0]!,
            materialId: materials[0]!,
            contentVersionId: versions[0]!,
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CASE_EXPORT_EMPTY',
        details: {
          files: [
            {
              caseId: cases[0],
              materialId: materials[0],
              contentVersionId: versions[0],
              filename: '../诉状.pdf',
              reason: 'FILE_UNAVAILABLE',
            },
          ],
        },
      },
    });
  });
  it('rechecks case.export for every selected file, including after a revoked grant', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException())
      .mockRejectedValueOnce(new ForbiddenException());
    const result = await f.service.download(actor, {
      selections: cases.map((caseId, index) => ({
        caseId,
        materialId: materials[index]!,
        contentVersionId: versions[index]!,
      })),
    });
    expect(result.results[1]).toMatchObject({
      failCount: 1,
      errorCode: 'CASE_UNAVAILABLE',
    });
    expect(f.materialService.openVersion).toHaveBeenCalledTimes(1);
  });
});
