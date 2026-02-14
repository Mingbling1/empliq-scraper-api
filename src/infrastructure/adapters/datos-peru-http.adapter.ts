import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as cheerio from 'cheerio';
import {
  DatosPeruEnrichmentPort,
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

@Injectable()
export class DatosPeruHttpAdapter implements DatosPeruEnrichmentPort {
  private readonly logger = new Logger(DatosPeruHttpAdapter.name);

  // ════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════

  async enrich(ruc: string): Promise<DatosPeruProfile | null> {
    const start = Date.now();
    this.logger.log(`[DatosPeru] Enriqueciendo RUC ${ruc}`);

    try {
      // Paso 1: Buscar URL de la empresa por RUC
      const companyPath = await this.searchByRuc(ruc);
      if (!companyPath) {
        this.logger.warn(`[DatosPeru] No se encontró empresa para RUC ${ruc}`);
        return null;
      }

      const companyUrl = `${BASE_URL}/${companyPath}`;
      this.logger.log(`[DatosPeru] URL encontrada: ${companyUrl}`);

      // Paso 2: Descargar página de la empresa
      const html = await this.fetchPage(companyUrl);
      if (!html) {
        this.logger.warn(`[DatosPeru] No se pudo descargar ${companyUrl}`);
        return null;
      }

      // Paso 3: Parsear HTML y extraer datos
      const profile = this.parseCompanyPage(html, ruc, companyUrl);
      profile.durationMs = Date.now() - start;
      profile.scrapedAt = new Date();

      this.logger.log(
        `[DatosPeru] ✅ ${profile.summary} (${profile.durationMs}ms)`,
      );

      return profile;
    } catch (err) {
      this.logger.error(
        `[DatosPeru] Error enriqueciendo RUC ${ruc}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ════════════════════════════════════════════════════════
  //  HTTP — Búsqueda por RUC
  // ════════════════════════════════════════════════════════

  /**
   * GET /buscador_empresas.php?buscar={ruc}
   * Retorna el path relativo de la empresa (ej: "empresa-banco-de-credito-del-peru-20100047218.php")
   */
  private searchByRuc(ruc: string): Promise<string | null> {
    return new Promise((resolve) => {
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const url = `${BASE_URL}${SEARCH_PATH}?buscar=${encodeURIComponent(ruc)}`;

      const req = https.request(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': ua,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-PE,es;q=0.9',
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            this.logger.warn(`[DatosPeru] Search HTTP ${res.statusCode}`);
            resolve(null);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf-8');
            // Extraer el primer link que empiece con empresa-...{ruc}.php
            const regex = new RegExp(
              `href="(empresa-[^"]*${ruc}\\.php)"`,
              'i',
            );
            const match = html.match(regex);
            if (match) {
              resolve(match[1]);
            } else {
              // Fallback: cualquier link de empresa
              const fallback = html.match(/href="(empresa-[^"]+\.php)"/i);
              resolve(fallback ? fallback[1] : null);
            }
          });
        },
      );

      req.on('error', (err) => {
        this.logger.error(`[DatosPeru] Search error: ${err.message}`);
        resolve(null);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  // ════════════════════════════════════════════════════════
  //  HTTP — Fetch página completa
  // ════════════════════════════════════════════════════════

  private fetchPage(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

      const req = https.request(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': ua,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
            Referer: `${BASE_URL}/`,
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            this.logger.warn(`[DatosPeru] Fetch HTTP ${res.statusCode}`);
            resolve(null);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'));
          });
        },
      );

      req.on('error', (err) => {
        this.logger.error(`[DatosPeru] Fetch error: ${err.message}`);
        resolve(null);
      });

      req.setTimeout(20000, () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
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
