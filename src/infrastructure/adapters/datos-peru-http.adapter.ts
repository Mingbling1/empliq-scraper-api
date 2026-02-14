import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult, SearchResultItem } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import { SearchStrategy } from '../../domain/enums/search-strategy.enum';
import {
  cleanCompanyName,
  generateSearchVariants,
  getCompanyWords,
} from '../../shared/utils/company-name-cleaner';

const TARGET_DOMAIN = 'datosperu.org';

/**
 * Adaptador de búsqueda en DatosPerú.org (directorio de empresas).
 *
 * Se usa como FALLBACK secundario (después de universidadperu.com) cuando
 * DDG y Bing no encuentran la web propia de la empresa.
 *
 * Nota: DatosPerú tiene publicidad Framer que puede bloquear contenido en browser,
 * pero el cheerio scraper (HTTP puro) puede obtener el HTML subyacente.
 */
@Injectable()
export class DatosPeruHttpAdapter implements SearchEnginePort, OnModuleDestroy {
  readonly strategy = SearchStrategy.DATOS_PERU_HTTP;
  private readonly logger = new Logger(DatosPeruHttpAdapter.name);
  private status: StrategyStatus;
  private userAgents: string[];

  constructor(private config: ConfigService) {
    const maxPerSession = this.config.get<number>('scraper.limits.datosPeruHttp', 100);
    this.status = new StrategyStatus({
      strategy: SearchStrategy.DATOS_PERU_HTTP,
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

    // Queries para encontrar la ficha en datosperu.org
    const queries: string[] = [
      `${cleanName} datos peru`,
      `"${cleanName}" site:${TARGET_DOMAIN}`,
    ];

    for (const variant of variants) {
      if (variant !== cleanName && variant.length >= 3) {
        queries.push(`"${variant}" site:${TARGET_DOMAIN}`);
      }
    }

    this.logger.log(`[DatosPeru] Buscando directorio: "${companyName}" → "${cleanName}"`);

    try {
      let bestUrl: string | null = null;
      let bestTitle = '';
      let bestScore = 0;
      const allFound: SearchResultItem[] = [];

      for (let i = 0; i < Math.min(queries.length, 3); i++) {
        const query = queries[i];
        this.logger.log(`[DatosPeru] Query ${i + 1}: ${query}`);

        if (i > 0) await this.sleep(1500);

        // DDG primero, Bing como respaldo
        let results = await this.fetchDDG(query);

        if (results.length === 0) {
          this.logger.log(`[DatosPeru] DDG sin resultados, intentando Bing...`);
          await this.sleep(1000);
          results = await this.fetchBing(query);
        }

        for (const r of results) {
          if (!this.isTargetUrl(r.url)) continue;
          const score = this.scoreDirectoryResult(r.url, r.title, companyName, variants);
          allFound.push(new SearchResultItem(r.url, r.title, score));

          if (score > bestScore) {
            bestUrl = r.url;
            bestTitle = r.title;
            bestScore = score;
          }
        }

        if (bestScore >= 15) {
          this.logger.log(`[DatosPeru] Score ${bestScore} >= 15, suficiente`);
          break;
        }
      }

      const elapsed = Date.now() - startTime;

      if (!bestUrl || bestScore < 8) {
        this.status.recordUse(false, elapsed);
        this.logger.warn(`[DatosPeru] No encontrado para "${companyName}" (${elapsed}ms)`);
        return null;
      }

      this.status.recordUse(true, elapsed);
      this.logger.log(`[DatosPeru] ✅ ${bestUrl} (score: ${bestScore}, ${elapsed}ms)`);

      return new SearchResult({
        company: companyName,
        cleanName,
        website: bestUrl,
        score: bestScore,
        title: bestTitle,
        strategy: this.strategy,
        allResults: allFound.sort((a, b) => b.score - a.score).slice(0, 5),
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.error(`[DatosPeru] Error: ${(error as Error).message}`);
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
    /* No hay recursos que liberar */
  }

  // ════════════════════════════════════════════════════════
  // URL VALIDATION & SCORING
  // ════════════════════════════════════════════════════════

  /**
   * Acepta URLs de datosperu.org que son páginas de empresa.
   * Patrones comunes: /empresa-{slug}.php, /perfil-empresa-{slug}.php
   * Rechaza: homepage, categorías, top-empresas, etc.
   */
  private isTargetUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();

      if (!host.includes(TARGET_DOMAIN)) return false;

      // Páginas de empresa comunes en datosperu.org
      if (path.includes('/empresa-') || path.includes('/perfil-empresa')) return true;

      // Rechazar páginas que NO son fichas de empresa
      if (path === '/' || path === '') return false;
      if (path.includes('/categoria-')) return false;
      if (path.includes('/top-empresas')) return false;
      if (path.includes('/quienes-somos')) return false;
      if (path.includes('/contactenos')) return false;
      if (path.includes('/privacidad')) return false;
      if (path.includes('/atribuciones')) return false;
      if (path.includes('/twitter-feed')) return false;
      if (path.includes('/generador-')) return false;

      // Aceptar otras páginas que contengan .php y no sean genéricas
      if (path.endsWith('.php') && path.length > 10) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Scoring para páginas de directorio.
   * Base de 10 por encontrar una ficha válida.
   */
  private scoreDirectoryResult(
    url: string,
    title: string,
    companyName: string,
    variants: string[],
  ): number {
    let score = 10; // Base: encontrar una ficha válida de empresa
    const words = getCompanyWords(companyName);

    try {
      const slug = new URL(url).pathname.toLowerCase();

      for (const w of words) {
        if (w.length > 3 && slug.includes(w)) score += 5;
      }

      for (const v of variants) {
        if (v.length >= 3 && slug.includes(v.toLowerCase())) score += 3;
      }
    } catch {
      /* URL inválida */
    }

    if (title) {
      const t = title.toLowerCase();
      for (const w of words) {
        if (w.length > 3 && t.includes(w)) score += 3;
      }
    }

    return score;
  }

  // ════════════════════════════════════════════════════════
  // DDG HTTP
  // ════════════════════════════════════════════════════════

  private fetchDDG(query: string): Promise<Array<{ url: string; title: string }>> {
    return new Promise((resolve) => {
      const postData = `q=${encodeURIComponent(query)}`;
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

      const req = https.request(
        {
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
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(this.parseDDGHTML(data)));
        },
      );

      req.on('error', () => resolve([]));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve([]);
      });
      req.write(postData);
      req.end();
    });
  }

  private parseDDGHTML(html: string): Array<{ url: string; title: string }> {
    const results: Array<{ url: string; title: string }> = [];
    const pattern =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];
      const title = match[2].replace(/<[^>]*>/g, '').trim();

      if (url.includes('uddg=')) {
        try {
          const parsed = new URL(url, 'https://duckduckgo.com');
          const uddg = parsed.searchParams.get('uddg');
          if (uddg) url = uddg;
        } catch {
          /* ignorar */
        }
      }

      try {
        url = decodeURIComponent(url);
      } catch {
        /* ignorar */
      }

      if (url.startsWith('http')) {
        results.push({ url, title });
      }
    }

    return results;
  }

  // ════════════════════════════════════════════════════════
  // BING HTTP
  // ════════════════════════════════════════════════════════

  private fetchBing(query: string): Promise<Array<{ url: string; title: string }>> {
    return new Promise((resolve) => {
      const searchPath = `/search?q=${encodeURIComponent(query)}&setlang=es&cc=PE`;
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

      const options: https.RequestOptions = {
        hostname: 'www.bing.com',
        path: searchPath,
        method: 'GET',
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-PE,es;q=0.9',
          'Accept-Encoding': 'identity',
        },
      };

      const req = https.request(options, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const redir = new URL(res.headers.location, 'https://www.bing.com');
          const req2 = https.request(
            {
              hostname: redir.hostname,
              path: redir.pathname + redir.search,
              method: 'GET',
              headers: {
                'User-Agent': ua,
                Accept: 'text/html',
                'Accept-Encoding': 'identity',
              },
            },
            (res2) => {
              let data = '';
              res2.on('data', (chunk) => (data += chunk));
              res2.on('end', () => resolve(this.parseBingHTML(data)));
            },
          );
          req2.on('error', () => resolve([]));
          req2.setTimeout(10000, () => {
            req2.destroy();
            resolve([]);
          });
          req2.end();
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(this.parseBingHTML(data)));
      });

      req.on('error', () => resolve([]));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve([]);
      });
      req.end();
    });
  }

  private parseBingHTML(html: string): Array<{ url: string; title: string }> {
    const results: Array<{ url: string; title: string }> = [];
    const pattern = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      const linkMatch =
        /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(
          match[1],
        );
      if (linkMatch) {
        results.push({
          url: linkMatch[1],
          title: linkMatch[2].replace(/<[^>]*>/g, '').trim(),
        });
      }
    }

    return results;
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
