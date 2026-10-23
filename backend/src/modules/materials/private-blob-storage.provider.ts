import { ConfigService } from '@nestjs/config';
import { Environment } from '../../common/environment';
import { LocalPrivateBlobStorage } from './local-private-blob-storage';
import {
  PrivateBlobStorage,
  UnavailablePrivateBlobStorage,
} from './private-blob-storage';

export function createPrivateBlobStorage(
  config: ConfigService<Environment>,
): PrivateBlobStorage {
  if (
    config.getOrThrow<Environment['NODE_ENV']>('NODE_ENV') === 'production' &&
    config.get<Environment['PRIVATE_BLOB_STORAGE_DRIVER']>(
      'PRIVATE_BLOB_STORAGE_DRIVER',
    ) !== 'local'
  ) {
    return new UnavailablePrivateBlobStorage();
  }
  return new LocalPrivateBlobStorage(
    config.getOrThrow<string>('PRIVATE_FILE_ROOT'),
  );
}
