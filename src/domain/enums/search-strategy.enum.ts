/**
 * Estrategias de búsqueda disponibles.
 * Todas son HTTP puro — sin navegador, rápidas y livianas.
 */
export enum SearchStrategy {
  /** HTTP puro a html.duckduckgo.com/html/ — sin navegador, ~1-2s */
  DDG_HTTP = 'ddg_http',

  /** HTTP puro a www.bing.com/search — sin navegador, ~2-4s */
  BING_HTTP = 'bing_http',

  /** Fallback: búsqueda directa en universidadperu.com (POST al buscador interno) */
  UNIV_PERU_HTTP = 'univ_peru_http',
}

/** Orden de prioridad: búsqueda de web propia de la empresa */
export const STRATEGY_PRIORITY: SearchStrategy[] = [
  SearchStrategy.DDG_HTTP,
  SearchStrategy.BING_HTTP,
];

/** Fallback: directorios de empresas peruanas (cuando no se encuentra web propia) */
export const DIRECTORY_STRATEGY_PRIORITY: SearchStrategy[] = [
  SearchStrategy.UNIV_PERU_HTTP,
];
