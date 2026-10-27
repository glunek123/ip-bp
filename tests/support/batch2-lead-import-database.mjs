import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { assertBatch2ImportTarget } from './batch2-lead-import-target.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jS8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Controlled PG + private-storage acceptance path. Call only with a newly
 * authorized owned test database, no other image worker against that target,
 * and a task created by the normal import route. It never performs network I/O.
 */
export async function attachSyntheticLeadImage(taskId) {
  assertBatch2ImportTarget();
  if (
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
    resolve(root, '.local/private-files/test')
  )
    throw new Error(
      'Batch-2 image acceptance requires the isolated private file root',
    );
  const { Test } = requireBackend('@nestjs/testing');
  const { AppModule } = requireBackend('./dist/app.module.js');
  const { DatabaseService } = requireBackend(
    './dist/database/database.service.js',
  );
  const { LEAD_IMAGE_DOWNLOADER } = requireBackend(
    './dist/modules/leads/lead-image-import.service.js',
  );
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LEAD_IMAGE_DOWNLOADER)
    .useValue(async () => ({ bytes: png, mimeType: 'image/png' }))
    .compile();
  const database = module.get(DatabaseService);
  const before = await database.leadImageImportTask.findUnique({
    where: { id: taskId },
  });
  if (!before || before.status !== 'PENDING') {
    await module.close();
    throw new Error(
      'Expected exactly one pending task in the owned acceptance target',
    );
  }
  const app = module.createNestApplication();
  await app.init();
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await database.leadImageImportTask.findUnique({
        where: { id: taskId },
        include: { contentVersion: { include: { material: true } } },
      });
      if (current?.status === 'ATTACHED') {
        if (
          !current.contentVersion ||
          current.contentVersion.material.ownerType !== 'LEAD' ||
          current.contentVersion.material.ownerId !== current.leadId
        )
          throw new Error(
            'Synthetic image was attached to the wrong private material owner',
          );
        const screenshot = await database.leadProductScreenshot.findFirst({
          where: {
            leadId: current.leadId,
            productId: current.productId,
            contentVersionId: current.contentVersionId,
          },
        });
        if (!screenshot)
          throw new Error(
            'Synthetic image version lacks the exact product association',
          );
        if (
          current.contentVersion.sha256 !==
          createHash('sha256').update(png).digest('hex')
        )
          throw new Error(
            'Stored synthetic image bytes do not match the injected PNG',
          );
        return {
          taskId,
          leadId: current.leadId,
          productId: current.productId,
          materialId: screenshot.materialId,
          contentVersionId: screenshot.contentVersionId,
          sha256: current.contentVersion.sha256,
        };
      }
      if (current?.status === 'FAILED')
        throw new Error(`Synthetic image task failed: ${current.failureCode}`);
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(
      'Synthetic image task did not finish within the bounded acceptance window',
    );
  } finally {
    await app.close();
  }
}
