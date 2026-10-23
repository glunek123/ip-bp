import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Environment, validateEnvironment } from '../../common/environment';
import { MaterialModule } from './material.module';
import { LocalPrivateBlobStorage } from './local-private-blob-storage';
import {
  BlobNotFoundError,
  BlobStorageUnavailableError,
  BlobValidationError,
  PRIVATE_BLOB_STORAGE,
  PrivateBlobStorage,
  UnavailablePrivateBlobStorage,
} from './private-blob-storage';

interface StorageFactoryProvider {
  provide: typeof PRIVATE_BLOB_STORAGE;
  useFactory(config: ConfigService<Environment>): PrivateBlobStorage;
}

function isStorageFactory(value: unknown): value is StorageFactoryProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provide' in value &&
    value.provide === PRIVATE_BLOB_STORAGE &&
    'useFactory' in value &&
    typeof value.useFactory === 'function'
  );
}

// Exercise the factory registered on the actual MaterialModule, without booting
// Nest, DatabaseService, cleanup timers, listeners or any real environment file.
function actualStorage(input: Parameters<typeof validateEnvironment>[0]) {
  const metadata: unknown = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    MaterialModule,
  );
  const providers: readonly unknown[] = Array.isArray(metadata) ? metadata : [];
  const provider = providers.find(isStorageFactory);
  if (!provider)
    throw new Error('MaterialModule private storage factory missing');
  return provider.useFactory(
    new ConfigService<Environment>(validateEnvironment(input)),
  );
}

describe('MaterialModule private blob storage selection', () => {
  let root: string | undefined;
  const pdf = Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
  );
  const input = () => ({
    NODE_ENV: 'production',
    PORT: '4310',
    DATABASE_URL: 'postgresql://offline:offline@uat-db.invalid/dev_cor_uat',
    AUTH_THROTTLE_SECRET: 'a'.repeat(64),
    PRIVATE_FILE_ROOT: root,
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dev-cor-uat-provider-'));
  });

  afterEach(async () => {
    if (root === undefined) return;
    const target = resolve(root);
    expect(dirname(target)).toBe(resolve(tmpdir()));
    expect(basename(target).startsWith('dev-cor-uat-provider-')).toBe(true);
    await rm(target, { recursive: true, force: true });
    root = undefined;
  });

  it('keeps production unavailable by default even with a configured root', async () => {
    const storage = actualStorage(input());
    expect(storage).toBeInstanceOf(UnavailablePrivateBlobStorage);
    expect(await storage.health()).toBe('unavailable');
    await expect(
      storage.put('proof.pdf', Readable.from(pdf)),
    ).rejects.toBeInstanceOf(BlobStorageUnavailableError);
    await expect(storage.open('proof.pdf')).rejects.toBeInstanceOf(
      BlobStorageUnavailableError,
    );
    await expect(storage.delete('proof.pdf')).rejects.toBeInstanceOf(
      BlobStorageUnavailableError,
    );
  });

  it.each(['development', 'test'])(
    'keeps the %s default local adapter',
    (NODE_ENV) => {
      expect(actualStorage({ ...input(), NODE_ENV })).toBeInstanceOf(
        LocalPrivateBlobStorage,
      );
    },
  );

  it('uses real local storage for explicit production local: put/open/hash/delete roundtrip', async () => {
    const storage = actualStorage({
      ...input(),
      PRIVATE_BLOB_STORAGE_DRIVER: 'local',
    });
    expect(storage).toBeInstanceOf(LocalPrivateBlobStorage);
    expect(await storage.health()).toBe('ready');
    const key = 'uat-department/synthetic/proof.pdf';
    const written = await storage.put(key, Readable.from(pdf));
    expect(written).toEqual({
      sizeBytes: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      detectedMimeType: 'application/pdf',
    });
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.open(key))
      chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(pdf);
    await storage.delete(key);
    await expect(storage.open(key)).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it('retains traversal rejection through the actual selected local adapter', async () => {
    const storage = actualStorage({
      ...input(),
      PRIVATE_BLOB_STORAGE_DRIVER: 'local',
    });
    await expect(
      storage.put('../escape.pdf', Readable.from(pdf)),
    ).rejects.toBeInstanceOf(BlobValidationError);
    await expect(storage.open('../escape.pdf')).rejects.toBeInstanceOf(
      BlobValidationError,
    );
  });

  it('fails selection for production local without a root', () => {
    expect(() =>
      actualStorage({
        ...input(),
        PRIVATE_BLOB_STORAGE_DRIVER: 'local',
        PRIVATE_FILE_ROOT: undefined,
      }),
    ).toThrow('PRIVATE_FILE_ROOT');
  });

  it('rejects unknown drivers before constructing storage', () => {
    expect(() =>
      actualStorage({ ...input(), PRIVATE_BLOB_STORAGE_DRIVER: 'remote' }),
    ).toThrow('PRIVATE_BLOB_STORAGE_DRIVER');
  });
});
