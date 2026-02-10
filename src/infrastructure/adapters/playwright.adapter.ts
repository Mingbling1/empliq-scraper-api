import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult, SearchResultItem } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import { SearchStrategy } from '../../domain/enums/search-strategy.enum';
import { cleanCompanyName } from '../../shared/utils/company-name-cleaner';
import { rankResults } from '../../shared/utils/url-scorer';

/**
 * Adaptador Playwright — el más robusto pero más lento.
 *
 * Usa Firefox real con comportamiento humano.
 * Multi-motor: DuckDuckGo → Bing → Google con rotación.
 * ~15-30s por búsqueda.
 */
@Injectable()
export class PlaywrightAdapter implements SearchEnginePort, OnModuleDestroy {
  readonly strategy = SearchStrategy.PLAYWRIGHT;
  private readonly logger = new Logger(PlaywrightAdapter.name);
  private status: StrategyStatus;
  private browser: any = null; // playwright Browser — lazy import
  private engineRotation = ['duckduckgo', 'bing', 'google'];
  private engineIdx = 0;
  private searchCount = 0;

  constructor(private config: ConfigService) {
    const maxPerSession = this.config.get<number>('scraper.limits.playwright', 50);
    this.status = new StrategyStatus({
      strategy: SearchStrategy.PLAYWRIGHT,
      maxPerSession,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  async search(companyName: string): Promise<SearchResult | null> {
    const startTime = Date.now();
    const cleanName = cleanCompanyName(companyName);

    this.logger.log(`[Playwright] Buscando: "${companyName}"`);

    try {
      const browser = await this.getBrowser();
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        locale: 'es-PE',
        timezoneId: 'America/Lima',
      });
      const page = await context.newPage();

      const engine = this.getNextEngine();
      const query = this.buildQuery(cleanName, engine);

      this.logger.log(`[Playwright] Motor: ${engine} | Query: ${query}`);

      let results: Array<{ url: string; title: string }> = [];

      try {
        switch (engine) {
          case 'duckduckgo':
            results = await this.searchDDG(page, query);
            break;
          case 'bing':
            results = await this.searchBing(page, query);
            break;
          case 'google':
            results = await this.searchGoogle(page, query);
            break;
        }

        // Fallback si no hay resultados
        if (results.length === 0) {
          const fallback = engine === 'duckduckgo' ? 'bing' : 'duckduckgo';
          const fallbackQuery = this.buildQuery(cleanName, fallback);
          this.logger.log(`[Playwright] Fallback → ${fallback}`);

          await context.close().catch(() => {});
          const fbContext = await browser.newContext({
            viewport: { width: 1366, height: 768 },
            locale: 'es-PE',
            timezoneId: 'America/Lima',
          });
          const fbPage = await fbContext.newPage();

          try {
            switch (fallback) {
              case 'duckduckgo':
                results = await this.searchDDG(fbPage, fallbackQuery);
                break;
              case 'bing':
                results = await this.searchBing(fbPage, fallbackQuery);
                break;
            }
          } finally {
            await fbContext.close().catch(() => {});
          }
        } else {
          await context.close().catch(() => {});
        }
      } catch {
        await context.close().catch(() => {});
      }

      const ranked = rankResults(results, companyName);
      const elapsed = Date.now() - startTime;

      if (ranked.length === 0) {
        this.status.recordUse(false, elapsed);
        this.logger.warn(`[Playwright] Sin resultados para "${companyName}"`);
        return null;
      }

      const best = ranked[0];
      this.status.recordUse(true, elapsed);

      this.logger.log(`[Playwright] ✅ ${best.url} (score: ${best.score}, ${elapsed}ms)`);

      return new SearchResult({
        company: companyName,
        cleanName,
        website: best.url,
        score: best.score,
        title: best.title,
        strategy: SearchStrategy.PLAYWRIGHT,
        allResults: ranked.slice(0, 5).map(
          (r) => new SearchResultItem(r.url, r.title, r.score),
        ),
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.error(`[Playwright] Error: ${(error as Error).message}`);
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
    this.engineIdx = 0;
    this.searchCount = 0;
  }

  async dispose(): Promise<void> {
    await this.closeBrowser();
  }

  // ──────────────────────────────────────────────────────────
  // Engine rotation
  // ──────────────────────────────────────────────────────────

  private getNextEngine(): string {
    this.searchCount++;
    if (this.searchCount % 5 === 0) {
      this.engineIdx = (this.engineIdx + 1) % this.engineRotation.length;
    }
    return this.engineRotation[this.engineIdx];
  }

  private buildQuery(cleanName: string, engine: string): string {
    switch (engine) {
      case 'duckduckgo':
        return `"${cleanName}" peru sitio web oficial -site:linkedin.com -site:facebook.com`;
      case 'bing':
        return `"${cleanName}" peru sitio web oficial -site:linkedin.com -site:facebook.com -site:wikipedia.org`;
      case 'google':
        return `"${cleanName}" peru sitio web oficial -linkedin -facebook -wikipedia`;
      default:
        return `${cleanName} peru web oficial`;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Browser management
  // ──────────────────────────────────────────────────────────

  private async getBrowser(): Promise<any> {
    if (!this.browser) {
      const { firefox } = await import('playwright');
      this.browser = await firefox.launch({ headless: true, slowMo: 50 });
      this.logger.log('[Playwright] Firefox iniciado');
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
  // Human-like helpers
  // ──────────────────────────────────────────────────────────

  private async humanType(page: any, selector: string, text: string): Promise<void> {
    await page.click(selector);
    await this.sleep(this.random(500, 1500));
    for (const char of text) {
      await page.keyboard.type(char, { delay: this.random(80, 200) });
      if (Math.random() < 0.08) {
        await this.sleep(this.random(300, 700));
      }
    }
  }

  private async humanScroll(page: any): Promise<void> {
    const amount = this.random(200, 500);
    await page.evaluate((a: number) => window.scrollBy({ top: a, behavior: 'smooth' }), amount);
    await this.sleep(this.random(500, 1000));
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
      await this.sleep(this.random(2000, 4000));

      const input = await page.$('input[name="q"]');
      if (!input) return [];

      await this.humanType(page, 'input[name="q"]', query);
      await this.sleep(this.random(500, 1000));
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector('[data-testid="result"], article, .result', {
          timeout: 20000,
        });
      } catch {
        await this.sleep(5000);
      }

      await this.sleep(this.random(3000, 6000));
      await this.humanScroll(page);

      return page.evaluate(() => {
        const items: Array<{ url: string; title: string }> = [];
        const selectors = ['[data-testid="result"]', 'article', '.result'];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el: Element) => {
            try {
              const link = el.querySelector('a[href^="http"]') as HTMLAnchorElement;
              const title = el.querySelector('h2, [data-testid="result-title-a"]');
              if (link?.href && !link.href.includes('duckduckgo.com')) {
                items.push({ url: link.href, title: title?.textContent?.trim() || '' });
              }
            } catch { /* ignorar */ }
          });
          if (items.length > 0) break;
        }
        return items;
      });
    } catch (error) {
      this.logger.warn(`[PW-DDG] ${(error as Error).message}`);
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
      await this.sleep(this.random(2000, 4000));

      const input = await page.$('input[name="q"], textarea[name="q"]');
      if (!input) return [];

      const selector = (await page.$('textarea[name="q"]'))
        ? 'textarea[name="q"]'
        : 'input[name="q"]';
      await this.humanType(page, selector, query);
      await this.sleep(this.random(500, 1000));
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector('#b_results, .b_algo', { timeout: 20000 });
      } catch {
        await this.sleep(5000);
      }

      await this.sleep(this.random(3000, 6000));
      await this.humanScroll(page);

      return page.evaluate(() => {
        const items: Array<{ url: string; title: string }> = [];
        document.querySelectorAll('.b_algo').forEach((el: Element) => {
          try {
            const link = el.querySelector('a[href^="http"]') as HTMLAnchorElement;
            const title = el.querySelector('h2');
            if (link?.href && !link.href.includes('bing.com')) {
              items.push({ url: link.href, title: title?.textContent?.trim() || '' });
            }
          } catch { /* ignorar */ }
        });
        return items;
      });
    } catch (error) {
      this.logger.warn(`[PW-Bing] ${(error as Error).message}`);
      return [];
    }
  }

  private async searchGoogle(
    page: any,
    query: string,
  ): Promise<Array<{ url: string; title: string }>> {
    try {
      await page.goto('https://www.google.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await this.sleep(this.random(2000, 4000));

      // Cookie consent
      try {
        const consentBtn = await page.$(
          'button[id="L2AGLb"], [aria-label="Aceptar todo"], [aria-label="Accept all"]',
        );
        if (consentBtn) {
          await consentBtn.click();
          await this.sleep(1000);
        }
      } catch { /* ignorar */ }

      const input = await page.$('input[name="q"], textarea[name="q"]');
      if (!input) return [];

      const selector = (await page.$('textarea[name="q"]'))
        ? 'textarea[name="q"]'
        : 'input[name="q"]';
      await this.humanType(page, selector, query);
      await this.sleep(this.random(800, 1500));
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector('#search, #rso', { timeout: 15000 });
      } catch {
        this.logger.warn('[PW-Google] Posible CAPTCHA');
        return [];
      }

      await this.sleep(this.random(3000, 6000));
      await this.humanScroll(page);

      return page.evaluate(() => {
        const items: Array<{ url: string; title: string }> = [];
        document.querySelectorAll('#search .g, #rso .g').forEach((el: Element) => {
          try {
            const link = el.querySelector('a[href^="http"]') as HTMLAnchorElement;
            const title = el.querySelector('h3');
            if (link?.href && !link.href.includes('google.com')) {
              items.push({ url: link.href, title: title?.textContent?.trim() || '' });
            }
          } catch { /* ignorar */ }
        });
        return items;
      });
    } catch (error) {
      this.logger.warn(`[PW-Google] ${(error as Error).message}`);
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────
  // Utils
  // ──────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private random(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
