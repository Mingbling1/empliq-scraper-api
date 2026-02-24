import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './controllers/search.controller';
import { ScrapeController } from './controllers/scrape.controller';
import { EnrichController } from './controllers/enrich.controller';
import { ProxyController } from './controllers/proxy.controller';
import { LogoController } from './controllers/logo.controller';
import { SearchOrchestratorService } from '../../application/services/search-orchestrator.service';
import { CompanyProfileService } from '../../application/services/company-profile.service';
import { EnrichmentService } from '../../application/services/enrichment.service';
import { ProxyTestService } from '../../application/services/proxy-test.service';
import { LogoService } from '../../application/services/logo.service';
import { DdgHttpAdapter } from '../adapters/ddg-http.adapter';
import { BingHttpAdapter } from '../adapters/bing-http.adapter';
import { UniversidadPeruHttpAdapter } from '../adapters/universidad-peru-http.adapter';
import { DatosPeruHttpAdapter } from '../adapters/datos-peru-http.adapter';
import { CheerioScraperAdapter } from '../adapters/cheerio-scraper.adapter';
import { LogoDevAdapter } from '../adapters/logo-dev.adapter';
import { BrandfetchAdapter } from '../adapters/brandfetch.adapter';
import { OracleStorageAdapter } from '../adapters/oracle-storage.adapter';
import { WEBSITE_SCRAPER_PORT } from '../../domain/ports/website-scraper.port';
import { DATOS_PERU_ENRICHMENT_PORT } from '../../domain/ports/datos-peru-enrichment.port';
import { LOGO_PROVIDER_PRIMARY, LOGO_PROVIDER_FALLBACK } from '../../domain/ports/logo-provider.port';
import { STORAGE_PORT } from '../../domain/ports/storage.port';

@Module({
  imports: [ConfigModule],
  controllers: [SearchController, ScrapeController, EnrichController, ProxyController, LogoController],
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
    // Adaptador de fallback — directorio universidadperu.com (búsqueda directa)
    {
      provide: 'UNIV_PERU_HTTP_ADAPTER',
      useClass: UniversidadPeruHttpAdapter,
    },
    // Adaptador de scraping (implementa WebsiteScraperPort) — Cheerio, sin browser
    {
      provide: WEBSITE_SCRAPER_PORT,
      useClass: CheerioScraperAdapter,
    },
    // Adaptador de enriquecimiento — datosperu.org (HTTP puro + Cheerio)
    {
      provide: DATOS_PERU_ENRICHMENT_PORT,
      useClass: DatosPeruHttpAdapter,
    },
    // Adaptadores de logo — logo.dev (primario, 500K free/mes) + Brandfetch (fallback, 100 free)
    {
      provide: LOGO_PROVIDER_PRIMARY,
      useClass: LogoDevAdapter,
    },
    {
      provide: LOGO_PROVIDER_FALLBACK,
      useClass: BrandfetchAdapter,
    },
    // Adaptador de almacenamiento — Oracle Object Storage via PAR
    {
      provide: STORAGE_PORT,
      useClass: OracleStorageAdapter,
    },
    // Servicios de aplicación
    SearchOrchestratorService,
    CompanyProfileService,
    EnrichmentService,
    ProxyTestService,
    LogoService,
  ],
  exports: [SearchOrchestratorService, CompanyProfileService, EnrichmentService, LogoService],
})
export class SearchModule {}
