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
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import {
  CreateAndLinkRightsHolderDto,
  LinkableRightsHolderQueryDto,
  LinkExistingRightsHolderDto,
  RightsHolderListQueryDto,
} from './rights-holder.dto';
import { RightsHolderService } from './rights-holder.service';

@ApiTags('customer-rights-holders')
@ApiBearerAuth()
@Controller('customers/:customerId')
@UseGuards(ActorContextGuard)
export class RightsHolderController {
  constructor(private readonly rightsHolders: RightsHolderService) {}

  @Get('rights-holders')
  list(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: RightsHolderListQueryDto,
  ) {
    return this.rightsHolders.list(
      actor,
      customerId,
      query.page,
      query.pageSize,
    );
  }

  @Post('rights-holders')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createAndLink(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateAndLinkRightsHolderDto,
  ) {
    return this.rightsHolders.createAndLink(
      actor,
      customerId,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  @Get('rights-holders/:rightsHolderId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('rightsHolderId', new ParseUUIDPipe()) rightsHolderId: string,
  ) {
    return this.rightsHolders.get(actor, customerId, rightsHolderId);
  }

  @Get('linkable-rights-holders')
  findLinkable(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: LinkableRightsHolderQueryDto,
  ) {
    return this.rightsHolders.findLinkable(
      actor,
      customerId,
      query.query,
      query.page,
      query.pageSize,
    );
  }

  @Post('rights-holder-links')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  linkExisting(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: LinkExistingRightsHolderDto,
  ) {
    return this.rightsHolders.linkExisting(
      actor,
      customerId,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (key === undefined || key.length === 0 || key.length > 200) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 200 个字符',
      });
    }
    return key;
  }
}
