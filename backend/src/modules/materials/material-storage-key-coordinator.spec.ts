import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';

describe('MaterialStorageKeyCoordinator', () => {
  it('keeps a same-key waiter outside the complete critical section', async () => {
    const coordinator = new MaterialStorageKeyCoordinator();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const events: string[] = [];

    const first = coordinator.withKey('private/key', async () => {
      events.push('first:start');
      firstEntered.resolve();
      await releaseFirst.promise;
      events.push('first:end');
    });
    await firstEntered.promise;
    const second = coordinator.withKey('private/key', async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not serialize unrelated storage keys', async () => {
    const coordinator = new MaterialStorageKeyCoordinator();
    const releaseFirst = deferred<void>();
    let secondEntered = false;

    const first = coordinator.withKey('first/key', () => releaseFirst.promise);
    await coordinator.withKey('second/key', async () => {
      secondEntered = true;
    });

    expect(secondEntered).toBe(true);
    releaseFirst.resolve();
    await first;
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
