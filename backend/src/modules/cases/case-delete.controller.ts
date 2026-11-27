import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseDeleteService } from './case-delete.service';

export class DeleteCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseDeleteController {
  constructor(private readonly removal: CaseDeleteService) {}

  @Delete(':id')
  remove(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeleteCaseDto,
  ) {
    return this.removal.remove(actor, id, body?.reason ?? null);
  }
}
