import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  assertBatch2ImportOwnedRuntime,
  syntheticImageBytes,
  syntheticImageUrl,
} from './batch2-lead-import-fixture.mjs';

// Dedicated I acceptance server. Only the image resolver/transport is replaced;
// Nest routes, auth, the task worker, MaterialService, and private storage run.
async function main() {
  assertBatch2ImportOwnedRuntime();
  const requireBackend = createRequire(
    resolve(process.cwd(), 'backend/package.json'),
  );
  requireBackend('reflect-metadata');
  const { Test } = requireBackend('@nestjs/testing');
  const { AppModule } = requireBackend('./dist/app.module.js');
  const { configureApp } = requireBackend('./dist/common/configure-app.js');
  const { LEAD_IMAGE_DOWNLOADER } = requireBackend(
    './dist/modules/leads/lead-image-import.service.js',
  );
  const { downloadLeadImage, RemoteImageError } = requireBackend(
    './dist/modules/leads/lead-remote-image.js',
  );
  const downloader = (raw) =>
    downloadLeadImage(raw, {
      resolve: async (host) => {
        if (host === 'synthetic.batch2.test')
          return [{ address: '8.8.8.8', family: 4 }];
        if (/^203\.0\.113\.[0-9]{1,3}$/u.test(host))
          return [{ address: host, family: 4 }];
        throw new RemoteImageError('BLOCKED_ADDRESS');
      },
      transport: async (url, address) => {
        if (url.href !== syntheticImageUrl || address.address !== '8.8.8.8')
          throw new RemoteImageError('BLOCKED_ADDRESS');
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: syntheticImageBytes,
        };
      },
    });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LEAD_IMAGE_DOWNLOADER)
    .useValue(downloader)
    .compile();
  const app = module.createNestApplication();
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(3101, '127.0.0.1');
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'I acceptance app failed',
  );
  process.exitCode = 1;
});
