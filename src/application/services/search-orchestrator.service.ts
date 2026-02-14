import { Injectable, Inject, Logger } from '@nestjs/common';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import {
  SearchStrategy,
  STRATEGY_PRIORITY,
  DIRECTORY_STRATEGY_PRIORITY,
} from '../../domain/enums/search-strategy.enum';

/**
 * Orquestador inteligente de estrategias de búsqueda con 2 fases:
 *
 * FASE 1 — Búsqueda directa (web propia de la empresa):
 *   DDG HTTP → Bing HTTP
 *
 * FASE 2 — Fallback a directorios (cuando no se encuentra web propia):
 *   UniversidadPeru.com → DatosPeru.org
 *
 * Si se pide una estrategia específica, la usa directamente.
 * Si falla, pasa al fallback automático.
 */
@Injectable()
export class SearchOrchestratorService {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private readonly adapters: Map<SearchStrategy, SearchEnginePort>;

  constructor(
    @Inject('DDG_HTTP_ADAPTER') private ddgHttp: SearchEnginePort,
    @Inject('BING_HTTP_ADAPTER') private bingHttp: SearchEnginePort,
    @Inject('UNIV_PERU_HTTP_ADAPTER') private univPeruHttp: SearchEnginePort,
    @Inject('DATOS_PERU_HTTP_ADAPTER') private datosPeruHttp: SearchEnginePort,
  ) {
    this.adapters = new Map<SearchStrategy, SearchEnginePort>([
      [SearchStrategy.DDG_HTTP, ddgHttp],
      [SearchStrategy.BING_HTTP, bingHttp],
      [SearchStrategy.UNIV_PERU_HTTP, univPeruHttp],
      [SearchStrategy.DATOS_PERU_HTTP, datosPeruHttp],
    ]);
  }

  /**
   * Busca la web oficial de una empresa.
   * Si no se especifica estrategia, usa búsqueda automática con 2 fases.
   */
  async search(
    companyName: string,
    preferredStrategy?: SearchStrategy,
  ): Promise<{ result: SearchResult | null; strategyUsed: SearchStrategy }> {
    if (preferredStrategy) {
      const adapter = this.adapters.get(preferredStrategy);
      if (!adapter) {
        this.logger.warn(`Estrategia desconocida: ${preferredStrategy}`);
        return { result: null, strategyUsed: preferredStrategy };
      }

      if (!adapter.isAvailable()) {
        this.logger.warn(
          `Estrategia ${preferredStrategy} no disponible (agotada/cooldown)`,
        );
        return this.searchWithFallback(companyName, preferredStrategy);
      }

      const result = await adapter.search(companyName);
      return { result, strategyUsed: preferredStrategy };
    }

    return this.searchWithFallback(companyName);
  }

  /**
   * Búsqueda con fallback automático en 2 fases:
   * Fase 1: DDG → Bing (busca web propia de la empresa)
   * Fase 2: UniversidadPeru → DatosPeru (directorios de empresas peruanas)
   */
  private async searchWithFallback(
    companyName: string,
    skipStrategy?: SearchStrategy,
  ): Promise<{ result: SearchResult | null; strategyUsed: SearchStrategy }> {
    // ═══ FASE 1: Búsqueda directa (web propia de la empresa) ═══
    for (const strategy of STRATEGY_PRIORITY) {
      if (strategy === skipStrategy) continue;

      const adapter = this.adapters.get(strategy);
      if (!adapter || !adapter.isAvailable()) {
        this.logger.log(`Saltando ${strategy} (no disponible)`);
        continue;
      }

      this.logger.log(`Intentando con ${strategy}...`);
      const result = await adapter.search(companyName);

      if (result && result.found) {
        if (result.score >= 15) {
          return { result, strategyUsed: strategy };
        }
        this.logger.log(
          `${strategy} encontró resultado con score bajo (${result.score}), probando siguiente...`,
        );
        const fallbackResult = await this.tryRemainingStrategies(
          companyName,
          strategy,
          STRATEGY_PRIORITY,
        );
        if (
          fallbackResult &&
          fallbackResult.result &&
          fallbackResult.result.score > result.score
        ) {
          return fallbackResult;
        }
        return { result, strategyUsed: strategy };
      }

      this.logger.log(`${strategy} no encontró resultado, probando siguiente...`);
    }

    // ═══ FASE 2: Fallback a directorios (universidadperu.com, datosperu.org) ═══
    this.logger.log(
      `🗂️ No se encontró web propia para "${companyName}", intentando directorios...`,
    );

    for (const strategy of DIRECTORY_STRATEGY_PRIORITY) {
      const adapter = this.adapters.get(strategy);
      if (!adapter || !adapter.isAvailable()) {
        this.logger.log(`Saltando directorio ${strategy} (no disponible)`);
        continue;
      }

      this.logger.log(`Intentando directorio ${strategy}...`);
      const result = await adapter.search(companyName);

      if (result && result.found) {
        this.logger.log(
          `✅ Directorio ${strategy} encontró: ${result.website} (score: ${result.score})`,
        );
        return { result, strategyUsed: strategy };
      }

      this.logger.log(`Directorio ${strategy} no encontró resultado...`);
    }

    // Ninguna estrategia (ni directorio) encontró resultado
    const lastStrategy =
      DIRECTORY_STRATEGY_PRIORITY[DIRECTORY_STRATEGY_PRIORITY.length - 1] ||
      STRATEGY_PRIORITY[STRATEGY_PRIORITY.length - 1];
    return { result: null, strategyUsed: lastStrategy };
  }

  /**
   * Intenta las estrategias restantes después de la actual (dentro de la misma fase).
   */
  private async tryRemainingStrategies(
    companyName: string,
    currentStrategy: SearchStrategy,
    priorities: readonly SearchStrategy[],
  ): Promise<{
    result: SearchResult | null;
    strategyUsed: SearchStrategy;
  } | null> {
    const currentIndex = priorities.indexOf(currentStrategy);
    for (let i = currentIndex + 1; i < priorities.length; i++) {
      const strategy = priorities[i];
      const adapter = this.adapters.get(strategy);
      if (!adapter || !adapter.isAvailable()) continue;

      this.logger.log(`[Fallback] Intentando ${strategy} para mejorar score...`);
      const result = await adapter.search(companyName);
      if (result && result.found) {
        return { result, strategyUsed: strategy };
      }
    }
    return null;
  }

  /**
   * Búsqueda por lote.
   */
  async batchSearch(
    companies: Array<{ ruc?: string; name: string }>,
    preferredStrategy?: SearchStrategy,
    delayMs?: number,
  ): Promise<
    Array<{
      ruc?: string;
      company: string;
      result: SearchResult | null;
      strategyUsed: SearchStrategy;
    }>
  > {
    const results: Array<{
      ruc?: string;
      company: string;
      result: SearchResult | null;
      strategyUsed: SearchStrategy;
    }> = [];

    for (let i = 0; i < companies.length; i++) {
      const { ruc, name } = companies[i];

      this.logger.log(`[Batch ${i + 1}/${companies.length}] "${name}"`);

      const { result, strategyUsed } = await this.search(name, preferredStrategy);

      results.push({ ruc, company: name, result, strategyUsed });

      if (i < companies.length - 1) {
        const delay = delayMs || this.getDefaultDelay(strategyUsed);
        await this.sleep(delay);
      }
    }

    return results;
  }

  /**
   * Estado de TODAS las estrategias (directas + directorios).
   */
  getAllStatuses(): StrategyStatus[] {
    const allStrategies = [...STRATEGY_PRIORITY, ...DIRECTORY_STRATEGY_PRIORITY];
    return allStrategies.map((strategy) => {
      const adapter = this.adapters.get(strategy);
      return adapter
        ? adapter.getStatus()
        : new StrategyStatus({ strategy, maxPerSession: 0 });
    });
  }

  /**
   * Resetear contadores de una o todas las estrategias.
   */
  resetCounters(strategy?: SearchStrategy): void {
    if (strategy) {
      const adapter = this.adapters.get(strategy);
      if (adapter) adapter.reset();
    } else {
      for (const adapter of this.adapters.values()) {
        adapter.reset();
      }
    }
    this.logger.log(`Contadores reseteados: ${strategy || 'todas'}`);
  }

  private getDefaultDelay(strategy: SearchStrategy): number {
    const delays: Record<SearchStrategy, { min: number; max: number }> = {
      [SearchStrategy.DDG_HTTP]: { min: 2000, max: 5000 },
      [SearchStrategy.BING_HTTP]: { min: 2000, max: 5000 },
      [SearchStrategy.UNIV_PERU_HTTP]: { min: 1500, max: 3000 },
      [SearchStrategy.DATOS_PERU_HTTP]: { min: 1500, max: 3000 },
    };
    const range = delays[strategy];
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
