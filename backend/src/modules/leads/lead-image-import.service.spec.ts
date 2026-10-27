import { AccessControlService } from '../../access-control/access-control.service';
import { Readable } from 'node:stream';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { LeadImageImportService } from './lead-image-import.service';
import { LeadService } from './lead.service';

const task = {
  id: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '33333333-3333-4333-8333-333333333333',
  leadId: '44444444-4444-4444-8444-444444444444',
  productId: '55555555-5555-4555-8555-555555555555',
  rowNumber: 8,
  productNumber: 3,
  url: 'https://example.com/a.png',
  urlSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  contentVersionId: '66666666-6666-4666-8666-666666666666',
  uploadDraftId: '88888888-8888-4888-8888-888888888888',
  status: 'LEASED',
  attemptCount: 1,
  generation: 0,
};

describe('LeadImageImportService', () => {
  it('attaches a stored version to only the selected product and records completion', async () => {
    const database = {
      userAccount: {
        findFirst: jest.fn().mockResolvedValue({ authorizationRevision: 7 }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          version: 2,
          status: 'WAITING_PUSH',
          products: [
            {
              screenshots: [
                { contentVersionId: '77777777-7777-4777-8777-777777777777' },
              ],
            },
          ],
        }),
      },
      leadImageImportTask: {
        findFirst: jest.fn().mockResolvedValue({ id: task.id }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as DatabaseService;
    const leads = {
      updateProductScreenshots: jest.fn().mockResolvedValue({}),
    } as unknown as LeadService;
    const service = new LeadImageImportService(
      database,
      {} as AccessControlService,
      {} as MaterialService,
      leads,
      jest.fn(),
    );
    await service['process'](task as never);
    expect(leads.updateProductScreenshots).toHaveBeenCalledWith(
      {
        userId: task.actorUserId,
        departmentId: task.departmentId,
        authorizationRevision: 7,
      },
      task.leadId,
      task.productId,
      {
        expectedVersion: 2,
        screenshotContentVersionIds: [
          '77777777-7777-4777-8777-777777777777',
          task.contentVersionId,
        ],
      },
      {
        taskId: task.id,
        generation: 0,
        attemptCount: 1,
        urlSha256: task.urlSha256,
        uploadDraftId: task.uploadDraftId,
        contentVersionId: task.contentVersionId,
      },
    );
    expect(database.leadImageImportTask.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: task.id,
        status: 'LEASED',
        attemptCount: 1,
        generation: 0,
        uploadDraftId: task.uploadDraftId,
      }),
      data: { status: 'ATTACHED', leaseUntil: null, failureCode: null },
    });
  });

  it('does not attach the same version twice after a crash', async () => {
    const database = {
      userAccount: {
        findFirst: jest.fn().mockResolvedValue({ authorizationRevision: 7 }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          version: 3,
          status: 'WAITING_PUSH',
          products: [
            { screenshots: [{ contentVersionId: task.contentVersionId }] },
          ],
        }),
      },
      leadImageImportTask: {
        findFirst: jest.fn().mockResolvedValue({ id: task.id }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as DatabaseService;
    const leads = {
      updateProductScreenshots: jest.fn(),
    } as unknown as LeadService;
    const service = new LeadImageImportService(
      database,
      {} as AccessControlService,
      {} as MaterialService,
      leads,
      jest.fn(),
    );
    await service['process'](task as never);
    expect(leads.updateProductScreenshots).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForCall(mock: jest.Mock) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (mock.mock.calls.length) return;
    await new Promise(setImmediate);
  }
  throw new Error('Expected worker to reach the controlled I/O boundary');
}

function concurrentFixture(
  download: jest.Mock,
  createDraft: jest.Mock = jest
    .fn()
    .mockResolvedValue({ id: task.uploadDraftId }),
  existingVersion: string | null = null,
) {
  const current = {
    status: 'LEASED',
    attemptCount: 1,
    generation: 0,
    urlSha256: task.urlSha256,
    uploadDraftId: null as string | null,
    contentVersionId: null as string | null,
  };
  const matches = (where: Record<string, unknown>) =>
    where.status === current.status &&
    where.attemptCount === current.attemptCount &&
    where.generation === current.generation &&
    where.urlSha256 === current.urlSha256 &&
    (!Object.hasOwn(where, 'uploadDraftId') ||
      where.uploadDraftId === current.uploadDraftId);
  const database = {
    userAccount: {
      findFirst: jest.fn().mockResolvedValue({ authorizationRevision: 7 }),
    },
    contentVersion: {
      findUnique: jest
        .fn()
        .mockImplementation(async () =>
          existingVersion ? { id: existingVersion } : null,
        ),
    },
    lead: {
      findFirst: jest.fn().mockResolvedValue({
        version: 2,
        status: 'WAITING_PUSH',
        products: [{ screenshots: [] }],
      }),
    },
    leadImageImportTask: {
      findFirst: jest
        .fn()
        .mockImplementation(async ({ where }) =>
          matches(where) ? { id: task.id } : null,
        ),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (!matches(where)) return { count: 0 };
        if (data.uploadDraftId) current.uploadDraftId = data.uploadDraftId;
        if (data.contentVersionId)
          current.contentVersionId = data.contentVersionId;
        if (data.status) current.status = data.status;
        return { count: 1 };
      }),
    },
  };
  const materials = {
    createUploadDraft: createDraft,
    finalizeUpload: jest
      .fn()
      .mockResolvedValue({ contentVersionId: task.contentVersionId }),
  };
  const leads = { updateProductScreenshots: jest.fn().mockResolvedValue({}) };
  const service = new LeadImageImportService(
    database as unknown as DatabaseService,
    {} as AccessControlService,
    materials as unknown as MaterialService,
    leads as unknown as LeadService,
    download,
  );
  const imageTask = {
    ...task,
    uploadDraftId: null,
    contentVersionId: null,
  };
  return { current, database, materials, leads, service, imageTask };
}

describe('LeadImageImportService lease fencing', () => {
  const image = { bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' };

  it('drops a late first worker after a second lease attaches once', async () => {
    const first = deferred<typeof image>();
    const download = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(image);
    const f = concurrentFixture(download);
    const oldWork = f.service['process'](f.imageTask as never);
    await waitForCall(download);
    f.current.attemptCount = 2;
    await f.service['process']({ ...f.imageTask, attemptCount: 2 } as never);
    first.resolve(image);
    await oldWork;
    expect(f.materials.createUploadDraft).toHaveBeenCalledTimes(1);
    expect(f.materials.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(f.leads.updateProductScreenshots).toHaveBeenCalledTimes(1);
    expect(f.current.status).toBe('ATTACHED');
  });

  it('lets only the current worker claim the first upload draft', async () => {
    const firstDraft = deferred<{ id: string }>();
    const createDraft = jest
      .fn()
      .mockImplementationOnce(() => firstDraft.promise)
      .mockResolvedValue({ id: task.uploadDraftId });
    const f = concurrentFixture(
      jest.fn().mockResolvedValue(image),
      createDraft,
    );
    const oldWork = f.service['process'](f.imageTask as never);
    await waitForCall(createDraft);
    f.current.attemptCount = 2;
    await f.service['process']({ ...f.imageTask, attemptCount: 2 } as never);
    firstDraft.resolve({ id: '99999999-9999-4999-8999-999999999999' });
    await oldWork;
    expect(createDraft).toHaveBeenCalledTimes(2);
    expect(f.materials.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(f.materials.finalizeUpload).toHaveBeenCalledWith(
      expect.any(Object),
      task.uploadDraftId,
      expect.any(Readable),
      expect.objectContaining({ attemptCount: 2, generation: 0 }),
    );
  });

  it('recovers the one finalized version after a crash before task update', async () => {
    const download = jest.fn();
    const f = concurrentFixture(download, undefined, task.contentVersionId);
    f.current.uploadDraftId = task.uploadDraftId;
    await f.service['process']({
      ...f.imageTask,
      uploadDraftId: task.uploadDraftId,
    } as never);
    expect(download).not.toHaveBeenCalled();
    expect(f.materials.finalizeUpload).not.toHaveBeenCalled();
    expect(f.current.contentVersionId).toBe(task.contentVersionId);
    expect(f.leads.updateProductScreenshots).toHaveBeenCalledTimes(1);
  });

  it('invalidates a late old URL when a failed task changes generation', async () => {
    const pending = deferred<typeof image>();
    const download = jest.fn().mockReturnValue(pending.promise);
    const f = concurrentFixture(download);
    const oldWork = f.service['process'](f.imageTask as never);
    await waitForCall(download);
    f.current.generation = 1;
    f.current.urlSha256 = 'b'.repeat(64);
    f.current.status = 'PENDING';
    pending.resolve(image);
    await oldWork;
    expect(f.materials.createUploadDraft).not.toHaveBeenCalled();
    expect(f.materials.finalizeUpload).not.toHaveBeenCalled();
    expect(f.leads.updateProductScreenshots).not.toHaveBeenCalled();
    expect(f.current.status).toBe('PENDING');
  });

  it('replaces a failed link with a new generation and clears its old draft', async () => {
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue({}),
    } as unknown as AccessControlService;
    const database = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: task.leadId,
          status: 'WAITING_PUSH',
        }),
      },
      leadImageImportTask: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ ...task, status: 'FAILED' })
          .mockResolvedValueOnce(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as DatabaseService;
    const service = new LeadImageImportService(
      database,
      access,
      {} as MaterialService,
      {} as LeadService,
      jest.fn(),
    );
    await service.retry(
      {
        userId: task.actorUserId,
        departmentId: task.departmentId,
        authorizationRevision: 7,
      },
      task.leadId,
      task.id,
      'https://example.com/replacement.png',
    );
    expect(database.leadImageImportTask.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: task.id, status: 'FAILED' }),
      data: expect.objectContaining({
        generation: { increment: 1 },
        uploadDraftId: null,
        contentVersionId: null,
        status: 'PENDING',
      }),
    });
  });
});
