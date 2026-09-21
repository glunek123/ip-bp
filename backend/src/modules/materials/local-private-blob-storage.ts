import { createHash } from 'node:crypto';
import {
  access,
  link,
  mkdir,
  open as openFile,
  stat,
  unlink,
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { containsPdfEncryptionToken, detectMimeType } from './file-signature';
import {
  BlobNotFoundError,
  BlobStorageUnavailableError,
  BlobValidationError,
  PrivateBlobStorage,
} from './private-blob-storage';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SIGNATURE_BYTES = 12;
const PDF_TOKEN_OVERLAP = 7;

export class LocalPrivateBlobStorage implements PrivateBlobStorage {
  private readonly root: string;
  private readonly linkFile: typeof link;
  private readonly unlinkFile: typeof unlink;

  constructor(
    root: string,
    operations: { link?: typeof link; unlink?: typeof unlink } = {},
  ) {
    this.root = resolve(root);
    this.linkFile = operations.link ?? link;
    this.unlinkFile = operations.unlink ?? unlink;
  }

  async put(
    storageKey: string,
    source: NodeJS.ReadableStream,
  ): Promise<{
    sizeBytes: number;
    sha256: string;
    detectedMimeType: string;
  }> {
    const target = this.resolveStorageKey(storageKey);
    const temporaryDirectory = resolve(this.root, '.tmp');
    const temporaryPath = resolve(
      temporaryDirectory,
      createHash('sha256').update(storageKey, 'utf8').digest('hex'),
    );
    const hash = createHash('sha256');
    let sizeBytes = 0;
    let prefix = Buffer.alloc(0);
    let pdfTail = Buffer.alloc(0);
    let encryptedPdf = false;
    let ownsTemporary = false;
    let linked = false;
    let temporaryHandle: Awaited<ReturnType<typeof openFile>> | undefined;

    const inspector = new Transform({
      transform(chunk: Buffer | string, encoding, callback) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, encoding);
        sizeBytes += bytes.length;
        if (sizeBytes > MAX_FILE_BYTES) {
          callback(new BlobValidationError('File exceeds the 20MB limit'));
          return;
        }
        hash.update(bytes);
        if (prefix.length < SIGNATURE_BYTES) {
          prefix = Buffer.concat([prefix, bytes]).subarray(0, SIGNATURE_BYTES);
        }
        const scan = Buffer.concat([pdfTail, bytes]);
        encryptedPdf ||= containsPdfEncryptionToken(scan);
        pdfTail = scan.subarray(Math.max(0, scan.length - PDF_TOKEN_OVERLAP));
        callback(null, bytes);
      },
    });

    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
      temporaryHandle = await openFile(temporaryPath, 'wx', 0o600);
      ownsTemporary = true;
      await pipeline(
        source,
        inspector,
        createWriteStream(temporaryPath, { flags: 'r+', mode: 0o600 }),
      );
      const detectedMimeType = detectMimeType(prefix);
      if (detectedMimeType === 'application/pdf' && encryptedPdf) {
        throw new BlobValidationError('encrypted PDF files are not accepted');
      }
      await temporaryHandle.sync();
      const temporaryIdentity = await temporaryHandle.stat();
      const sha256 = hash.digest('hex');
      try {
        await this.linkFile(temporaryPath, target);
      } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') {
          throw new BlobValidationError('Private blob key already exists');
        }
        throw error;
      }
      linked = true;
      const publishedIdentity = await stat(target);
      if (
        publishedIdentity.dev !== temporaryIdentity.dev ||
        publishedIdentity.ino !== temporaryIdentity.ino
      ) {
        throw this.storageUnavailable();
      }
      try {
        await temporaryHandle.close();
        temporaryHandle = undefined;
        await this.unlinkFile(temporaryPath);
      } catch {
        throw this.storageUnavailable();
      }
      return {
        sizeBytes,
        sha256,
        detectedMimeType,
      };
    } catch (error) {
      let handleClosed = true;
      if (temporaryHandle !== undefined) {
        try {
          await temporaryHandle.close();
        } catch {
          handleClosed = false;
        }
      }
      const cleaned = linked
        ? await this.deletePaths([temporaryPath, target])
        : !ownsTemporary || (await this.deletePaths([temporaryPath]));
      if (!handleClosed || !cleaned) throw this.storageUnavailable();
      if (error instanceof BlobValidationError) throw error;
      if (error instanceof BlobStorageUnavailableError) throw error;
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new BlobValidationError('Private blob key already exists');
      }
      throw this.storageUnavailable();
    }
  }

  async open(storageKey: string): Promise<NodeJS.ReadableStream> {
    const target = this.resolveStorageKey(storageKey);
    try {
      await access(target);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new BlobNotFoundError('Private blob not found');
      }
      throw this.storageUnavailable();
    }
    return createReadStream(target);
  }

  async delete(storageKey: string): Promise<void> {
    const target = this.resolveStorageKey(storageKey);
    const temporaryPath = resolve(
      this.root,
      '.tmp',
      createHash('sha256').update(storageKey, 'utf8').digest('hex'),
    );
    if (!(await this.deletePaths([temporaryPath, target]))) {
      throw this.storageUnavailable();
    }
  }

  async health(): Promise<'ready' | 'unavailable'> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await access(this.root);
      return 'ready';
    } catch {
      return 'unavailable';
    }
  }

  private resolveStorageKey(storageKey: string): string {
    if (
      storageKey.length === 0 ||
      isAbsolute(storageKey) ||
      storageKey.includes('\\') ||
      storageKey
        .split('/')
        .some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment))
    ) {
      throw new BlobValidationError('Invalid storage key');
    }
    const target = resolve(this.root, ...storageKey.split('/'));
    const relativePath = relative(this.root, target);
    if (
      relativePath.length === 0 ||
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new BlobValidationError('Invalid storage key');
    }
    return target;
  }

  private async deletePaths(paths: string[]): Promise<boolean> {
    let cleaned = true;
    for (const path of paths) {
      try {
        await this.unlinkFile(path);
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') cleaned = false;
      }
    }
    return cleaned;
  }

  private storageUnavailable(): BlobStorageUnavailableError {
    return new BlobStorageUnavailableError(
      'Private blob storage is unavailable',
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  );
}
