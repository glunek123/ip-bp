import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CreateLeadDto, LeadListQueryDto, UpdateLeadDto } from './lead.dto';
import { LeadService } from './lead.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadController {
  constructor(private readonly leads: LeadService) {}

  @Get('form-context') formContext(@CurrentActor() actor: ActorContext) {
    return this.leads.formContext(actor);
  }
  @Get() list(
    @CurrentActor() actor: ActorContext,
    @Query() query: LeadListQueryDto,
  ) {
    return this.leads.list(actor, query.page, query.pageSize);
  }
  @Get(':id') get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.leads.get(actor, id);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateLeadDto,
  ) {
    return this.leads.create(
      actor,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateLeadDto,
  ) {
    return this.leads.update(actor, id, input);
  }

  private requireIdempotencyKey(value: string | undefined) {
    const key = value?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return key;
  }
}
