import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { HttpErrorDto } from '../common/http-error.dto';
import { HealthResponseDto } from './health-response.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HttpErrorDto })
  async check(): Promise<HealthResponseDto> {
    try {
      await this.database.ping();
      return { status: 'ok', database: 'up' };
    } catch (cause) {
      throw new ServiceUnavailableException(
        { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时不可用' },
        { cause },
      );
    }
  }
}
