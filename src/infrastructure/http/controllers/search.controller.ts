import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { SearchOrchestratorService } from '../../../application/services/search-orchestrator.service';
import { SearchCompanyDto } from '../dtos/search-company.dto';
import { BatchSearchDto } from '../dtos/batch-search.dto';
import {
  SearchResponseDto,
  StrategyStatusDto,
  BatchSearchResponseDto,
} from '../dtos/search-response.dto';
import { SearchStrategy } from '../../../domain/enums/search-strategy.enum';

@ApiTags('Search')
@ApiSecurity('x-api-key')
@Controller('search')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly orchestrator: SearchOrchestratorService) {}

  /**
   * GET /search?q=INTERBANK&strategy=ddg_http
   *
   * Busca la web oficial de una empresa.
   * Si no se indica strategy, el orquestador elige la mejor disponible.
   *
   * Para n8n: GET http://localhost:3457/search?q={{$json.company_name}}
   */
  @Get()
  @ApiOperation({
    summary: 'Buscar web oficial de una empresa',
    description:
      'Busca la web oficial usando la estrategia indicada o la mejor disponible. ' +
      'Revisa el campo "strategies" en la respuesta para saber si cambiar de método.',
  })
  @ApiResponse({ status: 200, type: SearchResponseDto })
  async searchCompany(@Query() dto: SearchCompanyDto): Promise<SearchResponseDto> {
    this.logger.log(`🔍 Search: "${dto.q}" | strategy: ${dto.strategy || 'auto'}`);

    const { result, strategyUsed } = await this.orchestrator.search(
      dto.q,
      dto.strategy,
    );
    const statuses = this.orchestrator.getAllStatuses();

    return {
      found: result?.found ?? false,
      company: dto.q,
      cleanName: result?.cleanName ?? dto.q,
      website: result?.website ?? null,
      score: result?.score ?? 0,
      title: result?.title ?? null,
      strategyUsed,
      allResults: (result?.allResults ?? []).map((r) => ({
        url: r.url,
        title: r.title,
        score: r.score,
      })),
      strategies: statuses.map((s) => this.mapStatus(s)),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * POST /search/batch
   *
   * Búsqueda por lote (hasta 50 empresas).
   * Ideal para n8n con nodos de iteración.
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Búsqueda por lote',
    description: 'Busca las webs de hasta 50 empresas en una sola request.',
  })
  @ApiResponse({ status: 200, type: BatchSearchResponseDto })
  async batchSearch(@Body() dto: BatchSearchDto): Promise<BatchSearchResponseDto> {
    this.logger.log(`📦 Batch: ${dto.companies.length} empresas | strategy: ${dto.strategy || 'auto'}`);

    const results = await this.orchestrator.batchSearch(
      dto.companies,
      dto.strategy,
      dto.delayMs,
    );

    const statuses = this.orchestrator.getAllStatuses();
    let foundCount = 0;

    const mappedResults = results.map((r) => {
      const found = r.result?.found ?? false;
      if (found) foundCount++;
      return {
        ruc: r.ruc,
        company: r.company,
        found,
        website: r.result?.website ?? null,
        score: r.result?.score ?? 0,
        strategyUsed: r.strategyUsed,
      };
    });

    return {
      total: dto.companies.length,
      found: foundCount,
      notFound: dto.companies.length - foundCount,
      results: mappedResults,
      strategies: statuses.map((s) => this.mapStatus(s)),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /search/status
   *
   * Estado de todas las estrategias.
   * n8n lo usa para decidir si cambiar de método.
   */
  @Get('status')
  @ApiOperation({
    summary: 'Estado de las estrategias de búsqueda',
    description:
      'Retorna el estado de cada estrategia: usos, capacidad restante, cooldown. ' +
      'Perfecto para que n8n decida cuándo cambiar de método.',
  })
  @ApiResponse({ status: 200, type: [StrategyStatusDto] })
  getStatus(): StrategyStatusDto[] {
    const statuses = this.orchestrator.getAllStatuses();
    return statuses.map((s) => this.mapStatus(s));
  }

  /**
   * POST /search/reset
   * POST /search/reset/ddg_http
   *
   * Resetear contadores (nuevo ciclo).
   */
  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resetear contadores de todas las estrategias' })
  resetAll(): void {
    this.logger.log('🔄 Reset: todas las estrategias');
    this.orchestrator.resetCounters();
  }

  @Post('reset/:strategy')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resetear contadores de una estrategia específica' })
  resetStrategy(@Param('strategy') strategy: SearchStrategy): void {
    this.logger.log(`🔄 Reset: ${strategy}`);
    this.orchestrator.resetCounters(strategy);
  }

  /**
   * GET /search/health
   *
   * Healthcheck básico para n8n.
   */
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Healthcheck (público, no requiere API key)' })
  health() {
    const statuses = this.orchestrator.getAllStatuses();
    const anyAvailable = statuses.some((s) => s.isAvailable);
    return {
      status: anyAvailable ? 'ok' : 'exhausted',
      uptime: process.uptime(),
      strategies: statuses.map((s) => ({
        strategy: s.strategy,
        available: s.isAvailable,
        remaining: s.remainingCapacity,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private mapStatus(s: any): StrategyStatusDto {
    return {
      strategy: s.strategy,
      available: s.isAvailable,
      usageCount: s.usageCount,
      maxPerSession: s.maxPerSession,
      remainingCapacity: s.remainingCapacity,
      successCount: s.successCount,
      failCount: s.failCount,
      successRate: Math.round(s.successRate * 100) / 100,
      avgResponseTimeMs: Math.round(s.avgResponseTimeMs),
      cooldownUntil: s.cooldownUntil?.toISOString() ?? null,
    };
  }
}
