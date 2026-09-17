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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(ActorContextGuard)
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

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

  @Get(':id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customers.get(actor, id);
  }
}
