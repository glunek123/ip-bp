import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import type { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CustomerSettlementService } from './customer-settlement.service';
import {
  CorrectCustomerSettlementDto,
  CustomerSettlementPageDto,
  RegisterCustomerSettlementDto,
} from './customer-settlement.dto';
import {
  CustomerSettlementCommandResponseDto,
  CustomerSettlementDetailResponseDto,
  CustomerSettlementListResponseDto,
  CustomerSettlementVersionListResponseDto,
} from './customer-settlement.response.dto';

@ApiTags('customer-settlements')
@ApiBearerAuth()
@Controller('customers/:customerId/settlements')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CustomerSettlementController {
  constructor(private readonly service: CustomerSettlementService) {}
  private key(value: string | undefined): string {
    if (!value || value.length > 200)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 无效',
      });
    return value;
  }

  @Get()
  @ApiOkResponse({ type: CustomerSettlementListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: CustomerSettlementPageDto,
  ) {
    return this.service.list(actor, customerId, query);
  }

  @Get(':recordId')
  @ApiOkResponse({ type: CustomerSettlementDetailResponseDto })
  detail(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
  ) {
    return this.service.detail(actor, customerId, recordId);
  }

  @Get(':recordId/versions')
  @ApiOkResponse({ type: CustomerSettlementVersionListResponseDto })
  versions(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
    @Query() query: CustomerSettlementPageDto,
  ) {
    return this.service.versions(actor, customerId, recordId, query);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: CustomerSettlementCommandResponseDto })
  register(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RegisterCustomerSettlementDto,
  ) {
    return this.service.register(actor, customerId, this.key(key), input);
  }

  @Post(':recordId/corrections')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: CustomerSettlementCommandResponseDto })
  correct(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CorrectCustomerSettlementDto,
  ) {
    return this.service.correct(
      actor,
      customerId,
      recordId,
      this.key(key),
      input,
    );
  }
}
