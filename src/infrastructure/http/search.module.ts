import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './controllers/search.controller';
import { SearchOrchestratorService } from '../../application/services/search-orchestrator.service';
import { DdgHttpAdapter } from '../adapters/ddg-http.adapter';
import { BingHttpAdapter } from '../adapters/bing-http.adapter';

@Module({
  imports: [ConfigModule],
  controllers: [SearchController],
  providers: [
    // Adaptadores (implementan SearchEnginePort) — todos HTTP puro, sin browser
    {
      provide: 'DDG_HTTP_ADAPTER',
      useClass: DdgHttpAdapter,
    },
    {
      provide: 'BING_HTTP_ADAPTER',
      useClass: BingHttpAdapter,
    },
    // Orquestador (capa de aplicación)
    SearchOrchestratorService,
  ],
  exports: [SearchOrchestratorService],
})
export class SearchModule {}
