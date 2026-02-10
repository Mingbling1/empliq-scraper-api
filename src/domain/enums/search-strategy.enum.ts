/**
 * Estrategias de búsqueda disponibles.
 * Todas son HTTP puro — sin navegador, rápidas y livianas.
 */
export enum SearchStrategy {
  /** HTTP puro a html.duckduckgo.com/html/ — sin navegador, ~1-2s */
  DDG_HTTP = 'ddg_http',

  /** HTTP puro a www.bing.com/search — sin navegador, ~2-4s */
  BING_HTTP = 'bing_http',
}

/** Orden de prioridad por defecto: rápido → lento */
export const STRATEGY_PRIORITY: SearchStrategy[] = [
  SearchStrategy.DDG_HTTP,
  SearchStrategy.BING_HTTP,
];
