import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './controllers/search.controller';
import { ScrapeController } from './controllers/scrape.controller';
import { SearchOrchestratorService } from '../../application/services/search-orchestrator.service';
import { CompanyProfileService } from '../../application/services/company-profile.service';
import { DdgHttpAdapter } from '../adapters/ddg-http.adapter';
import { BingHttpAdapter } from '../adapters/bing-http.adapter';
import { UniversidadPeruHttpAdapter } from '../adapters/universidad-peru-http.adapter';
import { DatosPeruHttpAdapter } from '../adapters/datos-peru-http.adapter';
import { CheerioScraperAdapter } from '../adapters/cheerio-scraper.adapter';
import { WEBSITE_SCRAPER_PORT } from '../../domain/ports/website-scraper.port';

@Module({
  imports: [ConfigModule],
  controllers: [SearchController, ScrapeController],
  providers: [
    // Adaptadores de búsqueda (implementan SearchEnginePort) — HTTP puro, sin browser
    {
      provide: 'DDG_HTTP_ADAPTER',
      useClass: DdgHttpAdapter,
    },
    {
      provide: 'BING_HTTP_ADAPTER',
      useClass: BingHttpAdapter,
    },
    // Adaptadores de fallback — directorios de empresas peruanas
    {
      provide: 'UNIV_PERU_HTTP_ADAPTER',
      useClass: UniversidadPeruHttpAdapter,
    },
    {
      provide: 'DATOS_PERU_HTTP_ADAPTER',
      useClass: DatosPeruHttpAdapter,
    },
    // Adaptador de scraping (implementa WebsiteScraperPort) — Cheerio, sin browser
    {
      provide: WEBSITE_SCRAPER_PORT,
      useClass: CheerioScraperAdapter,
    },
    // Servicios de aplicación
    SearchOrchestratorService,
    CompanyProfileService,
  ],
  exports: [SearchOrchestratorService, CompanyProfileService],
})
export class SearchModule {}
