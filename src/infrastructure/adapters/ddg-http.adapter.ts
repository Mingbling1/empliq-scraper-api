import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult, SearchResultItem } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import { SearchStrategy } from '../../domain/enums/search-strategy.enum';
import { cleanCompanyName, generateSearchVariants } from '../../shared/utils/company-name-cleaner';
import { rankResults } from '../../shared/utils/url-scorer';

/**
 * Adaptador DDG HTTP — el más rápido.
 *
 * Hace POST directo a html.duckduckgo.com/html/ (la versión sin JS).
 * No necesita navegador. ~1-2s por búsqueda.
 */
@Injectable()
export class DdgHttpAdapter implements SearchEnginePort, OnModuleDestroy {
  readonly strategy = SearchStrategy.DDG_HTTP;
  private readonly logger = new Logger(DdgHttpAdapter.name);
  private status: StrategyStatus;
  private userAgents: string[];

  constructor(private config: ConfigService) {
    const maxPerSession = this.config.get<number>('scraper.limits.ddgHttp', 200);
    this.status = new StrategyStatus({
      strategy: SearchStrategy.DDG_HTTP,
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
    const variants = generateSearchVariants(companyName);

    // ── Estrategia multi-query con lenguaje natural ──
    // NO usar site:.pe (muchas empresas peruanas tienen .com: viabcp.com, etc.)
    // Usar lenguaje natural: "página web oficial", "peru empresa"
    // Mantener -site: para excluir ruido
    const negations = '-site:linkedin.com -site:facebook.com -site:wikipedia.org -site:computrabajo.com -site:glassdoor.com -site:indeed.com';

    const queries: string[] = [
      // Q1: Nombre exacto + página web oficial + negaciones
      `"${cleanName}" página web oficial peru ${negations}`,
    ];

    // Q2-Q3: Variantes (acrónimos: BCP, BIP, etc.) — probar TEMPRANO
    // Los acrónimos suelen ser el nombre comercial real y dan mejores resultados
    for (const variant of variants) {
      if (variant !== cleanName && variant.length >= 2) {
        queries.push(`"${variant}" página web oficial peru ${negations}`);
      }
    }

    // Q4: Nombre limpio flexible (sin comillas)
    queries.push(`${cleanName} peru web oficial empresa ${negations}`);

    // Q5: Solo nombre + peru (máxima flexibilidad)
    queries.push(`${cleanName} peru empresa`);

    this.logger.log(`[DDG HTTP] Buscando: "${companyName}" → cleanName: "${cleanName}", variants: [${variants.join(', ')}]`);

    try {
      let rawResults: Array<{ url: string; title: string }> = [];

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        this.logger.log(`[DDG HTTP] Query ${i + 1}/${queries.length}: ${query}`);

        if (i > 0) await this.sleep(2000);
        const html = await this.fetchDDGHTML(query);
        const parsed = this.parseDDGResults(html);

        if (parsed.length > 0) {
          // Si ya tenemos resultados previos, combinar
          if (rawResults.length > 0) {
            rawResults = [...rawResults, ...parsed];
          } else {
            rawResults = parsed;
          }
          this.logger.log(`[DDG HTTP] ✓ ${parsed.length} resultados con query ${i + 1}`);

          // Rankear y decidir si parar
          const tempRanked = rankResults(rawResults, companyName, variants);
          if (tempRanked.length > 0) {
            const best = tempRanked[0];
            const isHomepage = this.isHomepageUrl(best.url);
            // Exigir score >= 20 para homepages, o >= 25 para deep paths
            const threshold = isHomepage ? 20 : 25;
            if (best.score >= threshold) {
              this.logger.log(`[DDG HTTP] Score ${best.score} >= ${threshold} (homepage=${isHomepage}), suficiente`);
              break;
            }
            this.logger.log(`[DDG HTTP] Score ${best.score} < ${threshold}, intentando más queries...`);
          }
        }
      }

      const ranked = rankResults(rawResults, companyName, variants);
      const elapsed = Date.now() - startTime;

      if (ranked.length === 0) {
        this.status.recordUse(false, elapsed);
        this.logger.warn(`[DDG HTTP] Sin resultados para "${companyName}"`);
        return null;
      }

      const best = ranked[0];
      this.status.recordUse(true, elapsed);

      this.logger.log(`[DDG HTTP] ✅ ${best.url} (score: ${best.score}, ${elapsed}ms)`);

      return new SearchResult({
        company: companyName,
        cleanName,
        website: best.url,
        score: best.score,
        title: best.title,
        strategy: SearchStrategy.DDG_HTTP,
        allResults: ranked.slice(0, 5).map(
          (r) => new SearchResultItem(r.url, r.title, r.score),
        ),
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.error(`[DDG HTTP] Error: ${(error as Error).message}`);
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
    // No hay recursos que liberar en HTTP puro
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private fetchDDGHTML(query: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const postData = `q=${encodeURIComponent(query)}`;
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

      const options: https.RequestOptions = {
        hostname: 'html.duckduckgo.com',
        path: '/html/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-PE,es;q=0.9',
          Referer: 'https://duckduckgo.com/',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Timeout DDG HTTP'));
      });

      req.write(postData);
      req.end();
    });
  }

  private parseDDGResults(html: string): Array<{ url: string; title: string }> {
    const results: Array<{ url: string; title: string }> = [];
    const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];
      const title = match[2].replace(/<[^>]*>/g, '').trim();

      // DDG usa redirect URLs con ?uddg=
      if (url.includes('uddg=')) {
        try {
          const parsed = new URL(url, 'https://duckduckgo.com');
          const uddg = parsed.searchParams.get('uddg');
          if (uddg) url = uddg;
        } catch {
          // ignorar
        }
      }

      try {
        url = decodeURIComponent(url);
      } catch {
        // ignorar
      }

      if (url.startsWith('http')) {
        results.push({ url, title });
      }
    }

    return results;
  }

  /**
   * Verifica si la URL es una homepage (raíz del sitio).
   */
  private isHomepageUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname;
      return path === '/' || path === '' || /^\/[a-z]{2}(-[A-Z]{2})?\/?$/.test(path);
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
