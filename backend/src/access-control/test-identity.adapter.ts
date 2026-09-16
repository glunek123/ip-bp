import { ActorContext } from './actor-context';

export class TestIdentityAdapter {
  private readonly actors = new Map<string, ActorContext>();

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'Test identity adapter is disabled outside NODE_ENV=test',
      );
    }
  }

  register(token: string, actor: ActorContext): void {
    this.actors.set(token, { ...actor });
  }

  resolve(token: string): ActorContext | null {
    const actor = this.actors.get(token);
    return actor === undefined ? null : { ...actor };
  }
}
