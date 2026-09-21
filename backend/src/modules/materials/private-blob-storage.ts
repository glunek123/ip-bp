export const PRIVATE_BLOB_STORAGE = Symbol('PRIVATE_BLOB_STORAGE');

export interface PrivateBlobStorage {
  put(
    storageKey: string,
    source: NodeJS.ReadableStream,
  ): Promise<{
    sizeBytes: number;
    sha256: string;
    detectedMimeType: string;
  }>;
  open(storageKey: string): Promise<NodeJS.ReadableStream>;
  delete(storageKey: string): Promise<void>;
  health(): Promise<'ready' | 'unavailable'>;
}

export class BlobValidationError extends Error {}
export class BlobNotFoundError extends Error {}
export class BlobStorageUnavailableError extends Error {}

export class UnavailablePrivateBlobStorage implements PrivateBlobStorage {
  async put(): Promise<never> {
    throw new BlobStorageUnavailableError(
      'Private blob storage is unavailable',
    );
  }

  async open(): Promise<never> {
    throw new BlobStorageUnavailableError(
      'Private blob storage is unavailable',
    );
  }

  async delete(): Promise<never> {
    throw new BlobStorageUnavailableError(
      'Private blob storage is unavailable',
    );
  }

  async health(): Promise<'unavailable'> {
    return 'unavailable';
  }
}
