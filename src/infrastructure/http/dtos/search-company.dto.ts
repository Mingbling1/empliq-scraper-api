import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SearchStrategy } from '../../../domain/enums/search-strategy.enum';

/**
 * DTO para buscar la web oficial de una empresa.
 * Validado con class-validator (equivalente a Pydantic).
 */
export class SearchCompanyDto {
  @ApiProperty({
    description: 'Nombre de la empresa (puede incluir SAC, SRL, etc.)',
    example: 'INTERBANK',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la empresa es requerido' })
  @MinLength(2, { message: 'Nombre muy corto (mín. 2 caracteres)' })
  @MaxLength(200, { message: 'Nombre muy largo (máx. 200 caracteres)' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  q!: string;

  @ApiPropertyOptional({
    description: 'Estrategia específica a usar. Si no se indica, el orquestador elige automáticamente.',
    enum: SearchStrategy,
    example: SearchStrategy.DDG_HTTP,
  })
  @IsOptional()
  @IsEnum(SearchStrategy, {
    message: `Estrategia inválida. Opciones: ${Object.values(SearchStrategy).join(', ')}`,
  })
  strategy?: SearchStrategy;
}
