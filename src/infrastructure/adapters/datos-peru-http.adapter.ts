import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import * as cheerio from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  DatosPeruEnrichmentPort,
  EnrichResult,
} from '../../domain/ports/datos-peru-enrichment.port';
import {
  DatosPeruProfile,
  DatosPeruExecutive,
  DatosPeruBranch,
  DatosPeruWorkerHistory,
  DatosPeruHistoricalCondition,
  DatosPeruHistoricalAddress,
} from '../../domain/entities/datos-peru-profile.entity';

const BASE_URL = 'https://www.datosperu.org';
const SEARCH_PATH = '/buscador_empresas.php';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/** Cipher suites que imitan a Chrome 120 para bypass JA3 fingerprint */
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

/** SOCKS5 proxies comprobados que pasan Cloudflare */
const SEED_PROXIES: string[] = [
  'socks5h://192.111.134.10:4145',
  'socks5h://192.252.209.158:4145',
  'socks5h://192.252.208.70:14282',
  'socks5h://198.8.94.174:39078',
  'socks5h://184.178.172.5:15303',
];

/** URL de lista SOCKS5 pública para refrescar proxies */
const PROXY_LIST_URL =
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt';

@Injectable()
export class DatosPeruHttpAdapter implements DatosPeruEnrichmentPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatosPeruHttpAdapter.name);

  /** Modo directo: intenta primero sin proxy (IP residencial) */
  private readonly directMode = process.env.DATOSPERU_DIRECT === 'true';

  /** Pool de proxies activos (socks5h://host:port) */
  private proxies: string[] = [...SEED_PROXIES];
  /** Índice round-robin */
  private proxyIdx = 0;
  /** Cuántos reintentos por request */
  private readonly MAX_RETRIES = 3;

  /** Conteo de fallos consecutivos por proxy */
  private proxyFailCounts = new Map<string, number>();
  /** Proxies descartados por exceso de fallos */
  private blacklistedProxies = new Set<string>();
  /** Máximo de fallos antes de blacklistear */
  private readonly BLACKLIST_THRESHOLD = 3;
  /** Intervalo de refresco periódico */
  private refreshInterval: NodeJS.Timeout | null = null;
  /** Cada cuánto refrescar la lista de proxies (30 min) */
  private readonly REFRESH_INTERVAL_MS = 30 * 60 * 1000;

  // ════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ════════════════════════════════════════════════════════

  async onModuleInit(): Promise<void> {
    if (this.directMode) {
      this.logger.log(`[DatosPeru] 🏠 Modo DIRECTO — IP residencial primero, proxies como fallback`);
      return; // No necesita refrescar proxies al inicio
    }
    this.logger.log(`[DatosPeru] Inicializando con ${this.proxies.length} proxies seed`);
    // Refrescar proxies en background (no bloquea startup)
    this.refreshProxies().catch(() => {});
    // Refrescar periódicamente
    this.refreshInterval = setInterval(() => {
      this.logger.log(`[DatosPeru] ⏰ Refresco periódico de proxies...`);
      this.refreshProxies().catch(() => {});
    }, this.REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // ════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════

  async enrich(ruc: string): Promise<EnrichResult> {
    const start = Date.now();
    this.logger.log(`[DatosPeru] Enriqueciendo RUC ${ruc}`);

    try {
      // Paso 1: Buscar URL de la empresa por RUC
      const searchResult = await this.searchByRuc(ruc);

      if (!searchResult.path) {
        if (searchResult.notFoundOnSite) {
          this.logger.warn(`[DatosPeru] RUC ${ruc} no existe en DatosPeru (no reintentar)`);
          return {
            profile: null,
            errorType: 'not_found',
            errorMessage: `RUC ${ruc} not found on datosperu.org`,
          };
        }
        this.logger.warn(`[DatosPeru] No se pudo buscar RUC ${ruc} (proxies fallaron)`);
        return {
          profile: null,
          errorType: 'proxy_error',
          errorMessage: 'All proxies failed during search',
        };
      }

      const companyUrl = `${BASE_URL}/${searchResult.path}`;
      this.logger.log(`[DatosPeru] URL encontrada: ${companyUrl}`);

      // Paso 2: Descargar página de la empresa
      const html = await this.fetchPage(companyUrl);
      if (!html) {
        this.logger.warn(`[DatosPeru] No se pudo descargar ${companyUrl}`);
        return {
          profile: null,
          errorType: 'proxy_error',
          errorMessage: 'All proxies failed during page fetch',
        };
      }

      // Paso 3: Parsear HTML y extraer datos
      const profile = this.parseCompanyPage(html, ruc, companyUrl);
      profile.durationMs = Date.now() - start;
      profile.scrapedAt = new Date();

      this.logger.log(
        `[DatosPeru] ✅ ${profile.summary} (${profile.durationMs}ms)`,
      );

      return { profile };
    } catch (err) {
      this.logger.error(
        `[DatosPeru] Error enriqueciendo RUC ${ruc}: ${(err as Error).message}`,
      );
      return {
        profile: null,
        errorType: 'parse_error',
        errorMessage: (err as Error).message,
      };
    }
  }

  // ════════════════════════════════════════════════════════
  //  PROXY MANAGEMENT
  // ════════════════════════════════════════════════════════

  /** Obtiene un proxy SOCKS5 del pool (round-robin), saltando blacklisteados */
  private nextProxy(): string {
    const available = this.proxies.filter(p => !this.blacklistedProxies.has(p));
    if (available.length === 0) {
      // Todos blacklisteados → reset y forzar refresco
      this.logger.warn(
        `[DatosPeru] ⚠️ Todos los ${this.proxies.length} proxies blacklisteados, reseteando...`,
      );
      this.blacklistedProxies.clear();
      this.proxyFailCounts.clear();
      // Trigger refresh en background
      this.refreshProxies().catch(() => {});
      const proxy = this.proxies[this.proxyIdx % this.proxies.length];
      this.proxyIdx++;
      return proxy;
    }
    const proxy = available[this.proxyIdx % available.length];
    this.proxyIdx++;
    return proxy;
  }

  /** Registra un fallo para un proxy. Si supera el umbral → blacklist */
  private markProxyFailed(proxyUrl: string): void {
    const count = (this.proxyFailCounts.get(proxyUrl) || 0) + 1;
    this.proxyFailCounts.set(proxyUrl, count);
    if (count >= this.BLACKLIST_THRESHOLD) {
      this.blacklistedProxies.add(proxyUrl);
      this.logger.warn(
        `[DatosPeru] 🚫 Proxy blacklisteado (${count} fallos): ${proxyUrl}`,
      );
    }
  }

  /** Registra un éxito para un proxy → resetea su contador de fallos */
  private markProxySuccess(proxyUrl: string): void {
    this.proxyFailCounts.delete(proxyUrl);
  }

  /** Crea un SocksProxyAgent para el proxy dado */
  private makeAgent(proxyUrl: string): SocksProxyAgent {
    return new SocksProxyAgent(proxyUrl);
  }

  /** Refresca la lista de proxies desde GitHub */
  private async refreshProxies(): Promise<void> {
    try {
      const body = await this.fetchRaw(PROXY_LIST_URL, 10000);
      if (!body) return;

      const lines = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l))
        .slice(0, 60); // limitar para no testear demasiados

      if (lines.length === 0) return;

      this.logger.log(`[DatosPeru] Testeando ${lines.length} proxies SOCKS5...`);

      // Testear en paralelo con timeout corto
      const working: string[] = [];
      const testUrl = `${BASE_URL}${SEARCH_PATH}?buscar=20100047218`;

      const promises = lines.map(async (line) => {
        const proxyUrl = `socks5h://${line}`;
        try {
          const agent = this.makeAgent(proxyUrl);
          const result = await this.httpGet(testUrl, agent, 8000);
          if (result.html && result.html.length > 5000 && result.html.includes('datosperu')) {
            working.push(proxyUrl);
          }
        } catch {
          // ignore
        }
      });

      await Promise.allSettled(promises);

      if (working.length > 0) {
        this.proxies = working;
        this.proxyIdx = 0;
        // Limpiar blacklist ya que tenemos proxies frescos
        this.blacklistedProxies.clear();
        this.proxyFailCounts.clear();
        this.logger.log(
          `[DatosPeru] ✅ ${working.length} proxies funcionales encontrados`,
        );
      } else {
        this.logger.warn(
          `[DatosPeru] No se encontraron proxies nuevos, manteniendo ${this.proxies.length} (${this.blacklistedProxies.size} blacklisteados)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[DatosPeru] Error refrescando proxies: ${(err as Error).message}`,
      );
    }
  }

  /** GET plain (sin proxy) para obtener la lista de proxies */
  private fetchRaw(url: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const proto = url.startsWith('https') ? https : http;
      const req = proto.request(url, { method: 'GET' }, (res) => {
        if (res.statusCode !== 200) { resolve(null); return; }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  // ════════════════════════════════════════════════════════
  //  HTTP — Core GET with SOCKS5 proxy + retries
  // ════════════════════════════════════════════════════════

  /**
   * HTTPS GET a través de un proxy SOCKS5.
   * Reintenta con distintos proxies si falla.
   */
  private httpGet(
    url: string,
    agent: SocksProxyAgent,
    timeoutMs = 15000,
  ): Promise<{ html: string | null; status: number; size: number; error?: string }> {
    return new Promise((resolve) => {
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const req = https.request(
        url,
        {
          method: 'GET',
          agent,
          rejectUnauthorized: false,
          ciphers: CHROME_CIPHERS,
          ecdhCurve: 'X25519:prime256v1:secp384r1',
          minVersion: 'TLSv1.2' as any,
          headers: {
            'User-Agent': ua,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            Connection: 'keep-alive',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve({
              html: res.statusCode === 200 ? body : null,
              status: res.statusCode ?? 0,
              size: body.length,
            });
          });
        },
      );
      req.on('error', (err) =>
        resolve({ html: null, status: 0, size: 0, error: err.message }),
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ html: null, status: 0, size: 0, error: 'timeout' });
      });
      req.end();
    });
  }

  /**
   * GET directo sin proxy (IP residencial). Headers de navegador.
   */
  private directGet(
    url: string,
    timeoutMs = 15000,
  ): Promise<{ html: string | null; status: number; size: number; error?: string }> {
    return new Promise((resolve) => {
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const req = https.request(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': ua,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'identity',
            Connection: 'keep-alive',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve({
              html: res.statusCode === 200 ? body : null,
              status: res.statusCode ?? 0,
              size: body.length,
            });
          });
        },
      );
      req.on('error', (err) =>
        resolve({ html: null, status: 0, size: 0, error: err.message }),
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ html: null, status: 0, size: 0, error: 'timeout' });
      });
      req.end();
    });
  }

  /**
   * GET inteligente:
   * - Modo directo (DATOSPERU_DIRECT=true): directo primero → proxy fallback
   * - Modo cloud: proxy rotation → curl fallback
   */
  private async getWithProxyRotation(
    url: string,
    timeoutMs = 15000,
  ): Promise<string | null> {
    // ── Paso 1: Intento directo (si está habilitado) ──
    if (this.directMode) {
      this.logger.debug(`[DatosPeru] GET directo ${url.substring(0, 80)}...`);
      const result = await this.directGet(url, timeoutMs);
      if (result.html && result.html.length > 1000) {
        this.logger.log(
          `[DatosPeru] ✅ Directo OK (HTTP:${result.status}, ${result.size} bytes)`,
        );
        return result.html;
      }
      this.logger.warn(
        `[DatosPeru] Directo falló: HTTP:${result.status} SIZE:${result.size}${result.error ? ' ERR:' + result.error : ''} — probando proxies...`,
      );
    }

    // ── Paso 2: Proxy rotation ──
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      const proxyUrl = this.nextProxy();
      const agent = this.makeAgent(proxyUrl);

      this.logger.debug(
        `[DatosPeru] GET ${url.substring(0, 80)}... via ${proxyUrl} (intento ${attempt + 1})`,
      );

      const result = await this.httpGet(url, agent, timeoutMs);

      if (result.html && result.html.length > 1000) {
        this.markProxySuccess(proxyUrl);
        this.logger.log(
          `[DatosPeru] ✅ Proxy ${proxyUrl} OK (HTTP:${result.status}, ${result.size} bytes)`,
        );
        return result.html;
      }

      this.markProxyFailed(proxyUrl);
      this.logger.warn(
        `[DatosPeru] Proxy ${proxyUrl} falló: HTTP:${result.status} SIZE:${result.size}${result.error ? ' ERR:' + result.error : ''} — rotando...`,
      );
    }

    this.logger.error(
      `[DatosPeru] Todos los proxies Node.js fallaron, intentando curl...`,
    );

    // ── Paso 3: curl fallback (usa proxy si está disponible) ──
    const curlResult = await this.curlGet(url, timeoutMs);
    if (curlResult) return curlResult;

    // ── Paso 4: curl DIRECTO sin proxy (curl 8.x Alpine tiene TLS moderno) ──
    if (!this.directMode) {
      this.logger.warn(`[DatosPeru] curl con proxy falló, último intento: curl directo...`);
      return this.curlDirectGet(url, timeoutMs);
    }

    return null;
  }

  /**
   * Fallback: ejecutar curl desde shell (diferente TLS fingerprint que Node.js).
   */
  private curlGet(url: string, timeoutMs = 15000): Promise<string | null> {
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

      const args = [
        '-s', '-L', '-k',
        '--max-time', String(Math.floor(timeoutMs / 1000)),
        '-H', `User-Agent: ${ua}`,
        '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        '-H', 'Accept-Language: es-PE,es;q=0.9',
      ];

      // En modo proxy, añadir SOCKS5 proxy
      if (!this.directMode && this.proxies.length > 0) {
        const proxyUrl = this.proxies[this.proxyIdx % this.proxies.length]
          .replace('socks5h://', '');
        args.push('--socks5-hostname', proxyUrl);
      }

      args.push(url);

      this.logger.debug(
        `[DatosPeru] curl ${this.directMode ? 'directo' : 'via proxy'}: ${url.substring(0, 80)}...`,
      );

      execFile('curl', args, { maxBuffer: 1024 * 1024 }, (err: any, stdout: string) => {
        if (err || !stdout || stdout.length < 1000) {
          this.logger.warn(
            `[DatosPeru] curl fallback falló: ${err?.message || 'empty'} (${stdout?.length || 0} bytes)`,
          );
          resolve(null);
        } else {
          this.logger.log(`[DatosPeru] ✅ curl OK (${stdout.length} bytes)`);
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Último recurso: curl DIRECTO sin ningún proxy.
   * En Alpine con curl 8.x/OpenSSL 3.5, el TLS fingerprint
   * es moderno y puede pasar Cloudflare incluso desde datacenter.
   */
  private curlDirectGet(url: string, timeoutMs = 15000): Promise<string | null> {
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

      const args = [
        '-s', '-L', '-k',
        '--max-time', String(Math.floor(timeoutMs / 1000)),
        '-H', `User-Agent: ${ua}`,
        '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        '-H', 'Accept-Language: es-PE,es;q=0.9',
        url,
      ];

      this.logger.debug(
        `[DatosPeru] curl DIRECTO (sin proxy): ${url.substring(0, 80)}...`,
      );

      execFile('curl', args, { maxBuffer: 1024 * 1024 }, (err: any, stdout: string) => {
        if (err || !stdout || stdout.length < 1000) {
          this.logger.warn(
            `[DatosPeru] curl directo falló: ${err?.message || 'empty'} (${stdout?.length || 0} bytes)`,
          );
          resolve(null);
        } else {
          this.logger.log(`[DatosPeru] ✅ curl DIRECTO OK (${stdout.length} bytes)`);
          resolve(stdout);
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  HTTP — Búsqueda por RUC
  // ════════════════════════════════════════════════════════

  /**
   * GET /buscador_empresas.php?buscar={ruc}
   * Retorna el path relativo de la empresa o indica si no existe en DatosPeru.
   */
  private async searchByRuc(
    ruc: string,
  ): Promise<{ path: string | null; notFoundOnSite: boolean }> {
    const url = `${BASE_URL}${SEARCH_PATH}?buscar=${encodeURIComponent(ruc)}`;
    const html = await this.getWithProxyRotation(url);

    if (!html) {
      // No se pudo cargar la página de búsqueda → proxy/network issue
      return { path: null, notFoundOnSite: false };
    }

    // Extraer el primer link que empiece con empresa-...{ruc}.php
    const regex = new RegExp(`href="(empresa-[^"]*${ruc}\\.php)"`, 'i');
    const match = html.match(regex);
    if (match) return { path: match[1], notFoundOnSite: false };

    // Fallback: cualquier link de empresa
    const fallback = html.match(/href="(empresa-[^"]+\.php)"/i);
    if (fallback) return { path: fallback[1], notFoundOnSite: false };

    // Se cargó la página pero NO hay empresa → RUC no existe en DatosPeru
    return { path: null, notFoundOnSite: true };
  }

  // ════════════════════════════════════════════════════════
  //  HTTP — Fetch página completa
  // ════════════════════════════════════════════════════════

  private async fetchPage(url: string): Promise<string | null> {
    return this.getWithProxyRotation(url, 20000);
  }

  // ════════════════════════════════════════════════════════
  //  PARSER — Extrae datos estructurados del HTML
  // ════════════════════════════════════════════════════════

  private parseCompanyPage(
    html: string,
    ruc: string,
    sourceUrl: string,
  ): DatosPeruProfile {
    const $ = cheerio.load(html);
    const profile = new DatosPeruProfile(ruc, sourceUrl);

    // ── Datos básicos desde "DATOS EMPRESA" ──
    this.parseDatosEmpresa($, profile);

    // ── Descripción (bloque Top300 o similar) ──
    this.parseDescripcion($, profile);

    // ── Sector económico ──
    this.parseSectorEconomico($, profile);

    // ── Comercio exterior ──
    this.parseComercioExterior($, profile);

    // ── Ejecutivos / Directores ──
    this.parseEjecutivos($, profile);

    // ── Establecimientos anexos ──
    this.parseEstablecimientos($, profile);

    // ── Historial de trabajadores ──
    this.parseHistorialTrabajadores($, profile);

    // ── Info histórica (condiciones + direcciones) ──
    this.parseInfoHistorica($, profile);

    // ── Logo ──
    this.parseLogo($, profile);

    return profile;
  }

  // ── DATOS EMPRESA (sección lateral) ──
  private parseDatosEmpresa(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    // La sección "DATOS EMPRESA" tiene <ul class="list-unstyled"> con <li><strong>LABEL</strong><span>VALUE</span></li>
    const section = $('h2:contains("DATOS EMPRESA")').closest('div');
    if (!section.length) return;

    const items = section.find('li').toArray();
    for (const li of items) {
      const $li = $(li);
      const label = $li.find('strong').first().text().trim().toUpperCase();
      const value = $li.find('span').first().text().trim();

      if (!label || (!value && !label.includes('WEB') && !label.includes('PROVEEDOR'))) continue;

      switch (true) {
        case label === 'NOMBRE':
          profile.nombre = value || null;
          break;
        case label === 'RUC':
          // Ya lo tenemos, pero validamos
          break;
        case label === 'INICIO':
          profile.fechaInicio = value || null;
          break;
        case label.includes('INSCRIPCI'):
          profile.fechaInscripcion = value || null;
          break;
        case label === 'ESTADO':
          profile.estado = value || null;
          break;
        case label === 'TIPO':
          profile.tipo = value.replace(/\s+/g, ' ').trim() || null;
          break;
        case label === 'CIIU':
          profile.ciiu = value.trim() || null;
          break;
        case label.startsWith('DIRECCI') && !label.includes('DOMICILIO'):
          profile.direccion = this.cleanText(
            $li.find('span a').text() || value,
          );
          break;
        case label === 'REFERENCIA':
          profile.referencia = value || null;
          break;
        case label === 'DEPARTAMENTO':
          profile.departamento = value || null;
          break;
        case label === 'PROVINCIA':
          profile.provincia = value || null;
          break;
        case label === 'DISTRITO':
          profile.distrito = value || null;
          break;
        case label.startsWith('PA'):
          if (value && value.length <= 30) profile.pais = value;
          break;
        case label.startsWith('TEL'): {
          const phone = $li.find('a[href^="tel:"]').text().trim() || value;
          if (phone && phone !== '-') profile.telefonos.push(phone);
          break;
        }
        case label.includes('WEB'): {
          const webHref = $li.find('strong a[href]').attr('href');
          if (webHref && webHref.startsWith('http')) profile.web = webHref;
          break;
        }
        case label.includes('PROVEEDOR'):
          // El valor está en el siguiente <li> con color verde
          break;
      }
    }

    // Proveedor del estado — buscar "SI" en color verde después de "PROVEEDOR"
    const proveedorLi = section.find('strong:contains("PROVEEDOR")').closest('li');
    if (proveedorLi.length) {
      const nextLi = proveedorLi.next('li');
      const provText = nextLi.find('strong').text().trim().toUpperCase();
      profile.proveedorEstado = provText === 'SI';
    }
  }

  // ── Descripción (párrafo largo, normalmente del Top300) ──
  private parseDescripcion(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const descP = $('p.post').first();
    if (descP.length) {
      const text = descP.text().trim();
      if (text.length > 50) {
        profile.descripcion = text;
      }
    }
  }

  // ── Sector económico ──
  private parseSectorEconomico(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const h4 = $('h4:contains("SECTOR ECONÓMICO")');
    if (h4.length) {
      const nextA = h4.next('a, p, span, div').find('a').first();
      if (nextA.length) {
        profile.sectorEconomico = nextA.text().trim() || null;
      } else {
        // Buscar el texto después del h4
        const parent = h4.parent();
        const links = parent.find('a');
        if (links.length) {
          profile.sectorEconomico = links.first().text().trim() || null;
        }
      }
    }
  }

  // ── Comercio exterior ──
  private parseComercioExterior(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const h4 = $('h4:contains("COMERCIO EXTERIOR")');
    if (h4.length) {
      const parent = h4.parent();
      const text = parent.text().replace(/MARCA DE ACTIVIDAD DE COMERCIO EXTERIOR/gi, '').trim();
      if (text) {
        profile.marcaComercioExterior = text.split('\n')[0]?.trim() || null;
      }
    }
  }

  // ── Ejecutivos / Directores ──
  private parseEjecutivos(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const h4 = $('h4:contains("EJECUTIVOS")');
    if (!h4.length) return;

    const container = h4.parent();
    const items = container.find('.col-sm-12 a').toArray();

    for (const a of items) {
      const text = $(a).text().trim();
      if (!text) continue;

      const exec = this.parseExecutiveText(text);
      if (exec) {
        profile.ejecutivos.push(exec);
      }
    }
  }

  private parseExecutiveText(text: string): DatosPeruExecutive | null {
    // Formato: "APODERADO MARQUEZ PIZARRO HAYDEE (DESDE: 23/01/2025)"
    const cleaned = text.replace(/[→\s]+/g, ' ').trim();
    const desdeMatch = cleaned.match(/\(DESDE:\s*([^)]+)\)/i);

    let cargo = '';
    let nombre = '';
    const desde = desdeMatch ? desdeMatch[1].trim() : null;

    // Remover "(DESDE: ...)"
    const withoutDesde = cleaned.replace(/\(DESDE:[^)]*\)/i, '').trim();

    // Las primeras palabras en mayúsculas son el cargo
    const cargos = [
      'APODERADO', 'GERENTE GENERAL', 'GERENTE', 'DIRECTOR', 'PRESIDENTE',
      'LIQUIDADOR', 'TITULAR', 'REPRESENTANTE LEGAL', 'REPRESENTANTE',
      'SUB GERENTE', 'VICE PRESIDENTE', 'SECRETARIO', 'TESORERO',
    ];

    for (const c of cargos) {
      if (withoutDesde.toUpperCase().startsWith(c)) {
        cargo = c;
        nombre = withoutDesde.substring(c.length).trim();
        break;
      }
    }

    if (!cargo) {
      // Sin cargo reconocido, tomar primera palabra
      const parts = withoutDesde.split(/\s+/);
      cargo = parts[0] || '';
      nombre = parts.slice(1).join(' ');
    }

    if (!nombre) return null;

    return { cargo, nombre, desde };
  }

  // ── Establecimientos anexos ──
  private parseEstablecimientos(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const container = $('#grid_anexos');
    if (!container.length) return;

    const items = container.find('.col-sm-12 a').toArray();

    for (const a of items) {
      const text = $(a).text().replace(/[→\s]+/g, ' ').trim();
      if (!text || text.length < 5) continue;

      const branch = this.parseBranchText(text);
      if (branch) {
        profile.establecimientosAnexos.push(branch);
      }
    }
  }

  private parseBranchText(text: string): DatosPeruBranch | null {
    // Formato: "JR. AYACUCHO NRO. 1040 CHACHAPOYAS / AMAZONAS - CHACHAPOYAS - CHACHAPOYAS"
    const parts = text.split('/');
    const direccion = parts[0]?.trim();
    const ubicacion = parts.length > 1 ? parts.slice(1).join('/').trim() : null;

    if (!direccion) return null;

    return {
      direccion,
      ubicacion: ubicacion && ubicacion !== '-  -' ? ubicacion : null,
    };
  }

  // ── Historial de trabajadores ──
  private parseHistorialTrabajadores(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const h4 = $('h4:contains("CANTIDAD DE TRABAJADORES")');
    if (!h4.length) return;

    const table = h4.next('table').length
      ? h4.next('table')
      : h4.closest('div').find('table').first();
    if (!table.length) return;

    const rows = table.find('tbody tr').toArray();
    for (const row of rows) {
      const cells = $(row).find('td').toArray().map((td) => $(td).text().trim());
      if (cells.length >= 4) {
        const nroTrab = parseInt(cells[1].replace(/\s/g, ''), 10) || 0;
        const nroPens = parseInt(cells[2].replace(/\s/g, ''), 10) || 0;
        const nroPrest = parseInt(cells[3].replace(/\s/g, ''), 10) || 0;

        profile.historialTrabajadores.push({
          periodo: cells[0],
          nroTrabajadores: nroTrab,
          nroPensionistas: nroPens,
          nroPrestadores: nroPrest,
        });
      }
    }
  }

  // ── Info histórica ──
  private parseInfoHistorica(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    const h2 = $('h2:contains("INFORMACIÓN HISTORICA"), h2:contains("INFORMACION HISTORICA")');
    if (!h2.length) return;

    const container = h2.parent();
    const tables = container.find('table').toArray();

    for (const table of tables) {
      const headers = $(table)
        .find('thead th')
        .toArray()
        .map((th) => $(th).text().trim().toUpperCase());

      const rows = $(table).find('tbody tr').toArray();

      if (headers.some((h) => h.includes('CONDICI'))) {
        // Tabla de condiciones
        for (const row of rows) {
          const cells = $(row).find('td').toArray().map((td) => $(td).text().trim());
          if (cells.length >= 3) {
            profile.historialCondiciones.push({
              condicion: cells[0],
              desde: cells[1] !== '-' ? cells[1] : null,
              hasta: cells[2] !== '-' ? cells[2] : null,
            });
          }
        }
      } else if (headers.some((h) => h.includes('DIRECCI') || h.includes('DOMICILIO'))) {
        // Tabla de direcciones históricas
        for (const row of rows) {
          const cells = $(row).find('td').toArray().map((td) => $(td).text().trim());
          if (cells.length >= 2) {
            profile.historialDirecciones.push({
              direccion: cells[0].replace(/\s+/g, ' ').trim(),
              fechaBaja: cells[1] !== '-' ? cells[1] : null,
            });
          }
        }
      }
    }
  }

  // ── Logo ──
  private parseLogo(
    $: cheerio.CheerioAPI,
    profile: DatosPeruProfile,
  ): void {
    // Logo del Top300 o similar
    const img = $('img[src*="top300"]').first();
    if (img.length) {
      const src = img.attr('src');
      if (src) {
        profile.logoUrl = src.startsWith('http')
          ? src
          : `${BASE_URL}/${src.replace(/^\//, '')}`;
      }
    }
  }

  // ── Helpers ──
  private cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim() || '';
  }
}
