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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateNotaryOfficeDto,
  SetNotaryOfficeStatusDto,
  TransferLeadToNotaryDto,
} from './lead-notary.dto';
import { LeadNotaryService } from './lead-notary.service';

@ApiTags('notary-offices')
@ApiBearerAuth()
@Controller('notary-offices')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryOfficeController {
  constructor(private readonly notary: LeadNotaryService) {}

  @Get()
  list(@CurrentActor() actor: ActorContext) {
    return this.notary.listOffices(actor);
  }

  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateNotaryOfficeDto,
  ) {
    return this.notary.createOffice(actor, input);
  }

  @Patch(':id/status')
  deactivate(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SetNotaryOfficeStatusDto,
  ) {
    return this.notary.deactivateOffice(actor, id, input);
  }
}

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller()
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadNotaryController {
  constructor(private readonly notary: LeadNotaryService) {}

  @Post('leads/:id/notary-matters')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  transfer(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: TransferLeadToNotaryDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.notary.transfer(actor, id, key, input);
  }

  @Get('notary-matters/:id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notary.getMatter(actor, id);
  }
}
