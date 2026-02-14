import { Injectable, Inject, Logger } from '@nestjs/common';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import { SearchStrategy, STRATEGY_PRIORITY } from '../../domain/enums/search-strategy.enum';

/**
 * Orquestador inteligente de estrategias de búsqueda.
 *
 * Funciona así:
 * 1. Si se pide una estrategia específica, la usa directamente.
 * 2. Si no, elige automáticamente por prioridad (rápido → lento):
 *    DDG HTTP → Puppeteer → Playwright
 * 3. Si la estrategia elegida falla o está agotada, pasa a la siguiente.
 * 4. Expone el estado de todas las estrategias para que n8n sepa cuándo cambiar.
 */
@Injectable()
export class SearchOrchestratorService {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private readonly adapters: Map<SearchStrategy, SearchEnginePort>;

  constructor(
    @Inject('DDG_HTTP_ADAPTER') private ddgHttp: SearchEnginePort,
    @Inject('BING_HTTP_ADAPTER') private bingHttp: SearchEnginePort,
  ) {
    this.adapters = new Map<SearchStrategy, SearchEnginePort>([
      [SearchStrategy.DDG_HTTP, ddgHttp],
      [SearchStrategy.BING_HTTP, bingHttp],
    ]);
  }

  /**
   * Busca la web oficial de una empresa.
   * Si no se especifica estrategia, usa la primera disponible por prioridad.
   * Si falla, intenta con la siguiente.
   */
  async search(
    companyName: string,
    preferredStrategy?: SearchStrategy,
  ): Promise<{ result: SearchResult | null; strategyUsed: SearchStrategy }> {
    // Si se pide una estrategia específica, usarla directamente
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
        // Intentar con las demás automáticamente
        return this.searchWithFallback(companyName, preferredStrategy);
      }

      const result = await adapter.search(companyName);
      return { result, strategyUsed: preferredStrategy };
    }

    // Automático: intentar por prioridad
    return this.searchWithFallback(companyName);
  }

  /**
   * Búsqueda con fallback automático entre estrategias.
   */
  private async searchWithFallback(
    companyName: string,
    skipStrategy?: SearchStrategy,
  ): Promise<{ result: SearchResult | null; strategyUsed: SearchStrategy }> {
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
        // Si el score es alto (>=15), aceptar inmediatamente
        if (result.score >= 15) {
          return { result, strategyUsed: strategy };
        }
        // Score medio (8-14): guardar como mejor candidato pero seguir buscando
        this.logger.log(`${strategy} encontró resultado con score bajo (${result.score}), probando siguiente...`);
        // Retornar este resultado si no hay mejor en las siguientes estrategias
        const fallbackResult = await this.tryRemainingStrategies(companyName, strategy, STRATEGY_PRIORITY);
        if (fallbackResult && fallbackResult.result && fallbackResult.result.score > result.score) {
          return fallbackResult;
        }
        return { result, strategyUsed: strategy };
      }

      // Si el resultado es null o found=false, intentar con la siguiente estrategia
      this.logger.log(`${strategy} no encontró resultado, probando siguiente...`);
    }

    // Ninguna estrategia encontró resultado
    const lastStrategy = STRATEGY_PRIORITY[STRATEGY_PRIORITY.length - 1];
    return { result: null, strategyUsed: lastStrategy };
  }

  /**
   * Intenta las estrategias restantes después de la actual.
   */
  private async tryRemainingStrategies(
    companyName: string,
    currentStrategy: SearchStrategy,
    priorities: readonly SearchStrategy[],
  ): Promise<{ result: SearchResult | null; strategyUsed: SearchStrategy } | null> {
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
   * Búsqueda por lote con la misma estrategia.
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

      // Delay entre búsquedas
      if (i < companies.length - 1) {
        const delay = delayMs || this.getDefaultDelay(strategyUsed);
        await this.sleep(delay);
      }
    }

    return results;
  }

  /**
   * Estado de todas las estrategias.
   * Clave para n8n: saber cuántas consultas quedan y si hay cooldown.
   */
  getAllStatuses(): StrategyStatus[] {
    return STRATEGY_PRIORITY.map((strategy) => {
      const adapter = this.adapters.get(strategy);
      return adapter ? adapter.getStatus() : new StrategyStatus({ strategy, maxPerSession: 0 });
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

  /**
   * Delay por defecto según la estrategia (para no saturar).
   */
  private getDefaultDelay(strategy: SearchStrategy): number {
    const delays: Record<SearchStrategy, { min: number; max: number }> = {
      [SearchStrategy.DDG_HTTP]: { min: 2000, max: 5000 },
      [SearchStrategy.BING_HTTP]: { min: 2000, max: 5000 },
    };
    const range = delays[strategy];
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
