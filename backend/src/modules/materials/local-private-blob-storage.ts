import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open as openFile,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { containsPdfEncryptionToken, detectMimeType } from './file-signature';
import {
  BlobNotFoundError,
  BlobValidationError,
  PrivateBlobStorage,
} from './private-blob-storage';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SIGNATURE_BYTES = 12;
const PDF_TOKEN_OVERLAP = 7;

export class LocalPrivateBlobStorage implements PrivateBlobStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
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
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await this.assertTargetMissing(target);
    const temporaryDirectory = resolve(this.root, '.tmp');
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = resolve(temporaryDirectory, randomUUID());
    const hash = createHash('sha256');
    let sizeBytes = 0;
    let prefix = Buffer.alloc(0);
    let pdfTail = Buffer.alloc(0);
    let encryptedPdf = false;

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
      await pipeline(
        source,
        inspector,
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
      );
      const detectedMimeType = detectMimeType(prefix);
      if (detectedMimeType === 'application/pdf' && encryptedPdf) {
        throw new BlobValidationError('encrypted PDF files are not accepted');
      }
      const handle = await openFile(temporaryPath, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.assertTargetMissing(target);
      await rename(temporaryPath, target);
      return {
        sizeBytes,
        sha256: hash.digest('hex'),
        detectedMimeType,
      };
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async open(storageKey: string): Promise<NodeJS.ReadableStream> {
    const target = this.resolveStorageKey(storageKey);
    try {
      await access(target);
    } catch {
      throw new BlobNotFoundError('Private blob not found');
    }
    return createReadStream(target);
  }

  async delete(storageKey: string): Promise<void> {
    const target = this.resolveStorageKey(storageKey);
    await unlink(target).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    });
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

  private async assertTargetMissing(target: string): Promise<void> {
    try {
      await access(target);
      throw new BlobValidationError('Private blob key already exists');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
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
