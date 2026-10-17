import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import type { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateFeeDto,
  FeeCaseOptionsDto,
  FeeIdsDto,
  FeePageDto,
  UpdateFeeDto,
  UpdateFeeProofDto,
} from './fee.dto';
import { FeeService } from './fee.service';
import { settlementResponses } from './settlement-openapi';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
@UseGuards(ActorContextGuard, CsrfGuard)
export class FeeController {
  constructor(private readonly service: FeeService) {}

  @Get()
  @ApiOkResponse({ schema: settlementResponses.fees })
  list(@CurrentActor() actor: ActorContext, @Query() query: FeePageDto) {
    return this.service.list(actor, query);
  }

  @Post()
  @ApiCreatedResponse({ schema: settlementResponses.feeReceipt })
  create(@CurrentActor() actor: ActorContext, @Body() input: CreateFeeDto) {
    return this.service.create(actor, input);
  }

  @Get('case-options')
  @ApiOkResponse({ schema: settlementResponses.feeCaseOptions })
  caseOptions(
    @CurrentActor() actor: ActorContext,
    @Query() query: FeeCaseOptionsDto,
  ) {
    return this.service.caseOptions(actor, query);
  }

  @Patch(':feeId')
  @ApiOkResponse({ schema: settlementResponses.feeReceipt })
  update(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: UpdateFeeDto,
  ) {
    return this.service.update(actor, feeId, input);
  }

  @Post('launch')
  @ApiCreatedResponse({ schema: settlementResponses.feeBatchReceipt })
  launch(@CurrentActor() actor: ActorContext, @Body() input: FeeIdsDto) {
    return this.service.batch(actor, 'LAUNCH', input);
  }

  @Post(':feeId/proof')
  @ApiCreatedResponse({ schema: settlementResponses.feeReceipt })
  updateProof(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: UpdateFeeProofDto,
  ) {
    return this.service.updateProof(actor, feeId, input);
  }

  @Post('delete')
  @ApiCreatedResponse({ schema: settlementResponses.feeBatchReceipt })
  delete(@CurrentActor() actor: ActorContext, @Body() input: FeeIdsDto) {
    return this.service.batch(actor, 'DELETE', input);
  }
}
