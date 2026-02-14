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
 * Adaptador Bing HTTP — fallback ligero sin browser.
 *
 * Hace GET directo a www.bing.com/search con parsing HTML.
 * No necesita navegador. ~2-4s por búsqueda.
 * Complementa DDG HTTP como segunda estrategia.
 */
@Injectable()
export class BingHttpAdapter implements SearchEnginePort, OnModuleDestroy {
  readonly strategy = SearchStrategy.BING_HTTP;
  private readonly logger = new Logger(BingHttpAdapter.name);
  private status: StrategyStatus;
  private userAgents: string[];

  constructor(private config: ConfigService) {
    const maxPerSession = this.config.get<number>('scraper.limits.bingHttp', 150);
    this.status = new StrategyStatus({
      strategy: SearchStrategy.BING_HTTP,
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
    // Bing soporta intitle: que es útil
    const negations = '-site:linkedin.com -site:facebook.com -site:wikipedia.org -site:computrabajo.com -site:glassdoor.com -site:indeed.com';

    const queries: string[] = [
      // Q1: Nombre exacto + página web oficial + negaciones
      `"${cleanName}" página web oficial peru ${negations}`,
    ];

    // Q2-Q3: Variantes/acrónimos — probar TEMPRANO
    for (const variant of variants) {
      if (variant !== cleanName && variant.length >= 2) {
        queries.push(`"${variant}" página web oficial peru ${negations}`);
      }
    }

    // Q4: intitle para relevancia alta
    queries.push(`intitle:"${cleanName}" peru empresa`);

    // Q5: Flexible sin comillas
    queries.push(`${cleanName} peru web oficial empresa ${negations}`);

    // Q6: Solo nombre + peru (máxima flexibilidad)
    queries.push(`${cleanName} peru empresa`);

    this.logger.log(`[Bing HTTP] Buscando: "${companyName}" → cleanName: "${cleanName}", variants: [${variants.join(', ')}]`);

    try {
      let rawResults: Array<{ url: string; title: string }> = [];

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        this.logger.log(`[Bing HTTP] Query ${i + 1}/${queries.length}: ${query}`);

        if (i > 0) await this.sleep(2000);
        const html = await this.fetchBingHTML(query);
        const parsed = this.parseBingResults(html);

        if (parsed.length > 0) {
          if (rawResults.length > 0) {
            rawResults = [...rawResults, ...parsed];
          } else {
            rawResults = parsed;
          }
          this.logger.log(`[Bing HTTP] ✓ ${parsed.length} resultados con query ${i + 1}`);

          // Rankear y decidir si parar
          const tempRanked = rankResults(rawResults, companyName, variants);
          if (tempRanked.length > 0) {
            const best = tempRanked[0];
            const isHomepage = this.isHomepageUrl(best.url);
            const threshold = isHomepage ? 20 : 25;
            if (best.score >= threshold) {
              this.logger.log(`[Bing HTTP] Score ${best.score} >= ${threshold} (homepage=${isHomepage}), suficiente`);
              break;
            }
            this.logger.log(`[Bing HTTP] Score ${best.score} < ${threshold}, intentando más queries...`);
          }
        }
      }

      const ranked = rankResults(rawResults, companyName, variants);
      const elapsed = Date.now() - startTime;

      if (ranked.length === 0) {
        this.status.recordUse(false, elapsed);
        this.logger.warn(`[Bing HTTP] Sin resultados para "${companyName}"`);
        return null;
      }

      const best = ranked[0];
      this.status.recordUse(true, elapsed);

      this.logger.log(`[Bing HTTP] ✅ ${best.url} (score: ${best.score}, ${elapsed}ms)`);

      return new SearchResult({
        company: companyName,
        cleanName,
        website: best.url,
        score: best.score,
        title: best.title,
        strategy: SearchStrategy.BING_HTTP,
        allResults: ranked.slice(0, 5).map(
          (r) => new SearchResultItem(r.url, r.title, r.score),
        ),
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.error(`[Bing HTTP] Error: ${(error as Error).message}`);
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

  private fetchBingHTML(query: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const searchUrl = `/search?q=${encodeURIComponent(query)}&setlang=es&cc=PE`;
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

      const options: https.RequestOptions = {
        hostname: 'www.bing.com',
        path: searchUrl,
        method: 'GET',
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-PE,es;q=0.9,en;q=0.5',
          'Accept-Encoding': 'identity',
          Connection: 'keep-alive',
          'Cache-Control': 'no-cache',
        },
      };

      const req = https.request(options, (res) => {
        // Follow redirects (Bing sometimes redirects)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, 'https://www.bing.com');
          const redirectOptions: https.RequestOptions = {
            hostname: redirectUrl.hostname,
            path: redirectUrl.pathname + redirectUrl.search,
            method: 'GET',
            headers: options.headers,
          };
          const req2 = https.request(redirectOptions, (res2) => {
            let data = '';
            res2.on('data', (chunk) => (data += chunk));
            res2.on('end', () => resolve(data));
          });
          req2.on('error', reject);
          req2.setTimeout(15000, () => {
            req2.destroy();
            reject(new Error('Timeout Bing HTTP redirect'));
          });
          req2.end();
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Timeout Bing HTTP'));
      });

      req.end();
    });
  }

  /**
   * Parsea resultados de Bing desde HTML crudo.
   * Bing usa la clase .b_algo para cada resultado orgánico.
   */
  private parseBingResults(html: string): Array<{ url: string; title: string }> {
    const results: Array<{ url: string; title: string }> = [];

    // Patrón 1: Resultados orgánicos .b_algo con <h2><a href="...">
    const algoPattern = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let algoMatch: RegExpExecArray | null;

    while ((algoMatch = algoPattern.exec(html)) !== null) {
      const block = algoMatch[1];
      // Extraer el link del h2
      const linkMatch = /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (linkMatch) {
        const url = linkMatch[1];
        const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
        if (url && !url.includes('bing.com') && !url.includes('microsoft.com')) {
          results.push({ url, title });
        }
      }
    }

    // Patrón 2: Fallback — buscar cualquier <a> dentro de #b_results
    if (results.length === 0) {
      const linkPattern = /<a[^>]*href="(https?:\/\/(?!www\.bing\.com)[^"]*)"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/gi;
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkPattern.exec(html)) !== null) {
        const url = linkMatch[1];
        const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
        if (url && !url.includes('bing.com')) {
          results.push({ url, title });
        }
      }
    }

    // Patrón 3: Regex más flexible para encontrar URLs en resultados
    if (results.length === 0) {
      const flexPattern = /<cite[^>]*>([\s\S]*?)<\/cite>/gi;
      let citeMatch: RegExpExecArray | null;
      while ((citeMatch = flexPattern.exec(html)) !== null) {
        let cite = citeMatch[1].replace(/<[^>]*>/g, '').trim();
        // Bing muestra la URL sin protocolo en <cite>
        if (!cite.startsWith('http')) {
          cite = 'https://' + cite;
        }
        // Limpiar ... y espacios de la URL
        cite = cite.replace(/\s/g, '').replace(/…/g, '').replace(/\.\.\./g, '');

        // Extraer solo el dominio base (evitar URLs con paths rotos del cite)
        try {
          const parsed = new URL(cite);
          const hostname = parsed.hostname;
          // Validar que el hostname tiene un TLD válido y no tiene punycode roto
          if (
            !hostname.includes('bing.com') &&
            !hostname.includes('microsoft.com') &&
            !hostname.includes('google.com') &&
            hostname.includes('.') &&
            !/xn--/.test(hostname) && // rechazar CUALQUIER punycode en el hostname
            hostname.split('.').every(part => part.length <= 30) // partes de dominio razonables
          ) {
            results.push({ url: parsed.origin, title: '' });
          }
        } catch {
          // URL inválida, ignorar
        }
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
