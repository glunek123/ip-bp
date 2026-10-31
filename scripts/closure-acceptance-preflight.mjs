import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectTestDatabaseContainer } from './test-environment.mjs';

const imageId =
  'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stop = () => {
  throw new Error(
    'Closure acceptance preflight rejected; execution remains blocked',
  );
};

// Only SQL migration sources are read. No environment file or service is touched.
export function migrationManifest(root) {
  const directory = resolve(root, 'backend/prisma/migrations');
  const directoryEntries = readdirSync(directory, { withFileTypes: true });
  // Check before filtering: directory symlinks/junctions are not directories
  // according to Dirent and would otherwise silently disappear from the list.
  if (directoryEntries.some((entry) => entry.isSymbolicLink())) stop();
  const entries = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) stop();
  const migrations = entries.map((name) => {
    if (!/^\d{14}_[a-z0-9_]+$/u.test(name)) stop();
    const path = resolve(directory, name, 'migration.sql');
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) stop();
    return { name, sha256: sha256(readFileSync(path)) };
  });
  return { migrations, sha256: sha256(JSON.stringify(migrations)) };
}

export function assertMigrationManifest(expected, actual) {
  if (
    !Array.isArray(expected?.migrations) ||
    expected.migrations.length === 0 ||
    typeof expected.sha256 !== 'string' ||
    JSON.stringify(expected) !== JSON.stringify(actual)
  )
    stop();
}

// Pure, offline admission of a future captured inventory; this is not proof that
// Docker currently has these objects. A future executor must capture and recheck
// the inventories itself while holding the shared resource lock.
export function admitFreshClosureInstance({
  binding,
  before,
  containers,
  volumes,
  networks,
}) {
  if (
    !/^dev-cor-closure-acceptance-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
      binding?.project ?? '',
    ) ||
    !Number.isInteger(binding?.port) ||
    [15433, 15436, 15438, 15440, 55432].includes(binding.port) ||
    !/^[a-f0-9]{64}$/u.test(binding?.networkId ?? '') ||
    !Array.isArray(before?.projects) ||
    !Array.isArray(before?.containerIds) ||
    !Array.isArray(before?.volumeNames) ||
    !Array.isArray(before?.networkIds)
  )
    stop();
  const volume = `${binding.project}-pgdata`;
  if (
    before.projects.includes(binding.project) ||
    before.containerIds.includes(binding.containerId) ||
    before.volumeNames.includes(volume) ||
    before.networkIds.includes(binding.networkId)
  )
    stop();
  const selected = selectTestDatabaseContainer(
    {
      hostname: '127.0.0.1',
      username: 'dev_cor_test',
      database: 'dev_cor_test',
      port: binding.port,
    },
    containers,
    imageId,
    binding,
  );
  const container = containers.find((item) => item.Id === selected.containerId);
  const mounts = container.Mounts ?? [];
  const attachedNetworks = Object.values(
    container.NetworkSettings.Networks ?? {},
  );
  if (
    container.Config.Image !== `postgres:17.11-bookworm@${imageId}` ||
    mounts.length !== 1 ||
    mounts[0].Type !== 'volume' ||
    mounts[0].Name !== volume ||
    mounts[0].Destination !== '/var/lib/postgresql/data' ||
    mounts[0].RW !== true ||
    Object.keys(container.HostConfig?.Tmpfs ?? {}).length !== 0 ||
    attachedNetworks.length !== 1 ||
    attachedNetworks[0].NetworkID !== binding.networkId ||
    volumes.length !== 1 ||
    volumes[0].Name !== volume ||
    volumes[0].Labels?.['com.docker.compose.project'] !== binding.project ||
    networks.length !== 1 ||
    networks[0].Id !== binding.networkId ||
    networks[0].Name !== `${binding.project}_default` ||
    networks[0].Labels?.['com.docker.compose.project'] !== binding.project
  )
    stop();
  // Explicit identities only; no wildcard or project-wide cleanup command.
  return {
    containerId: selected.containerId,
    volumeName: volume,
    networkId: binding.networkId,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv.length !== 2) stop();
    console.log(
      JSON.stringify(
        {
          status: 'DRY_RUN_ONLY_EXECUTION_BLOCKED',
          manifest: migrationManifest(resolve(import.meta.dirname, '..')),
          blockers: [
            'No approved fixed candidate and reviewed manifest supplied',
            'Fresh creation and empty database proof require a separately reviewed executor',
            'Existing runners read .env.test and do not pin the migration manifest',
            'Gate replacement and screenshot targets remain unresolved; never disable triggers',
          ],
        },
        null,
        2,
      ),
    );
  } catch {
    console.error(
      'Closure acceptance preflight failed; no services were accessed',
    );
    process.exitCode = 1;
  }
}
