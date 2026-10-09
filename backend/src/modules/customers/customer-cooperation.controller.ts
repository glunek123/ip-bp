import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CustomerListQueryDto } from './customer.dto';
import {
  CustomerCooperationDto,
  CustomerResponsibleTransferDto,
} from './customer-cooperation.dto';
import { CustomerCooperationService } from './customer-cooperation.service';
import {
  CustomerMaintenanceResultDto,
  EligibleOperatorPageDto,
} from './customer-cooperation-response.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CustomerCooperationController {
  constructor(private readonly cooperation: CustomerCooperationService) {}

  @Get(':id/eligible-operators')
  @ApiOkResponse({ type: EligibleOperatorPageDto })
  eligibleOperators(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: CustomerListQueryDto,
  ) {
    return this.cooperation.eligibleOperators(
      actor,
      id,
      query.page,
      query.pageSize,
    );
  }

  @Post(':id/responsible-transfer')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: CustomerMaintenanceResultDto })
  transferResponsible(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CustomerResponsibleTransferDto,
  ) {
    return this.cooperation.transferResponsible(
      actor,
      id,
      this.requireKey(key),
      input,
    );
  }

  @Post(':id/cooperation')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: CustomerMaintenanceResultDto })
  changeCooperation(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CustomerCooperationDto,
  ) {
    return this.cooperation.changeCooperation(
      actor,
      id,
      this.requireKey(key),
      input,
    );
  }

  private requireKey(value: string | undefined): string {
    const key = value?.trim();
    if (key === undefined || key.length < 1 || key.length > 128) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    }
    return key;
  }
}
