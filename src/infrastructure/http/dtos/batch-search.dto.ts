import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SearchStrategy } from '../../../domain/enums/search-strategy.enum';

class BatchCompanyItem {
  @ApiProperty({ example: '20100130204' })
  @IsOptional()
  @IsString()
  ruc?: string;

  @ApiProperty({ example: 'INTERBANK' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;
}

/**
 * DTO para búsqueda por lote.
 * Permite enviar hasta 50 empresas en una sola request.
 */
export class BatchSearchDto {
  @ApiProperty({
    description: 'Lista de empresas a buscar',
    type: [BatchCompanyItem],
    example: [
      { ruc: '20100130204', name: 'INTERBANK' },
      { ruc: '20100055237', name: 'ALICORP S.A.A.' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Mínimo 1 empresa' })
  @ArrayMaxSize(50, { message: 'Máximo 50 empresas por lote' })
  @ValidateNested({ each: true })
  @Type(() => BatchCompanyItem)
  companies!: BatchCompanyItem[];

  @ApiPropertyOptional({
    description: 'Estrategia forzada para todo el lote',
    enum: SearchStrategy,
  })
  @IsOptional()
  @IsEnum(SearchStrategy)
  strategy?: SearchStrategy;

  @ApiPropertyOptional({
    description: 'Delay entre búsquedas en ms (default: automático según estrategia)',
    example: 3000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  delayMs?: number;
}
