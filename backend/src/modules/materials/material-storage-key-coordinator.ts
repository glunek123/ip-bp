import { Injectable } from '@nestjs/common';

@Injectable()
export class MaterialStorageKeyCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async withKey<T>(
    storageKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(storageKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(storageKey, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(storageKey) === tail) {
        this.tails.delete(storageKey);
      }
    }
  }
}
