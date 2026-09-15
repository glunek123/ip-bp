import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HttpErrorDto {
  @ApiProperty({ example: 'DATABASE_UNAVAILABLE' })
  code!: string;

  @ApiProperty({ example: '数据库暂时不可用' })
  message!: string;

  @ApiProperty({ format: 'uuid' })
  requestId!: string;

  @ApiPropertyOptional({ type: [String] })
  details?: string[];
}
