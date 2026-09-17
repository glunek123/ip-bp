import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ActorContext as ActorContextValue } from './actor-context';
import { AuthenticatedRequest } from './actor-context.guard';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContextValue => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.actor === undefined) {
      throw new Error('ActorContextGuard must run before CurrentActor');
    }
    return request.actor;
  },
);
