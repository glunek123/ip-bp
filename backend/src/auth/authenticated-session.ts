import { ActorContext } from '../access-control/actor-context';

export type SessionAuthentication = {
  kind: 'session';
  sessionId: string;
  csrfDigest: string;
};

export type BearerAuthentication = { kind: 'bearer' };

export type Authentication = SessionAuthentication | BearerAuthentication;

export type ResolvedSession = {
  actor: ActorContext;
  authentication: SessionAuthentication;
};
