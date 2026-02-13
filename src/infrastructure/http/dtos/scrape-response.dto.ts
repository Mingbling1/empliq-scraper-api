import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompanyProfileResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'https://interbank.pe/' })
  sourceUrl!: string;

  @ApiPropertyOptional({ example: 'Interbank' })
  name!: string | null;

  @ApiPropertyOptional({ example: 'Banco Internacional del Perú...' })
  description!: string | null;

  @ApiPropertyOptional({ example: 'El Banco Internacional del Perú se fundó el 1 de mayo de 1897...' })
  history!: string | null;

  @ApiPropertyOptional({ example: 1897 })
  foundedYear!: number | null;

  @ApiPropertyOptional({ example: '1 de mayo de 1897' })
  foundedDate!: string | null;

  @ApiPropertyOptional({ example: 'Banco Internacional del Perú' })
  originalName!: string | null;

  @ApiPropertyOptional({ example: 'Av. Carlos Villarán 140, Lima' })
  headquarters!: string | null;

  @ApiProperty({ example: ['+51 1 311-9000', '993119000'] })
  phones!: string[];

  @ApiProperty({ example: ['contacto@interbank.pe'] })
  emails!: string[];

  @ApiPropertyOptional({ example: '20100053455' })
  ruc!: string | null;

  @ApiPropertyOptional({ example: 'Banca y Finanzas' })
  industry!: string | null;

  @ApiPropertyOptional({ example: 'https://interbank.pe/logo.svg', description: 'URL del logo (SVG, PNG, JPG)' })
  logoUrl!: string | null;

  @ApiPropertyOptional({ example: 'Ser el mejor banco...' })
  mission!: string | null;

  @ApiPropertyOptional({ example: 'Dar acceso a...' })
  vision!: string | null;

  @ApiProperty({ example: ['Integridad', 'Innovación'] })
  values!: string[];

  @ApiProperty({ example: ['Grupo Rodríguez-Pastor'] })
  shareholders!: string[];

  @ApiPropertyOptional({ example: 'más de 7,000 colaboradores' })
  employeeCount!: string | null;

  @ApiPropertyOptional({ example: '207+ tiendas, 1400+ cajeros' })
  coverage!: string | null;

  @ApiProperty({ example: { facebook: 'https://facebook.com/InterBankPeru' } })
  socialLinks!: Record<string, string>;

  @ApiProperty({ example: ['https://interbank.pe/', 'https://interbank.pe/nosotros'] })
  pagesScraped!: string[];

  @ApiProperty({ example: {} })
  extras!: Record<string, string>;

  @ApiProperty({ example: 8 })
  fieldsExtracted!: number;

  @ApiProperty({ example: 4520 })
  durationMs!: number;

  @ApiProperty({ example: '2026-02-13T10:30:00.000Z' })
  scrapedAt!: string;
}

export class SearchAndScrapeResponseDto {
  @ApiProperty()
  search!: {
    found: boolean;
    website: string | null;
    score: number;
    strategy: string;
  };

  @ApiPropertyOptional({ type: CompanyProfileResponseDto, nullable: true })
  profile!: CompanyProfileResponseDto | null;

  @ApiProperty({ example: '2026-02-13T10:30:00.000Z' })
  timestamp!: string;
}
