import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadImageImportService } from './lead-image-import.service';

class RetryLeadImageImportDto {
  @IsString() @MinLength(1) @MaxLength(2048) url!: string;
}

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadImageImportController {
  constructor(private readonly images: LeadImageImportService) {}

  @Get(':id/image-imports')
  list(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) leadId: string,
  ) {
    return this.images.list(actor, leadId);
  }

  @Post(':id/image-imports/:taskId/retry')
  retry(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) leadId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() input: RetryLeadImageImportDto,
  ) {
    return this.images.retry(actor, leadId, taskId, input.url);
  }
}
