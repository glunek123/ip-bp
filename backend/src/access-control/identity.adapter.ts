import { Injectable } from '@nestjs/common';
import { ActorContext } from './actor-context';

export const IDENTITY_ADAPTER = Symbol('IDENTITY_ADAPTER');

export interface IdentityAdapter {
  resolve(token: string): ActorContext | null | Promise<ActorContext | null>;
}

@Injectable()
export class UnavailableIdentityAdapter implements IdentityAdapter {
  resolve(): null {
    return null;
  }
}
