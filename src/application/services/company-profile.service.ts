import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  WebsiteScraperPort,
  WEBSITE_SCRAPER_PORT,
  ScrapeOptions,
} from '../../domain/ports/website-scraper.port';
import { CompanyProfile } from '../../domain/entities/company-profile.entity';
import { SearchOrchestratorService } from './search-orchestrator.service';

/**
 * Servicio que combina búsqueda + scraping para obtener el perfil completo.
 *
 * Flujo:
 *   1. searchAndScrape("INTERBANK")
 *   2. → Orquestador busca URL → "https://interbank.pe/"
 *   3. → Scraper extrae datos → CompanyProfile completo
 *
 * También permite scraping directo si ya se tiene la URL.
 */
@Injectable()
export class CompanyProfileService {
  private readonly logger = new Logger(CompanyProfileService.name);

  constructor(
    @Inject(WEBSITE_SCRAPER_PORT)
    private readonly scraper: WebsiteScraperPort,
    private readonly searchOrchestrator: SearchOrchestratorService,
  ) {}

  /**
   * Scraping directo de una URL conocida.
   */
  async scrapeUrl(url: string, options?: ScrapeOptions): Promise<CompanyProfile> {
    this.logger.log(`📄 Scraping directo: ${url}`);
    return this.scraper.scrape(url, options);
  }

  /**
   * Busca la web de una empresa y luego la scrapea.
   * Combina los dos pasos en uno solo.
   */
  async searchAndScrape(
    companyName: string,
    options?: ScrapeOptions,
  ): Promise<{
    profile: CompanyProfile | null;
    searchResult: {
      found: boolean;
      website: string | null;
      score: number;
      strategy: string;
    };
  }> {
    this.logger.log(`🔍➜🕷️ Search + Scrape: "${companyName}"`);

    // Paso 1: Buscar la web oficial
    const { result, strategyUsed } = await this.searchOrchestrator.search(companyName);

    const searchResult = {
      found: result?.found ?? false,
      website: result?.website ?? null,
      score: result?.score ?? 0,
      strategy: strategyUsed,
    };

    if (!result?.website) {
      this.logger.warn(`❌ No se encontró web para "${companyName}"`);
      return { profile: null, searchResult };
    }

    this.logger.log(`🔗 Web encontrada: ${result.website} (score: ${result.score})`);

    // Paso 2: Scraping de la web
    const profile = await this.scraper.scrape(result.website, options);

    // Enriquecer con datos de la búsqueda
    if (!profile.name && result.title) {
      profile.name = result.title.split(/[|\-–—]/)[0].trim();
    }

    return { profile, searchResult };
  }
}
