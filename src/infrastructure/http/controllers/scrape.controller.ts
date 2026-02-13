import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { CompanyProfileService } from '../../../application/services/company-profile.service';
import { ScrapeUrlDto, SearchAndScrapeDto } from '../dtos/scrape.dto';
import {
  CompanyProfileResponseDto,
  SearchAndScrapeResponseDto,
} from '../dtos/scrape-response.dto';
import { CompanyProfile } from '../../../domain/entities/company-profile.entity';

@ApiTags('Scrape')
@ApiSecurity('x-api-key')
@Controller('scrape')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ScrapeController {
  private readonly logger = new Logger(ScrapeController.name);

  constructor(private readonly profileService: CompanyProfileService) {}

  /**
   * POST /scrape/url
   * Scraping directo de una URL conocida.
   */
  @Post('url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Extraer datos de la web de una empresa (URL conocida)',
    description:
      'Dado un URL, visita la página principal y sub-páginas (/nosotros, /contacto) ' +
      'para extraer: nombre, descripción, historia, fundación, dirección, teléfonos, ' +
      'emails, RUC, misión, visión, valores, redes sociales, etc.\n\n' +
      'Todo HTTP puro — sin browser — ~3-8s.',
  })
  @ApiResponse({ status: 200, type: CompanyProfileResponseDto })
  async scrapeUrl(@Body() dto: ScrapeUrlDto): Promise<CompanyProfileResponseDto> {
    this.logger.log(`🕷️ Scrape URL: ${dto.url}`);

    const profile = await this.profileService.scrapeUrl(dto.url, {
      followSubpages: dto.followSubpages,
      timeoutMs: dto.timeoutMs,
      maxSubpages: dto.maxSubpages,
    });

    return this.mapProfile(profile);
  }

  /**
   * POST /scrape/company
   * Busca la web oficial + scraping en un solo paso.
   */
  @Post('company')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Buscar web oficial + extraer datos (todo en uno)',
    description:
      'Dado un nombre de empresa:\n' +
      '1. Busca su web oficial (DDG/Bing HTTP)\n' +
      '2. Visita la web y extrae datos del perfil\n\n' +
      'Combina `/search` + `/scrape/url` en una sola llamada.\n' +
      'Ideal para n8n o batch processing.',
  })
  @ApiResponse({ status: 200, type: SearchAndScrapeResponseDto })
  async searchAndScrape(
    @Body() dto: SearchAndScrapeDto,
  ): Promise<SearchAndScrapeResponseDto> {
    this.logger.log(`🔍➜🕷️ Search+Scrape: "${dto.company}"`);

    const { profile, searchResult } = await this.profileService.searchAndScrape(
      dto.company,
      {
        followSubpages: dto.followSubpages,
        timeoutMs: dto.timeoutMs,
      },
    );

    return {
      search: searchResult,
      profile: profile ? this.mapProfile(profile) : null,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────

  private mapProfile(profile: CompanyProfile): CompanyProfileResponseDto {
    return {
      success: profile.fieldsExtracted > 0,
      sourceUrl: profile.sourceUrl,
      name: profile.name,
      description: profile.description,
      history: profile.history,
      foundedYear: profile.foundedYear,
      foundedDate: profile.foundedDate,
      originalName: profile.originalName,
      headquarters: profile.headquarters,
      phones: profile.phones,
      emails: profile.emails,
      ruc: profile.ruc,
      industry: profile.industry,
      logoUrl: profile.logoUrl,
      mission: profile.mission,
      vision: profile.vision,
      values: profile.values,
      shareholders: profile.shareholders,
      employeeCount: profile.employeeCount,
      coverage: profile.coverage,
      socialLinks: profile.socialLinks,
      pagesScraped: profile.pagesScraped,
      extras: profile.extras,
      fieldsExtracted: profile.fieldsExtracted,
      durationMs: profile.durationMs,
      scrapedAt: profile.scrapedAt.toISOString(),
    };
  }
}
