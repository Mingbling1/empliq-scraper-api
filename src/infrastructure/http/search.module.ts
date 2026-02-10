import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './controllers/search.controller';
import { SearchOrchestratorService } from '../../application/services/search-orchestrator.service';
import { DdgHttpAdapter } from '../adapters/ddg-http.adapter';
import { PuppeteerAdapter } from '../adapters/puppeteer.adapter';

@Module({
  imports: [ConfigModule],
  controllers: [SearchController],
  providers: [
    // Adaptadores (implementan SearchEnginePort)
    {
      provide: 'DDG_HTTP_ADAPTER',
      useClass: DdgHttpAdapter,
    },
    {
      provide: 'PUPPETEER_ADAPTER',
      useClass: PuppeteerAdapter,
    },
    // Orquestador (capa de aplicación)
    SearchOrchestratorService,
  ],
  exports: [SearchOrchestratorService],
})
export class SearchModule {}
