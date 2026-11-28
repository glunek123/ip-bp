import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadNotaryDeleteService } from './lead-notary-delete.service';

export class DeleteLeadOrNotaryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

@ApiTags('leads')
@ApiBearerAuth()
@Controller()
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadNotaryDeleteController {
  constructor(private readonly deletion: LeadNotaryDeleteService) {}

  @Delete('leads/:id')
  removeLead(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteLeadOrNotaryDto,
  ) {
    return this.deletion.removeLead(actor, id, {
      reason: body?.reason ?? null,
      expectedVersion: body?.expectedVersion ?? null,
    });
  }

  @Delete('notary-matters/:id')
  removeNotaryMatter(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteLeadOrNotaryDto,
  ) {
    return this.deletion.removeNotaryMatter(actor, id, {
      reason: body?.reason ?? null,
      expectedVersion: body?.expectedVersion ?? null,
    });
  }
}
