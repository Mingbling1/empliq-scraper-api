import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnrichByRucDto {
  @ApiProperty({
    description: 'RUC de la empresa (11 dígitos)',
    example: '20100047218',
  })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'El RUC debe tener exactamente 11 dígitos' })
  ruc: string;
}
