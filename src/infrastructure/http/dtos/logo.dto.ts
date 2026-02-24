import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, Matches } from 'class-validator';

export class LogoFetchQueryDto {
  @ApiPropertyOptional({
    description: 'Dominio de la empresa (opcional si se da name)',
    example: 'alicorp.com.pe',
  })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({
    description: 'RUC de la empresa (opcional, para nombrar el archivo)',
    example: '20100055237',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'RUC debe ser exactamente 11 dígitos' })
  ruc?: string;

  @ApiPropertyOptional({
    description: 'Nombre comercial de la empresa (opcional si se da domain)',
    example: 'Alicorp',
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export class LogoFetchResponseDto {
  @ApiProperty({ description: 'Si la operación fue exitosa' })
  success: boolean;

  @ApiProperty({ description: 'Dominio consultado' })
  domain: string;

  @ApiPropertyOptional({ description: 'Nombre comercial consultado', nullable: true })
  name: string | null;

  @ApiPropertyOptional({ description: 'Proveedor que resolvió el logo', nullable: true })
  provider: string | null;

  @ApiPropertyOptional({ description: 'URL pública del logo en el bucket', nullable: true })
  bucketUrl: string | null;

  @ApiPropertyOptional({ description: 'Nombre del objeto en el bucket', nullable: true })
  objectName: string | null;

  @ApiPropertyOptional({ description: 'Formato de imagen', nullable: true })
  format: string | null;

  @ApiPropertyOptional({ description: 'Tamaño en bytes', nullable: true })
  sizeBytes: number | null;

  @ApiProperty({ description: 'Duración de la operación en ms' })
  durationMs: number;

  @ApiPropertyOptional({ description: 'Mensaje de error si falló', nullable: true })
  error: string | null;
}
