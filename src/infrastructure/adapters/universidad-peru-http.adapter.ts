import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';
import * as querystring from 'querystring';
import { SearchEnginePort } from '../../domain/ports/search-engine.port';
import { SearchResult, SearchResultItem } from '../../domain/entities/search-result.entity';
import { StrategyStatus } from '../../domain/entities/strategy-status.entity';
import { SearchStrategy } from '../../domain/enums/search-strategy.enum';
import {
  cleanCompanyName,
  generateSearchVariants,
  getCompanyWords,
} from '../../shared/utils/company-name-cleaner';

const TARGET_DOMAIN = 'universidadperu.com';
const SEARCH_PATH = '/empresas/busqueda/';

/**
 * Adaptador de búsqueda DIRECTA en UniversidadPeru.com (directorio de empresas).
 *
 * Usa el buscador interno de universidadperu.com:
 *   POST https://www.universidadperu.com/empresas/busqueda/
 *   body: buscaempresa={RUC o Razón Social}
 *
 * La respuesta es la página de la empresa directamente.
 * Se extrae la URL canónica del <link rel="canonical"> en el HTML.
 *
 * NO usa DuckDuckGo ni Bing — búsqueda directa en el directorio.
 */
@Injectable()
export class UniversidadPeruHttpAdapter implements SearchEnginePort, OnModuleDestroy {
  readonly strategy = SearchStrategy.UNIV_PERU_HTTP;
  private readonly logger = new Logger(UniversidadPeruHttpAdapter.name);
  private status: StrategyStatus;
  private userAgents: string[];

  constructor(private config: ConfigService) {
    const maxPerSession = this.config.get<number>('scraper.limits.univPeruHttp', 100);
    this.status = new StrategyStatus({
      strategy: SearchStrategy.UNIV_PERU_HTTP,
      maxPerSession,
    });
    this.userAgents = this.config.get<string[]>('scraper.userAgents', [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  async search(companyName: string, ruc?: string): Promise<SearchResult | null> {
    const startTime = Date.now();
    const cleanName = cleanCompanyName(companyName);
    const variants = generateSearchVariants(companyName);

    this.logger.log(
      `[UnivPeru] Búsqueda directa: "${companyName}" → "${cleanName}" (RUC: ${ruc || 'N/A'})`,
    );

    // Términos de búsqueda: primero RUC (más confiable), luego nombre
    const searchTerms: string[] = [];
    if (ruc) searchTerms.push(ruc);
    searchTerms.push(cleanName);

    // También intentar con variantes cortas
    for (const variant of variants) {
      if (variant !== cleanName && variant.length >= 3) {
        searchTerms.push(variant);
      }
    }

    try {
      for (let i = 0; i < Math.min(searchTerms.length, 3); i++) {
        const term = searchTerms[i];
        this.logger.log(`[UnivPeru] Intento ${i + 1}: "${term}"`);

        if (i > 0) await this.sleep(1500);

        const html = await this.postSearch(term);

        if (!html) {
          this.logger.warn(`[UnivPeru] Sin respuesta para "${term}"`);
          continue;
        }

        // Extraer URL canónica del HTML
        const canonicalUrl = this.extractCanonicalUrl(html);

        if (!canonicalUrl || !this.isValidCompanyPage(canonicalUrl)) {
          this.logger.log(
            `[UnivPeru] No se encontró página de empresa para "${term}" (canonical: ${canonicalUrl || 'null'})`,
          );
          continue;
        }

        // Extraer título de la página
        const title = this.extractTitle(html);

        // Calcular score
        const score = this.scoreDirectoryResult(
          canonicalUrl,
          title,
          companyName,
          variants,
        );

        const elapsed = Date.now() - startTime;
        this.status.recordUse(true, elapsed);

        const allResults = [new SearchResultItem(canonicalUrl, title, score)];

        this.logger.log(
          `[UnivPeru] ✅ ${canonicalUrl} (score: ${score}, ${elapsed}ms, título: "${title}")`,
        );

        return new SearchResult({
          company: companyName,
          cleanName,
          website: canonicalUrl,
          score,
          title,
          strategy: this.strategy,
          allResults,
        });
      }

      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.warn(`[UnivPeru] No encontrado para "${companyName}" (${elapsed}ms)`);
      return null;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.status.recordUse(false, elapsed);
      this.logger.error(`[UnivPeru] Error: ${(error as Error).message}`);
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
  // HTTP SEARCH (POST directo a universidadperu.com)
  // ════════════════════════════════════════════════════════

  /**
   * POST al buscador interno de universidadperu.com.
   * Envía el RUC o nombre en el campo "buscaempresa".
   * Retorna el HTML de la respuesta (que es la página de la empresa directamente).
   */
  private postSearch(searchTerm: string): Promise<string | null> {
    return new Promise((resolve) => {
      const postData = querystring.stringify({ buscaempresa: searchTerm });
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

      const options: https.RequestOptions = {
        hostname: `www.${TARGET_DOMAIN}`,
        path: SEARCH_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': ua,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
          Referer: `https://www.${TARGET_DOMAIN}/empresas/`,
          Origin: `https://www.${TARGET_DOMAIN}`,
        },
      };

      const req = https.request(options, (res) => {
        // Manejar redirecciones (301, 302, 303)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          this.logger.log(`[UnivPeru] Redirect → ${res.headers.location}`);
          this.followRedirect(res.headers.location, ua)
            .then(resolve)
            .catch(() => resolve(null));
          return;
        }

        if (res.statusCode !== 200) {
          this.logger.warn(`[UnivPeru] HTTP ${res.statusCode}`);
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve(data));
      });

      req.on('error', (err) => {
        this.logger.error(`[UnivPeru] Request error: ${err.message}`);
        resolve(null);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Sigue una redirección HTTP.
   */
  private followRedirect(
    location: string,
    ua: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const redirectUrl = new URL(
          location,
          `https://www.${TARGET_DOMAIN}`,
        );

        const isHttps = redirectUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const req = httpModule.request(
          {
            hostname: redirectUrl.hostname,
            path: redirectUrl.pathname + redirectUrl.search,
            method: 'GET',
            headers: {
              'User-Agent': ua,
              Accept: 'text/html,application/xhtml+xml',
              'Accept-Language': 'es-PE,es;q=0.9',
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => (data += chunk.toString()));
            res.on('end', () => resolve(data));
          },
        );

        req.on('error', () => resolve(null));
        req.setTimeout(10000, () => {
          req.destroy();
          resolve(null);
        });
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // HTML PARSING
  // ════════════════════════════════════════════════════════

  /**
   * Extrae la URL canónica del HTML (<link rel="canonical" href="...">).
   * Esta URL indica la ficha de la empresa en universidadperu.com.
   */
  private extractCanonicalUrl(html: string): string | null {
    // <link rel="canonical" href="https://www.universidadperu.com/empresas/policia-nacional-peru.php">
    const canonicalMatch = html.match(
      /<link\s+rel="canonical"\s+href="(https?:\/\/[^"]+)"/i,
    );

    if (canonicalMatch) {
      return canonicalMatch[1];
    }

    // Fallback: <meta property="og:url" content="...">
    const ogUrlMatch = html.match(
      /<meta\s+property="og:url"\s+content="(https?:\/\/[^"]+)"/i,
    );

    if (ogUrlMatch) {
      return ogUrlMatch[1];
    }

    // Fallback: <link rel="alternate" ... href="...empresas/...">
    const alternateMatch = html.match(
      /<link\s+rel="alternate"[^>]+href="(https?:\/\/[^"]*universidadperu\.com\/empresas\/[^"]+\.php)"/i,
    );

    if (alternateMatch) {
      return alternateMatch[1].replace(
        'm.universidadperu.com',
        'www.universidadperu.com',
      );
    }

    return null;
  }

  /**
   * Extrae el título de la empresa del HTML.
   */
  private extractTitle(html: string): string {
    // Intentar <h1>
    const h1Match = html.match(/<h1[^>]*>([^<]+)/i);
    if (h1Match) {
      const title = h1Match[1].trim();
      // Ignorar títulos genéricos
      if (
        title &&
        !title.toLowerCase().includes('universidad peru') &&
        !title.toLowerCase().includes('portal de estudios') &&
        !title.toLowerCase().includes('desconocida')
      ) {
        return title;
      }
    }

    // Fallback: og:title
    const ogTitleMatch = html.match(
      /<meta\s+property="og:title"\s+content="([^"]+)"/i,
    );
    if (ogTitleMatch) {
      const ogTitle = ogTitleMatch[1].trim();
      if (
        !ogTitle.toLowerCase().includes('universidad peru') &&
        !ogTitle.toLowerCase().includes('portal de estudios')
      ) {
        return ogTitle;
      }
    }

    return '';
  }

  // ════════════════════════════════════════════════════════
  // URL VALIDATION & SCORING
  // ════════════════════════════════════════════════════════

  /**
   * Verifica que la URL sea una página válida de empresa en universidadperu.com
   * y NO la homepage, búsqueda ni página "desconocida".
   */
  private isValidCompanyPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();

      if (!host.includes(TARGET_DOMAIN)) return false;

      // Debe estar en /empresas/ y terminar en .php
      if (!path.startsWith('/empresas/') || !path.endsWith('.php')) return false;

      // Rechazar la raíz del directorio
      if (path === '/empresas/' || path === '/empresas/index.php') return false;

      // Rechazar la página de búsqueda
      if (path.includes('/busqueda')) return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scoring para páginas de directorio.
   * Base de 10 por encontrar una ficha válida de empresa.
   * Bonus por coincidencia de nombre en slug y título.
   */
  private scoreDirectoryResult(
    url: string,
    title: string,
    companyName: string,
    variants: string[],
  ): number {
    let score = 10; // Base: ficha de empresa encontrada
    const words = getCompanyWords(companyName);

    try {
      const slug = new URL(url).pathname.toLowerCase();

      // Bonus por palabras del nombre en el slug
      for (const w of words) {
        if (w.length > 3 && slug.includes(w)) score += 5;
      }

      // Bonus por variantes (acrónimos, etc.) en el slug
      for (const v of variants) {
        if (v.length >= 3 && slug.includes(v.toLowerCase())) score += 3;
      }
    } catch {
      /* URL inválida */
    }

    // Bonus por coincidencia en el título
    if (title) {
      const t = title.toLowerCase();
      for (const w of words) {
        if (w.length > 3 && t.includes(w)) score += 3;
      }
    }

    return score;
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
