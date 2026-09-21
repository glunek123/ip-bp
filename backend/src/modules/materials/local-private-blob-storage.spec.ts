import { createHash } from 'node:crypto';
import * as fileSystem from 'node:fs/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { LocalPrivateBlobStorage } from './local-private-blob-storage';
import { BlobStorageUnavailableError } from './private-blob-storage';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const webp = Buffer.from('RIFF1234WEBPdata', 'ascii');

describe('LocalPrivateBlobStorage', () => {
  let root: string;
  let storage: LocalPrivateBlobStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dev-cor-private-'));
    storage = new LocalPrivateBlobStorage(root);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ['application/pdf', pdf],
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
  ])('streams, hashes and reopens %s bytes exactly', async (mime, bytes) => {
    const key = `department/material/${mime.replace('/', '-')}`;
    const result = await storage.put(
      key,
      Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]),
    );

    expect(result).toEqual({
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      detectedMimeType: mime,
    });
    const reopened = await readStream(await storage.open(key));
    expect(reopened).toEqual(bytes);
    expect(await readFile(join(root, ...key.split('/')))).toEqual(bytes);
  });

  it('rejects traversal and absolute storage keys', async () => {
    await expect(storage.put('../escape', Readable.from(pdf))).rejects.toThrow(
      'storage key',
    );
    await expect(storage.open(join(root, 'absolute'))).rejects.toThrow(
      'storage key',
    );
  });

  it('never replaces an existing key', async () => {
    await storage.put('department/material/version', Readable.from(pdf));
    await expect(
      storage.put('department/material/version', Readable.from(png)),
    ).rejects.toThrow('already exists');
    expect(
      await readStream(await storage.open('department/material/version')),
    ).toEqual(pdf);
  });

  it('atomically allows only one concurrent publisher for the same key', async () => {
    const key = 'department/material/concurrent-version';
    const results = await Promise.allSettled([
      storage.put(key, Readable.from(pdf)),
      storage.put(key, Readable.from(png)),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('already exists'),
      }),
    );
    const published = await readStream(await storage.open(key));
    expect([published.equals(pdf), published.equals(png)]).toContain(true);
  });

  it('prevents a delayed put from publishing after cleanup confirms deletion', async () => {
    const key = 'department/material/delayed-version';
    const temporaryPath = deterministicTemporaryPath(root, key);
    const source = new PassThrough();
    const upload = storage.put(key, source);
    source.write(pdf.subarray(0, 8));
    await waitForPath(temporaryPath);

    await storage.delete(key);
    await storage.put(key, Readable.from(png));
    source.end(pdf.subarray(8));

    await expect(upload).rejects.toBeInstanceOf(BlobStorageUnavailableError);
    await expect(fileSystem.access(temporaryPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readStream(await storage.open(key))).toEqual(png);
  });

  it('rejects success and leaves deterministic cleanup when temp unlink fails after publish', async () => {
    const key = 'department/material/unlink-failure';
    const target = join(root, ...key.split('/'));
    const temporaryPath = deterministicTemporaryPath(root, key);
    const unlink = fileSystem.unlink.bind(fileSystem);
    let failuresRemaining = 3;
    storage = new LocalPrivateBlobStorage(root, {
      unlink: async (path) => {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw Object.assign(new Error('filesystem failure'), {
            code: 'EACCES',
          });
        }
        return unlink(path);
      },
    });

    await expect(storage.put(key, Readable.from(png))).rejects.toBeInstanceOf(
      BlobStorageUnavailableError,
    );
    expect(await readFile(target)).toEqual(png);
    expect(await readFile(temporaryPath)).toEqual(png);

    storage = new LocalPrivateBlobStorage(root);
    await storage.delete(key);
    await expect(fileSystem.access(target)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fileSystem.access(temporaryPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('maps non-collision link failures to a path-free storage error', async () => {
    storage = new LocalPrivateBlobStorage(root, {
      link: async () => {
        throw Object.assign(new Error('C:\\sensitive\\private\\path'), {
          code: 'EIO',
        });
      },
    });

    const result = storage.put(
      'department/material/io-failure',
      Readable.from(png),
    );
    await expect(result).rejects.toBeInstanceOf(BlobStorageUnavailableError);
    await expect(result).rejects.not.toThrow('sensitive');
  });

  it('reports missing blobs and supports idempotent cleanup', async () => {
    await expect(storage.open('missing/blob')).rejects.toThrow('not found');
    await storage.put('department/material/version', Readable.from(pdf));
    await storage.delete('department/material/version');
    await storage.delete('department/material/version');
    await expect(storage.open('department/material/version')).rejects.toThrow(
      'not found',
    );
  });

  it('defensively deletes the deterministic temp path before the final path', async () => {
    const key = 'department/material/delete-order';
    const paths: string[] = [];
    storage = new LocalPrivateBlobStorage(root, {
      unlink: async (path) => {
        paths.push(String(path));
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });

    await storage.delete(key);

    expect(paths).toEqual([
      deterministicTemporaryPath(root, key),
      join(root, ...key.split('/')),
    ]);
  });

  it('rejects unknown signatures and encrypted PDFs without publishing a blob', async () => {
    await expect(
      storage.put('unknown', Readable.from(Buffer.from('not an image'))),
    ).rejects.toThrow('signature');
    await expect(
      storage.put(
        'encrypted',
        Readable.from([
          Buffer.from('%PDF-1.7\n/Enc'),
          Buffer.from('rypt 4 0 R'),
        ]),
      ),
    ).rejects.toThrow('encrypted PDF');
    await expect(storage.open('encrypted')).rejects.toThrow('not found');
  });

  it('rejects a stream larger than 20MB and removes its temporary bytes', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0);
    chunk.set(png);
    await expect(
      storage.put(
        'too-large',
        Readable.from(Array.from({ length: 21 }, () => chunk)),
      ),
    ).rejects.toThrow('20MB');
    await expect(storage.open('too-large')).rejects.toThrow('not found');
  });

  it('reports ready only when its private root is usable', async () => {
    await expect(storage.health()).resolves.toBe('ready');
  });
});

async function readStream(source: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'),
    );
  }
  return Buffer.concat(chunks);
}

function deterministicTemporaryPath(root: string, storageKey: string): string {
  return join(
    root,
    '.tmp',
    createHash('sha256').update(storageKey, 'utf8').digest('hex'),
  );
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fileSystem.access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error('Timed out waiting for private temporary file');
}
