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
import {
  CreateCustomerDraftDto,
  CustomerDuplicatesQueryDto,
  CustomerListQueryDto,
  UpdateCustomerDraftDto,
} from './customer.dto';
import { CustomerService } from './customer.service';
import { CsrfGuard } from '../../auth/csrf.guard';
import { AdmitCustomerDto } from './customer-admission.dto';
import { CustomerAdmissionService } from './customer-admission.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly admissions: CustomerAdmissionService,
  ) {}

  @Post()
  createDraft(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateCustomerDraftDto,
  ) {
    return this.customers.createDraft(actor, input);
  }

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: CustomerListQueryDto,
  ) {
    return this.customers.list(actor, query.page, query.pageSize);
  }

  @Get('duplicates')
  findDuplicates(
    @CurrentActor() actor: ActorContext,
    @Query() query: CustomerDuplicatesQueryDto,
  ) {
    return this.customers.findDuplicates(actor, query);
  }

  @Patch(':id')
  updateDraft(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateCustomerDraftDto,
  ) {
    return this.customers.updateDraft(actor, id, input);
  }

  @Post(':id/admission')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  admit(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: AdmitCustomerDto,
  ) {
    return this.admissions.admit(
      actor,
      id,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  @Get(':id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customers.get(actor, id);
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (key === undefined || key.length === 0 || key.length > 128) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    }
    return key;
  }
}
