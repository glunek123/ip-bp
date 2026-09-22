import { ApiProperty } from '@nestjs/swagger';

class AuthUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() username!: string;
}

class AuthDepartmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

class AuthCustomerResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class AuthSessionResponseDto {
  @ApiProperty({ type: () => AuthUserResponseDto })
  user!: AuthUserResponseDto;

  @ApiProperty({ enum: ['INTERNAL', 'CLIENT'] })
  principalType!: 'INTERNAL' | 'CLIENT';

  @ApiProperty({
    type: () => AuthDepartmentResponseDto,
    nullable: true,
  })
  department!: AuthDepartmentResponseDto | null;

  @ApiProperty({ type: () => [AuthDepartmentResponseDto] })
  departments!: AuthDepartmentResponseDto[];

  @ApiProperty({ type: () => AuthCustomerResponseDto, nullable: true })
  customer!: AuthCustomerResponseDto | null;

  @ApiProperty({ minimum: 1 }) authorizationRevision!: number;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty() csrfToken!: string;
}
