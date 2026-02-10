import { registerAs } from '@nestjs/config';

export const scraperConfig = registerAs('scraper', () => ({
  /** Puerto del microservicio */
  port: parseInt(process.env.SCRAPER_PORT || '3457', 10),

  /** Límites por sesión para cada estrategia */
  limits: {
    ddgHttp: parseInt(process.env.DDG_HTTP_MAX || '200', 10),
    puppeteer: parseInt(process.env.PUPPETEER_MAX || '80', 10),
    playwright: parseInt(process.env.PLAYWRIGHT_MAX || '50', 10),
  },

  /** Delays entre búsquedas (ms) */
  delays: {
    ddgHttp: {
      min: parseInt(process.env.DDG_HTTP_DELAY_MIN || '2000', 10),
      max: parseInt(process.env.DDG_HTTP_DELAY_MAX || '5000', 10),
    },
    puppeteer: {
      min: parseInt(process.env.PUPPETEER_DELAY_MIN || '5000', 10),
      max: parseInt(process.env.PUPPETEER_DELAY_MAX || '10000', 10),
    },
    playwright: {
      min: parseInt(process.env.PLAYWRIGHT_DELAY_MIN || '15000', 10),
      max: parseInt(process.env.PLAYWRIGHT_DELAY_MAX || '30000', 10),
    },
  },

  /** User agents para rotación */
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ],
}));

export type ScraperConfig = ReturnType<typeof scraperConfig>;
