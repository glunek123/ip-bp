import {
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

function ownerAt(path) {
  try {
    return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

export function acquireLocalLock(root, name, options = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(name))
    throw new Error(`Invalid local lock name: ${name}`);
  mkdirSync(root, { recursive: true });
  const path = join(root, `${name}.lock`);
  const token = randomUUID();
  const owner = {
    pid: options.ownerPid ?? process.pid,
    token,
    startedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(path);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const current = ownerAt(path);
    const suffix = current?.pid ? ` (owner PID ${current.pid})` : '';
    throw new Error(
      `Lock ${name} is already locked${suffix}; confirm the owner process and its children have ended before manual recovery`,
    );
  }
  try {
    writeFileSync(join(path, 'owner.json'), `${JSON.stringify(owner)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    rmdirSync(path);
    throw error;
  }

  let released = false;
  return {
    path,
    release() {
      if (released) return;
      const current = ownerAt(path);
      if (current?.token !== token)
        throw new Error(`Lock ${name} is no longer owned by this process`);
      unlinkSync(join(path, 'owner.json'));
      rmdirSync(path);
      released = true;
    },
  };
}
