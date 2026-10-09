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
import { CustomerAgreementInvoiceService } from './customer-agreement-invoice.service';
import {
  AgreementResponseDto,
  AgreementVersionListResponseDto,
  CreateAgreementDto,
  CreateInvoiceProfileDto,
  CustomerDocumentVersionQueryDto,
  InvoiceResponseDto,
  InvoiceVersionListResponseDto,
  ReviseAgreementDto,
  ReviseInvoiceProfileDto,
} from './customer-agreement-invoice.dto';

@ApiTags('customer-agreements-invoice')
@ApiBearerAuth()
@Controller('customers/:customerId')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CustomerAgreementInvoiceController {
  constructor(private readonly service: CustomerAgreementInvoiceService) {}

  private key(value: string | undefined): string {
    if (!value || value.length > 200)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 无效',
      });
    return value;
  }

  @Get('agreements')
  @ApiOkResponse({ type: AgreementResponseDto })
  getAgreement(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.service.getAgreement(actor, customerId);
  }

  @Post('agreements')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: AgreementResponseDto })
  createAgreement(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateAgreementDto,
  ) {
    return this.service.createAgreement(
      actor,
      customerId,
      this.key(key),
      input,
    );
  }

  @Get('agreements/:agreementId')
  @ApiOkResponse({ type: AgreementResponseDto })
  agreement(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('agreementId', new ParseUUIDPipe()) agreementId: string,
  ) {
    return this.service.getAgreement(actor, customerId, agreementId);
  }

  @Get('agreements/:agreementId/versions')
  @ApiOkResponse({ type: AgreementVersionListResponseDto })
  agreementVersions(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('agreementId', new ParseUUIDPipe()) agreementId: string,
    @Query() query: CustomerDocumentVersionQueryDto,
  ) {
    return this.service.agreementVersions(
      actor,
      customerId,
      agreementId,
      query,
    );
  }

  @Post('agreements/:agreementId/revisions')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: AgreementResponseDto })
  reviseAgreement(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('agreementId', new ParseUUIDPipe()) agreementId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ReviseAgreementDto,
  ) {
    return this.service.reviseAgreement(
      actor,
      customerId,
      agreementId,
      this.key(key),
      input,
    );
  }

  @Get('invoice-profile')
  @ApiOkResponse({ type: InvoiceResponseDto })
  invoice(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.service.getInvoice(actor, customerId);
  }

  @Get('invoice-profile/versions')
  @ApiOkResponse({ type: InvoiceVersionListResponseDto })
  invoiceVersions(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: CustomerDocumentVersionQueryDto,
  ) {
    return this.service.invoiceVersions(actor, customerId, query);
  }

  @Post('invoice-profile')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoice(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateInvoiceProfileDto,
  ) {
    return this.service.createInvoice(actor, customerId, this.key(key), input);
  }

  @Post('invoice-profile/revisions')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: InvoiceResponseDto })
  reviseInvoice(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ReviseInvoiceProfileDto,
  ) {
    return this.service.reviseInvoice(actor, customerId, this.key(key), input);
  }
}
