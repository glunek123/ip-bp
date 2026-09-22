import { ApiProperty } from '@nestjs/swagger';

export class CustomerAccountResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() username!: string;
  @ApiProperty() accountActive!: boolean;
  @ApiProperty() bindingActive!: boolean;
  @ApiProperty({ minimum: 1 }) bindingVersion!: number;
}

export class CustomerAccountListResponseDto {
  @ApiProperty({ type: () => [CustomerAccountResponseDto] })
  items!: CustomerAccountResponseDto[];
}
