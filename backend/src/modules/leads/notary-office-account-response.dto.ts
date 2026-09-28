import { ApiProperty } from '@nestjs/swagger';

export class NotaryOfficeAccountResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() username!: string;
  @ApiProperty() accountActive!: boolean;
  @ApiProperty() bindingActive!: boolean;
  @ApiProperty({ minimum: 1 }) bindingVersion!: number;
}

export class NotaryOfficeAccountListResponseDto {
  @ApiProperty({ type: () => [NotaryOfficeAccountResponseDto] })
  items!: NotaryOfficeAccountResponseDto[];
}
