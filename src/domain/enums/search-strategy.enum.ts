/**
 * Estrategias de búsqueda disponibles.
 * Ordenadas por velocidad (rápida → lenta) y costo de recursos.
 */
export enum SearchStrategy {
  /** HTTP puro a html.duckduckgo.com/html/ — sin navegador, ~1-2s */
  DDG_HTTP = 'ddg_http',

  /** Puppeteer (Chromium) — DDG + Bing en browser, ~5-10s */
  PUPPETEER = 'puppeteer',

  /** Playwright (Firefox) — Multi-motor con comportamiento humano, ~15-30s */
  PLAYWRIGHT = 'playwright',
}

/** Orden de prioridad por defecto: rápido → lento */
export const STRATEGY_PRIORITY: SearchStrategy[] = [
  SearchStrategy.DDG_HTTP,
  SearchStrategy.PUPPETEER,
  SearchStrategy.PLAYWRIGHT,
];
