import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
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
  CancelSettlementBillDto,
  CreateSettlementBillDto,
  LaunchCaseSettlementDto,
  SettlementPageDto,
  SettlementSideDtoValue,
  UpdateCaseSettlementTermsDto,
  PreviewSettlementBillDto,
} from './settlement.dto';
import { SettlementService } from './settlement.service';
import { settlementResponses as responses } from './settlement-openapi';

@ApiTags('settlements')
@ApiBearerAuth()
@Controller('settlements')
@UseGuards(ActorContextGuard, CsrfGuard)
export class SettlementController {
  constructor(private readonly service: SettlementService) {}

  @Get('context')
  @ApiOkResponse({ schema: responses.context })
  context(@CurrentActor() actor: ActorContext) {
    return this.service.context(actor);
  }

  @Get('cases/:caseId')
  @ApiOkResponse({ schema: responses.caseDetail })
  caseDetail(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
  ) {
    return this.service.caseDetail(actor, caseId);
  }

  @Put('cases/:caseId/terms')
  @ApiOkResponse({ schema: responses.termsReceipt })
  updateTerms(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() input: UpdateCaseSettlementTermsDto,
  ) {
    return this.service.updateTerms(actor, caseId, input);
  }

  @Post('cases/:caseId/launches')
  @ApiCreatedResponse({ schema: responses.launchReceipt })
  launch(
    @CurrentActor() actor: ActorContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() input: LaunchCaseSettlementDto,
  ) {
    return this.service.launch(actor, caseId, input);
  }

  @Get('launches')
  @ApiOkResponse({ schema: responses.launches })
  launches(
    @CurrentActor() actor: ActorContext,
    @Query('side', new ParseEnumPipe(SettlementSideDtoValue))
    side: SettlementSideDtoValue,
    @Query() query: SettlementPageDto,
  ) {
    return this.service.launches(actor, side, query);
  }

  @Get('bills')
  @ApiOkResponse({ schema: responses.bills })
  bills(
    @CurrentActor() actor: ActorContext,
    @Query('side', new ParseEnumPipe(SettlementSideDtoValue))
    side: SettlementSideDtoValue,
    @Query() query: SettlementPageDto,
  ) {
    return this.service.bills(actor, side, query);
  }

  @Post('bills')
  @ApiCreatedResponse({ schema: responses.billReceipt })
  createBill(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateSettlementBillDto,
  ) {
    return this.service.createBill(actor, input);
  }

  @Get('bills/:billId')
  @ApiOkResponse({ schema: responses.billDetail })
  billDetail(
    @CurrentActor() actor: ActorContext,
    @Param('billId', new ParseUUIDPipe()) billId: string,
  ) {
    return this.service.billDetail(actor, billId);
  }

  @Get('bill-number-preview')
  @ApiOkResponse({ schema: responses.billPreview })
  previewBillNumber(
    @CurrentActor() actor: ActorContext,
    @Query() query: PreviewSettlementBillDto,
  ) {
    return this.service.previewBillNumber(actor, query.billDate);
  }

  @Post('bills/:billId/cancel')
  @ApiCreatedResponse({ schema: responses.billCancelReceipt })
  cancelBill(
    @CurrentActor() actor: ActorContext,
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Body() input: CancelSettlementBillDto,
  ) {
    return this.service.cancelBill(actor, billId, input);
  }
}
