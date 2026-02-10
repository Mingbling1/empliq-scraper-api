import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult, SearchResultItem } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import { SearchStrategy } from '../../domain/enums/search-strategy.enum';
import { cleanCompanyName } from '../../shared/utils/company-name-cleaner';
import { rankResults } from '../../shared/utils/url-scorer';

/**
 * Adaptador Puppeteer — velocidad media.
 *
 * Abre Chromium con Puppeteer, busca en DuckDuckGo (browser real),
 * con fallback a Bing. ~5-10s por búsqueda.
 */
@Injectable()
export class PuppeteerAdapter implements SearchEnginePort, OnModuleDestroy {
  readonly strategy = SearchStrategy.PUPPETEER;
  private readonly logger = new Logger(PuppeteerAdapter.name);
  private status: StrategyStatus;
  private browser: any = null; // puppeteer.Browser — lazy import
  private userAgents: string[];

  constructor(private config: ConfigService) {
    const maxPerSession = this.config.get<number>('scraper.limits.puppeteer', 80);
    this.status = new StrategyStatus({
      strategy: SearchStrategy.PUPPETEER,
      maxPerSession,
    });
    this.userAgents = this.config.get<string[]>('scraper.userAgents', [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  async search(companyName: string): Promise<SearchResult | null> {
    const startTime = Date.now();
    const cleanName = cleanCompanyName(companyName);
    const query = `"${cleanName}" peru (sitio web oficial OR página oficial OR website) -site:linkedin.com -site:facebook.com -site:twitter.com`;

    this.logger.log(`[Puppeteer] Buscando: "${companyName}"`);

    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
      await page.setUserAgent(ua);
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      let allResults: Array<{ url: string; title: string }> = [];

      try {
        // 1. Intentar DuckDuckGo
        const ddgResults = await this.searchDDG(page, query);
        allResults = allResults.concat(ddgResults);

        // 2. Fallback a Bing si pocos resultados
        if (allResults.length < 3) {
          await this.sleep(2000);
          const bingResults = await this.searchBing(page, query);
          allResults = allResults.concat(bingResults);
        }
      } finally {
        await page.close();
      }

      const ranked = rankResults(allResults, companyName);
      const elapsed = Date.now() - startTime;

      if (ranked.length === 0) {
        this.status.recordUse(false, elapsed);
        this.logger.warn(`[Puppeteer] Sin resultados para "${companyName}"`);
        return null;
      }

      const best = ranked[0];
      this.status.recordUse(true, elapsed);

      this.logger.log(`[Puppeteer] ✅ ${best.url} (score: ${best.score}, ${elapsed}ms)`);

      return new SearchResult({
        company: companyName,
        cleanName,
        website: best.url,
        score: best.score,
        title: best.title,
        strategy: SearchStrategy.PUPPETEER,
        allResults: ranked.slice(0, 5).map(
          (r) => new SearchResultItem(r.url, r.title, r.score),
        ),
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.error(`[Puppeteer] Error: ${(error as Error).message}`);

      // Si el browser crasheó, cerrarlo para que se re-inicie
      await this.closeBrowser();
      return null;
    }
  }

  getStatus(): StrategyStatus {
    return this.status;
  }

  isAvailable(): boolean {
    return this.status.isAvailable;
  }

  reset(): void {
    this.status.reset();
  }

  async dispose(): Promise<void> {
    await this.closeBrowser();
  }

  // ──────────────────────────────────────────────────────────
  // Browser management
  // ──────────────────────────────────────────────────────────

  private async getBrowser(): Promise<any> {
    if (!this.browser) {
      const puppeteer = await import('puppeteer');
      this.browser = await puppeteer.default.launch({
        headless: 'new' as any,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
        defaultViewport: { width: 1366, height: 768 },
      });
      this.logger.log('[Puppeteer] Browser iniciado');
    }
    return this.browser;
  }

  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignorar
      }
      this.browser = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Search engines
  // ──────────────────────────────────────────────────────────

  private async searchDDG(
    page: any,
    query: string,
  ): Promise<Array<{ url: string; title: string }>> {
    try {
      await page.goto('https://duckduckgo.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await this.sleep(this.random(1500, 3000));

      const searchInput = await page.$('input[name="q"]');
      if (!searchInput) return [];

      await page.click('input[name="q"]');
      await page.type('input[name="q"]', query, {
        delay: this.random(30, 100),
      });
      await this.sleep(500);
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector(
          '[data-testid="result"], .result, article',
          { timeout: 15000 },
        );
      } catch {
        await this.sleep(3000);
      }
      await this.sleep(this.random(1500, 3000));

      return page.evaluate(() => {
        const items: Array<{ url: string; title: string }> = [];
        const selectors = ['[data-testid="result"]', '.result', 'article'];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el: Element) => {
            try {
              const link = el.querySelector(
                'a[href^="http"]',
              ) as HTMLAnchorElement;
              const titleEl = el.querySelector(
                'h2, [data-testid="result-title-a"]',
              );
              if (link?.href && !link.href.includes('duckduckgo.com')) {
                items.push({
                  url: link.href,
                  title: titleEl?.textContent?.trim() || '',
                });
              }
            } catch {
              // ignorar
            }
          });
          if (items.length > 0) break;
        }
        return items;
      });
    } catch (error) {
      this.logger.warn(`[Puppeteer-DDG] ${(error as Error).message}`);
      return [];
    }
  }

  private async searchBing(
    page: any,
    query: string,
  ): Promise<Array<{ url: string; title: string }>> {
    try {
      await page.goto('https://www.bing.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await this.sleep(this.random(1500, 3000));

      const input = await page.$('input[name="q"], textarea[name="q"]');
      if (!input) return [];

      await page.click('input[name="q"], textarea[name="q"]');
      await page.type('input[name="q"], textarea[name="q"]', query, {
        delay: this.random(30, 100),
      });
      await this.sleep(500);
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector('#b_results, .b_algo', { timeout: 15000 });
      } catch {
        await this.sleep(3000);
      }
      await this.sleep(this.random(1500, 3000));

      return page.evaluate(() => {
        const items: Array<{ url: string; title: string }> = [];
        document.querySelectorAll('.b_algo, #b_results > li').forEach((el: Element) => {
          try {
            const link = el.querySelector(
              'a[href^="http"]',
            ) as HTMLAnchorElement;
            const titleEl = el.querySelector('h2');
            if (link?.href && !link.href.includes('bing.com')) {
              items.push({
                url: link.href,
                title: titleEl?.textContent?.trim() || '',
              });
            }
          } catch {
            // ignorar
          }
        });
        return items;
      });
    } catch (error) {
      this.logger.warn(`[Puppeteer-Bing] ${(error as Error).message}`);
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private random(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
