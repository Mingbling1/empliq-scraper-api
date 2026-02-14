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
 * FASE 2 — Fallback a directorio (cuando no se encuentra web propia):
 *   UniversidadPeru.com (búsqueda directa por RUC/nombre, sin DDG/Bing)
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
  ) {
    this.adapters = new Map<SearchStrategy, SearchEnginePort>([
      [SearchStrategy.DDG_HTTP, ddgHttp],
      [SearchStrategy.BING_HTTP, bingHttp],
      [SearchStrategy.UNIV_PERU_HTTP, univPeruHttp],
    ]);
  }

  /**
   * Busca la web oficial de una empresa.
   * Si no se especifica estrategia, usa búsqueda automática con 2 fases.
   */
  async search(
    companyName: string,
    preferredStrategy?: SearchStrategy,
    ruc?: string,
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
        return this.searchWithFallback(companyName, ruc, preferredStrategy);
      }

      const result = await adapter.search(companyName, ruc);
      return { result, strategyUsed: preferredStrategy };
    }

    return this.searchWithFallback(companyName, ruc);
  }

  /**
   * Búsqueda con fallback automático en 2 fases:
   * Fase 1: DDG → Bing (busca web propia de la empresa)
   * Fase 2: UniversidadPeru.com (búsqueda directa en directorio)
   *
   * LÓGICA DE SCORE:
   *  - score >= 15 → Alta confianza, devolver inmediatamente
   *  - score 8-14  → Baja confianza, guardar como candidato y probar directorios
   *  - score < 8   → No encontrado (found=false), seguir buscando
   *
   * Al final: devolver el resultado con mayor score entre Phase 1 y Phase 2.
   */
  private async searchWithFallback(
    companyName: string,
    ruc?: string,
    skipStrategy?: SearchStrategy,
  ): Promise<{ result: SearchResult | null; strategyUsed: SearchStrategy }> {
    // Mejor candidato de Phase 1 (puede tener score bajo)
    let phase1Best: { result: SearchResult; strategyUsed: SearchStrategy } | null =
      null;

    // ═══ FASE 1: Búsqueda directa (web propia de la empresa) ═══
    for (const strategy of STRATEGY_PRIORITY) {
      if (strategy === skipStrategy) continue;

      const adapter = this.adapters.get(strategy);
      if (!adapter || !adapter.isAvailable()) {
        this.logger.log(`Saltando ${strategy} (no disponible)`);
        continue;
      }

      this.logger.log(`Intentando con ${strategy}...`);
      const result = await adapter.search(companyName, ruc);

      if (result && result.found) {
        if (result.score >= 15) {
          // ✅ Alta confianza → devolver inmediatamente, no necesita directorio
          this.logger.log(
            `✅ ${strategy} encontró con alta confianza: ${result.website} (score: ${result.score})`,
          );
          return { result, strategyUsed: strategy };
        }

        // Score bajo (8-14) → guardar como candidato, seguir buscando
        this.logger.log(
          `${strategy} encontró con score bajo (${result.score}): ${result.website}, guardando como candidato...`,
        );
        if (!phase1Best || result.score > phase1Best.result.score) {
          phase1Best = { result, strategyUsed: strategy };
        }
      } else {
        this.logger.log(
          `${strategy} no encontró resultado, probando siguiente...`,
        );
      }
    }

    // ═══ FASE 2: Fallback a directorio (universidadperu.com — búsqueda directa) ═══
    this.logger.log(
      `🗂️ ${phase1Best ? `Mejor Phase 1 tiene score ${phase1Best.result.score} (baja confianza)` : 'No se encontró web propia'} para "${companyName}", probando directorio...`,
    );

    for (const strategy of DIRECTORY_STRATEGY_PRIORITY) {
      const adapter = this.adapters.get(strategy);
      if (!adapter || !adapter.isAvailable()) {
        this.logger.log(`Saltando directorio ${strategy} (no disponible)`);
        continue;
      }

      this.logger.log(`Intentando directorio ${strategy}...`);
      const result = await adapter.search(companyName, ruc);

      if (result && result.found) {
        this.logger.log(
          `✅ Directorio ${strategy} encontró: ${result.website} (score: ${result.score})`,
        );
        // Si el directorio encontró algo, comparar con Phase 1 candidate
        if (phase1Best && phase1Best.result.score > result.score) {
          this.logger.log(
            `Phase 1 tiene mejor score (${phase1Best.result.score} > ${result.score}), usando Phase 1`,
          );
          return phase1Best;
        }
        return { result, strategyUsed: strategy };
      }

      this.logger.log(`Directorio ${strategy} no encontró resultado...`);
    }

    // Si tenemos un candidato de Phase 1 (aunque con score bajo), devolverlo
    if (phase1Best) {
      this.logger.log(
        `⚠️ Usando candidato Phase 1 de baja confianza: ${phase1Best.result.website} (score: ${phase1Best.result.score})`,
      );
      return phase1Best;
    }

    // Ninguna estrategia encontró resultado
    const lastStrategy =
      DIRECTORY_STRATEGY_PRIORITY[DIRECTORY_STRATEGY_PRIORITY.length - 1] ||
      STRATEGY_PRIORITY[STRATEGY_PRIORITY.length - 1];
    return { result: null, strategyUsed: lastStrategy };
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

      const { result, strategyUsed } = await this.search(name, preferredStrategy, ruc);

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
    };
    const range = delays[strategy];
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
