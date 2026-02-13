import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsUrl,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO para scraping directo de una URL.
 */
export class ScrapeUrlDto {
  @ApiProperty({
    description: 'URL de la página web de la empresa',
    example: 'https://interbank.pe/',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({}, { message: 'Debe ser una URL válida (http:// o https://)' })
  url!: string;

  @ApiPropertyOptional({
    description: 'Navegar a sub-páginas (/nosotros, /contacto). Default: true',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value === 'true';
    return value;
  })
  followSubpages?: boolean;

  @ApiPropertyOptional({
    description: 'Timeout total en ms. Default: 30000',
    default: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    description: 'Máximo de sub-páginas a visitar. Default: 3',
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxSubpages?: number;
}

/**
 * DTO para buscar + scraping en un solo paso.
 */
export class SearchAndScrapeDto {
  @ApiProperty({
    description: 'Nombre de la empresa a buscar y scrapear',
    example: 'INTERBANK',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  company!: string;

  @ApiPropertyOptional({
    description: 'Navegar a sub-páginas. Default: true',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value === 'true';
    return value;
  })
  followSubpages?: boolean;

  @ApiPropertyOptional({
    description: 'Timeout total en ms. Default: 30000',
    default: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(120000)
  timeoutMs?: number;
}
