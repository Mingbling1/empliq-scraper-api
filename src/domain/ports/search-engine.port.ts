import { SearchResult } from '../entities/search-result.entity';
import { StrategyStatus } from '../entities/strategy-status.entity';
import { SearchStrategy } from '../enums/search-strategy.enum';

/**
 * Token de inyección para los adaptadores de búsqueda.
 */
export const SEARCH_ENGINE_PORT = 'SEARCH_ENGINE_PORT';

/**
 * Puerto (interfaz) que deben implementar todos los adaptadores de búsqueda.
 * Parte del dominio — no conoce frameworks ni infraestructura.
 */
export interface SearchEnginePort {
  /** Identificador de la estrategia */
  readonly strategy: SearchStrategy;

  /**
   * Busca la página web oficial de una empresa.
   * @param companyName Nombre de la empresa (puede incluir SAC, SRL, etc.)
   * @param ruc RUC de la empresa (opcional, mejora búsqueda en directorios)
   * @returns Resultado de búsqueda o null si no encuentra
   */
  search(companyName: string, ruc?: string): Promise<SearchResult | null>;

  /** Estado actual de la estrategia (rate limits, cooldown, etc.) */
  getStatus(): StrategyStatus;

  /** ¿Está disponible para más búsquedas? */
  isAvailable(): boolean;

  /** Resetear contadores (nuevo ciclo) */
  reset(): void;

  /** Liberar recursos (cerrar browsers, etc.) */
  dispose(): Promise<void>;
}
