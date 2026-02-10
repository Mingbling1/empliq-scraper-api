import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchStrategy } from '../../../domain/enums/search-strategy.enum';

// ──────────────────────────────────────────────────────────
// Response DTOs — solo para documentar la forma del JSON
// ──────────────────────────────────────────────────────────

export class SearchResultItemDto {
  @ApiProperty({ example: 'https://interbank.pe/' })
  url!: string;

  @ApiProperty({ example: 'Interbank - Banca Personal' })
  title!: string;

  @ApiProperty({ example: 27 })
  score!: number;
}

export class StrategyStatusDto {
  @ApiProperty({ enum: SearchStrategy, example: SearchStrategy.DDG_HTTP })
  strategy!: SearchStrategy;

  @ApiProperty({ example: true })
  available!: boolean;

  @ApiProperty({ example: 15 })
  usageCount!: number;

  @ApiProperty({ example: 200 })
  maxPerSession!: number;

  @ApiProperty({ example: 185 })
  remainingCapacity!: number;

  @ApiProperty({ example: 12 })
  successCount!: number;

  @ApiProperty({ example: 3 })
  failCount!: number;

  @ApiProperty({ example: 0.8 })
  successRate!: number;

  @ApiProperty({ example: 1500 })
  avgResponseTimeMs!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  cooldownUntil!: string | null;
}

export class SearchResponseDto {
  @ApiProperty({ example: true })
  found!: boolean;

  @ApiProperty({ example: 'INTERBANK' })
  company!: string;

  @ApiProperty({ example: 'INTERBANK' })
  cleanName!: string;

  @ApiPropertyOptional({ example: 'https://interbank.pe/', nullable: true })
  website!: string | null;

  @ApiProperty({ example: 27 })
  score!: number;

  @ApiPropertyOptional({ example: 'Interbank - Banca Personal', nullable: true })
  title!: string | null;

  @ApiProperty({ enum: SearchStrategy, example: SearchStrategy.DDG_HTTP })
  strategyUsed!: SearchStrategy;

  @ApiProperty({ type: [SearchResultItemDto] })
  allResults!: SearchResultItemDto[];

  @ApiProperty({
    description: 'Estado actual de todas las estrategias. Úsalo para saber si debes cambiar de método.',
    type: [StrategyStatusDto],
  })
  strategies!: StrategyStatusDto[];

  @ApiProperty({ example: '2026-02-10T15:30:00.000Z' })
  timestamp!: string;
}

export class BatchSearchItemResultDto {
  @ApiPropertyOptional({ example: '20100130204' })
  ruc?: string;

  @ApiProperty({ example: 'INTERBANK' })
  company!: string;

  @ApiProperty({ example: true })
  found!: boolean;

  @ApiPropertyOptional({ example: 'https://interbank.pe/', nullable: true })
  website!: string | null;

  @ApiProperty({ example: 27 })
  score!: number;

  @ApiProperty({ enum: SearchStrategy })
  strategyUsed!: SearchStrategy;
}

export class BatchSearchResponseDto {
  @ApiProperty({ example: 5 })
  total!: number;

  @ApiProperty({ example: 4 })
  found!: number;

  @ApiProperty({ example: 1 })
  notFound!: number;

  @ApiProperty({ type: [BatchSearchItemResultDto] })
  results!: BatchSearchItemResultDto[];

  @ApiProperty({ type: [StrategyStatusDto] })
  strategies!: StrategyStatusDto[];

  @ApiProperty({ example: '2026-02-10T15:30:00.000Z' })
  timestamp!: string;
}
