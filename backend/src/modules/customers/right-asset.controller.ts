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
import { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateRightAssetDto,
  ReviseRightAssetDto,
  RightAssetListQueryDto,
  WithdrawRightAssetDto,
} from './right-asset.dto';
import { RightAssetService } from './right-asset.service';

@ApiTags('customer-right-assets')
@ApiBearerAuth()
@Controller('customers/:customerId/right-assets')
@UseGuards(ActorContextGuard, CsrfGuard)
export class RightAssetController {
  constructor(private readonly assets: RightAssetService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: RightAssetListQueryDto,
  ) {
    return this.assets.list(actor, customerId, query.page, query.pageSize);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateRightAssetDto,
  ) {
    return this.assets.create(actor, customerId, this.key(key), input);
  }

  @Get(':assetId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    return this.assets.get(actor, customerId, assetId);
  }

  @Post(':assetId/revisions')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revise(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ReviseRightAssetDto,
  ) {
    return this.assets.revise(actor, customerId, assetId, this.key(key), input);
  }

  @Post(':assetId/withdraw')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  withdraw(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: WithdrawRightAssetDto,
  ) {
    return this.assets.withdraw(
      actor,
      customerId,
      assetId,
      this.key(key),
      input,
    );
  }

  private key(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 200)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 200 个字符',
      });
    return key;
  }
}
