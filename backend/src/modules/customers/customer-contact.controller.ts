import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CustomerContactService } from './customer-contact.service';
import {
  ContactListQueryDto,
  ContactVersionListQueryDto,
  CreateContactDto,
  EndContactDto,
  SetContactPrimaryDto,
  UpdateContactDto,
} from './customer-contact.dto';
import {
  ContactCommandResultResponseDto,
  ContactListResponseDto,
  ContactVersionListResponseDto,
} from './customer-contact-response.dto';

@ApiTags('customer-contacts')
@ApiBearerAuth()
@Controller('customers/:customerId/contacts')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CustomerContactController {
  constructor(private readonly contacts: CustomerContactService) {}

  @Get()
  @ApiOkResponse({ type: ContactListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: ContactListQueryDto,
  ) {
    return this.contacts.list(actor, customerId, query);
  }

  @Get(':contactId/versions')
  @ApiOkResponse({ type: ContactVersionListResponseDto })
  versions(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Query() query: ContactVersionListQueryDto,
  ) {
    return this.contacts.versions(actor, customerId, contactId, query);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ContactCommandResultResponseDto })
  create(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateContactDto,
  ) {
    return this.contacts.create(actor, customerId, this.key(key), input);
  }

  @Patch(':contactId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ContactCommandResultResponseDto })
  update(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: UpdateContactDto,
  ) {
    return this.contacts.update(
      actor,
      customerId,
      contactId,
      this.key(key),
      input,
    );
  }

  @Post(':contactId/primary')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ContactCommandResultResponseDto })
  primary(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: SetContactPrimaryDto,
  ) {
    return this.contacts.primary(
      actor,
      customerId,
      contactId,
      this.key(key),
      input,
    );
  }

  @Post(':contactId/end')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ContactCommandResultResponseDto })
  end(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: EndContactDto,
  ) {
    return this.contacts.end(
      actor,
      customerId,
      contactId,
      this.key(key),
      input,
    );
  }

  private key(value: string | undefined) {
    if (value === undefined || value.length < 1 || value.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 无效',
      });
    return value;
  }
}
