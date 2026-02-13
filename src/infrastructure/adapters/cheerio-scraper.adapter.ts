import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';
import * as cheerio from 'cheerio';
import {
  WebsiteScraperPort,
  ScrapeOptions,
} from '../../domain/ports/website-scraper.port';
import { CompanyProfile } from '../../domain/entities/company-profile.entity';

/**
 * Adaptador de scraping HTTP puro con Cheerio.
 *
 * 1. Fetch del HTML de la página principal
 * 2. Extrae datos estructurados (meta tags, JSON-LD, texto)
 * 3. Detecta links a /nosotros, /about, /contacto
 * 4. Visita sub-páginas para extraer historia, misión, visión, contacto
 * 5. Todo HTTP puro — sin browser — liviano y rápido
 */
@Injectable()
export class CheerioScraperAdapter implements WebsiteScraperPort {
  private readonly logger = new Logger(CheerioScraperAdapter.name);
  private readonly userAgents: string[];

  /** Patrones de sub-páginas que nos interesan */
  private readonly SUBPAGE_PATTERNS: Array<{
    pattern: RegExp;
    type: 'about' | 'contact' | 'history';
  }> = [
    { pattern: /\/(nosotros|about-us|about|quienes-somos|acerca-de|sobre-nosotros|quien-somos|conocenos)(\/|$|\?|#)/i, type: 'about' },
    { pattern: /\/(contacto|contactanos|contact|contact-us)(\/|$|\?|#)/i, type: 'contact' },
    { pattern: /\/(historia|history|nuestra-historia|our-history|trayectoria)(\/|$|\?|#)/i, type: 'history' },
  ];

  /** Selectores CSS para secciones de misión/visión/valores */
  private readonly CONTENT_SELECTORS = {
    mission: ['[class*="mision"]', '[class*="mission"]', '[id*="mision"]', '[id*="mission"]'],
    vision: ['[class*="vision"]', '[id*="vision"]'],
    values: ['[class*="valores"]', '[class*="values"]', '[id*="valores"]', '[id*="values"]'],
    history: ['[class*="histori"]', '[class*="history"]', '[id*="histori"]', '[id*="history"]', '[class*="trayectori"]'],
    about: ['[class*="nosotros"]', '[class*="about"]', '[id*="nosotros"]', '[id*="about"]'],
  };

  constructor(private config: ConfigService) {
    this.userAgents = this.config.get<string[]>('scraper.userAgents', [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ]);
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<CompanyProfile> {
    const startTime = Date.now();
    const opts: Required<ScrapeOptions> = {
      followSubpages: options?.followSubpages ?? true,
      timeoutMs: options?.timeoutMs ?? 30000,
      maxSubpages: options?.maxSubpages ?? 3,
    };

    const profile = new CompanyProfile(url);

    this.logger.log(`🕷️  Scraping: ${url}`);

    try {
      // ── 1. Página principal ──────────────────────────
      const mainHtml = await this.fetchPage(url, opts.timeoutMs);
      if (!mainHtml) {
        this.logger.warn(`No se pudo obtener HTML de ${url}`);
        profile.durationMs = Date.now() - startTime;
        return profile;
      }

      profile.pagesScraped.push(url);
      const $ = cheerio.load(mainHtml);

      // Extraer todo lo que podamos de la página principal
      this.extractMetaTags($, profile);
      this.extractJsonLd($, profile);
      this.extractLogo($, url, profile);
      this.extractContactInfo(mainHtml, profile);
      this.extractSocialLinks($, url, profile);
      this.extractContentSections($, profile);
      this.extractFromText($, profile);

      // ── 2. Sub-páginas (/nosotros, /contacto, etc.) ──
      if (opts.followSubpages) {
        const subpageLinks = this.findSubpageLinks($, url);
        const visited = new Set<string>([url]);
        let subpagesVisited = 0;

        for (const link of subpageLinks) {
          if (subpagesVisited >= opts.maxSubpages) break;
          if (visited.has(link.url)) continue;
          visited.add(link.url);

          this.logger.log(`   📄 Sub-página [${link.type}]: ${link.url}`);

          try {
            await this.sleep(800); // Ser amable con el servidor
            const subHtml = await this.fetchPage(link.url, 15000);
            if (!subHtml) continue;

            profile.pagesScraped.push(link.url);
            subpagesVisited++;

            const $sub = cheerio.load(subHtml);

            // Extraer según el tipo de página
            if (link.type === 'about' || link.type === 'history') {
              this.extractAboutPage($sub, profile);
            }
            if (link.type === 'contact') {
              this.extractContactInfo(subHtml, profile);
              this.extractContactPage($sub, profile);
            }

            // Siempre buscar contenido estructurado
            this.extractJsonLd($sub, profile);
            this.extractContentSections($sub, profile);
          } catch (err) {
            this.logger.warn(`   ⚠️  Error en sub-página ${link.url}: ${(err as Error).message}`);
          }
        }
      }

      profile.durationMs = Date.now() - startTime;
      this.logger.log(`✅ Scraping completado: ${profile.summary} (${profile.durationMs}ms)`);

      return profile;
    } catch (error) {
      profile.durationMs = Date.now() - startTime;
      this.logger.error(`❌ Error scraping ${url}: ${(error as Error).message}`);
      return profile;
    }
  }

  // ════════════════════════════════════════════════════════
  // EXTRACTORES
  // ════════════════════════════════════════════════════════

  /**
   * Extrae datos de <meta> tags (og:, description, etc.)
   */
  private extractMetaTags($: cheerio.CheerioAPI, profile: CompanyProfile): void {
    // Nombre
    if (!profile.name) {
      profile.name =
        $('meta[property="og:site_name"]').attr('content')?.trim() ||
        $('meta[name="application-name"]').attr('content')?.trim() ||
        $('title').first().text()?.trim()?.split(/[|\-–—]/)[0]?.trim() ||
        null;
    }

    // Descripción
    if (!profile.description) {
      const desc =
        $('meta[property="og:description"]').attr('content')?.trim() ||
        $('meta[name="description"]').attr('content')?.trim() ||
        null;
      // Filtrar descripciones que son en realidad URLs de imágenes
      if (desc && !desc.match(/^https?:\/\/.*\.(png|jpg|jpeg|svg|gif|webp)/i)) {
        profile.description = desc;
      }
    }

    // Industria desde keywords
    if (!profile.industry) {
      const keywords = $('meta[name="keywords"]').attr('content');
      if (keywords) {
        profile.extras['keywords'] = keywords.trim();
      }
    }
  }

  /**
   * Extrae el logo de la empresa desde múltiples fuentes:
   * 1. JSON-LD schema.org (logo property)
   * 2. Open Graph image (og:image)
   * 3. <link rel="icon"> / apple-touch-icon
   * 4. <img> con "logo" en src, class, id o alt
   * 5. <svg> con "logo" en class/id
   *
   * Prioriza SVG > PNG > JPG. Solo URLs absolutas.
   */
  private extractLogo($: cheerio.CheerioAPI, baseUrl: string, profile: CompanyProfile): void {
    if (profile.logoUrl) return;

    const candidates: Array<{ url: string; priority: number }> = [];

    const toAbsolute = (href: string): string | null => {
      if (!href) return null;
      try {
        return new URL(href, baseUrl).href;
      } catch {
        return null;
      }
    };

    const isImageUrl = (url: string): boolean =>
      /\.(svg|png|jpg|jpeg|webp|gif|ico)(\?.*)?$/i.test(url) ||
      url.includes('/logo') ||
      url.includes('logo.') ||
      url.includes('brand');

    // 1. JSON-LD logo
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '');
        const items = Array.isArray(data) ? data : data['@graph'] ? [...[data], ...data['@graph']] : [data];
        for (const item of items) {
          if (item.logo) {
            const logoVal = typeof item.logo === 'string' ? item.logo : item.logo?.url || item.logo?.['@id'];
            const abs = toAbsolute(logoVal);
            if (abs) candidates.push({ url: abs, priority: 100 });
          }
          if (item.image) {
            const imgVal = typeof item.image === 'string' ? item.image : item.image?.url;
            const abs = toAbsolute(imgVal);
            if (abs && isImageUrl(abs)) candidates.push({ url: abs, priority: 60 });
          }
        }
      } catch { /* invalid JSON-LD */ }
    });

    // 2. og:image (muchas veces es el logo)
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage) {
      const abs = toAbsolute(ogImage);
      if (abs) candidates.push({ url: abs, priority: 50 });
    }

    // 3. Apple touch icon (suele ser un logo cuadrado de alta resolución)
    $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = href ? toAbsolute(href) : null;
      if (abs) candidates.push({ url: abs, priority: 70 });
    });

    // 4. Favicon SVG (a veces es el logo en vector)
    $('link[rel="icon"][type="image/svg+xml"], link[rel="shortcut icon"]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = href ? toAbsolute(href) : null;
      if (abs) {
        const isSvg = abs.endsWith('.svg') || $(el).attr('type') === 'image/svg+xml';
        candidates.push({ url: abs, priority: isSvg ? 75 : 30 });
      }
    });

    // 5. <img> con "logo" en atributos
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      const alt = ($(el).attr('alt') || '').toLowerCase();
      const cls = ($(el).attr('class') || '').toLowerCase();
      const id = ($(el).attr('id') || '').toLowerCase();
      const srcLower = (src || '').toLowerCase();

      const hasLogoSignal = alt.includes('logo') || cls.includes('logo') || id.includes('logo') ||
        srcLower.includes('logo') || srcLower.includes('brand') ||
        alt.includes('marca') || cls.includes('brand');

      if (hasLogoSignal && src) {
        const abs = toAbsolute(src);
        if (abs) {
          let priority = 80;
          // SVG > PNG > JPG
          if (abs.includes('.svg')) priority += 10;
          else if (abs.includes('.png')) priority += 5;
          // Penalizar imágenes muy pequeñas (pixel trackers)
          const width = parseInt($(el).attr('width') || '0');
          const height = parseInt($(el).attr('height') || '0');
          if ((width > 0 && width < 20) || (height > 0 && height < 20)) priority -= 50;
          candidates.push({ url: abs, priority });
        }
      }
    });

    // 6. <svg> con "logo" en class/id (logo inline)
    // No podemos extraer SVG inline como URL, pero intentar con su parent <a>
    $('svg').each((_, el) => {
      const cls = ($(el).attr('class') || '').toLowerCase();
      const id = ($(el).attr('id') || '').toLowerCase();
      const parentCls = ($(el).parent().attr('class') || '').toLowerCase();

      if (cls.includes('logo') || id.includes('logo') || parentCls.includes('logo')) {
        // Buscar si hay un <img> sibling o si el parent <a> tiene una imagen
        const parentLink = $(el).closest('a');
        const siblingImg = parentLink.find('img').first();
        const imgSrc = siblingImg.attr('src');
        if (imgSrc) {
          const abs = toAbsolute(imgSrc);
          if (abs) candidates.push({ url: abs, priority: 85 });
        }
      }
    });

    // Elegir el mejor candidato
    if (candidates.length > 0) {
      // Preferir SVG, luego por priority
      candidates.sort((a, b) => {
        const aIsSvg = a.url.includes('.svg') ? 1 : 0;
        const bIsSvg = b.url.includes('.svg') ? 1 : 0;
        if (aIsSvg !== bIsSvg) return bIsSvg - aIsSvg;
        return b.priority - a.priority;
      });
      profile.logoUrl = candidates[0].url;
      this.logger.debug(`   🖼️ Logo encontrado: ${profile.logoUrl}`);
    }
  }

  /**
   * Extrae datos de JSON-LD (schema.org) — la fuente más rica.
   */
  private extractJsonLd($: cheerio.CheerioAPI, profile: CompanyProfile): void {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html();
        if (!raw) return;

        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          this.processJsonLdItem(item, profile);

          // Manejar @graph
          if (item['@graph'] && Array.isArray(item['@graph'])) {
            for (const subItem of item['@graph']) {
              this.processJsonLdItem(subItem, profile);
            }
          }
        }
      } catch {
        // JSON-LD inválido, ignorar
      }
    });
  }

  private processJsonLdItem(item: any, profile: CompanyProfile): void {
    const type = item['@type'];
    if (!type) return;

    const orgTypes = ['Organization', 'Corporation', 'LocalBusiness', 'FinancialService',
      'BankOrCreditUnion', 'Company', 'GovernmentOrganization'];

    const isOrg = Array.isArray(type)
      ? type.some((t: string) => orgTypes.includes(t))
      : orgTypes.includes(type);

    if (isOrg) {
      if (!profile.name && item.name) profile.name = item.name;
      if (!profile.description && item.description) profile.description = item.description;
      if (!profile.headquarters && item.address) {
        const addr = typeof item.address === 'string'
          ? item.address
          : [item.address.streetAddress, item.address.addressLocality,
            item.address.addressRegion, item.address.addressCountry]
            .filter(Boolean).join(', ');
        profile.headquarters = addr;
      }

      if (item.telephone && !profile.phones.includes(item.telephone)) {
        profile.phones.push(item.telephone);
      }
      if (item.email && !profile.emails.includes(item.email)) {
        profile.emails.push(item.email);
      }
      if (item.taxID || item.vatID) {
        const taxId = item.taxID || item.vatID;
        if (/^\d{11}$/.test(taxId)) profile.ruc = taxId;
      }
      if (item.foundingDate) {
        profile.foundedDate = item.foundingDate;
        const year = parseInt(item.foundingDate);
        if (year > 1800 && year < 2100) profile.foundedYear = year;
      }
      if (item.numberOfEmployees) {
        const emp = item.numberOfEmployees;
        profile.employeeCount = emp.value || emp.minValue
          ? `${emp.minValue || ''}-${emp.maxValue || ''}`.replace(/^-|-$/g, '')
          : String(emp);
      }
      if (item.industry) profile.industry = item.industry;

      // Social links from JSON-LD
      if (item.sameAs) {
        const links = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
        for (const link of links) {
          this.categoriseSocialLink(link, profile);
        }
      }
    }
  }

  /**
   * Extrae teléfonos, emails y RUC del texto HTML crudo con regex.
   */
  private extractContactInfo(html: string, profile: CompanyProfile): void {
    // RUC peruano (11 dígitos empezando con 10 o 20)
    const rucMatches = html.match(/\b(10|20)\d{9}\b/g);
    if (rucMatches && !profile.ruc) {
      // Preferir los que empiezan con 20 (persona jurídica)
      const ruc20 = rucMatches.find((r) => r.startsWith('20'));
      profile.ruc = ruc20 || rucMatches[0];
    }

    // Teléfonos: buscar solo patrones explícitos con código de país o formato claro
    const phonePatterns = [
      /\+51\s?\(?\d{1,2}\)?\s?\d{3}\s?\d{3,4}/g,                     // +51 con fijo/móvil
      /\(01\)\s?\d{3}[\s-]?\d{4}/g,                                   // (01) 315-0800
      /\b9\d{2}\s?\d{3}\s?\d{3}\b/g,                                  // Móvil 9XX XXX XXX
      /\b(?:01|04[1-4]|05[1-4]|06[1-7]|07[1-6]|08[1-4])\s?\d{3}\s?\d{4}\b/g, // Fijo con código de área
    ];

    for (const pattern of phonePatterns) {
      const matches = html.match(pattern);
      if (matches) {
        for (const match of matches) {
          const clean = match.replace(/[\s.()\-]/g, '').replace(/^\+?51/, '');
          // Solo teléfonos razonables (7-9 dígitos sin código país)
          if (clean.length >= 7 && clean.length <= 9) {
            // Filtrar fechas disfrazadas de teléfonos (DDMMYYYY, YYYYMMDD)
            if (/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$/.test(clean)) continue;
            if (/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(clean)) continue;

            // No agregar duplicados
            const isDuplicate = profile.phones.some(
              (p) => p.replace(/[\s.()\-]/g, '').replace(/^\+?51/, '') === clean,
            );
            if (!isDuplicate) {
              profile.phones.push(match.trim());
            }
          }
        }
      }
    }

    // Emails
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailMatches = html.match(emailPattern);
    if (emailMatches) {
      for (const email of emailMatches) {
        const lower = email.toLowerCase();
        // Filtrar emails que no son de contacto real
        if (
          !lower.endsWith('.png') &&
          !lower.endsWith('.jpg') &&
          !lower.includes('example.com') &&
          !lower.includes('sentry.io') &&
          !lower.includes('wixpress.com') &&
          !lower.includes('@2x') &&
          !profile.emails.includes(lower)
        ) {
          profile.emails.push(lower);
        }
      }
    }
  }

  /**
   * Extrae links de redes sociales.
   */
  private extractSocialLinks($: cheerio.CheerioAPI, baseUrl: string, profile: CompanyProfile): void {
    const socialDomains: Record<string, string> = {
      'facebook.com': 'facebook',
      'fb.com': 'facebook',
      'twitter.com': 'twitter',
      'x.com': 'twitter',
      'instagram.com': 'instagram',
      'linkedin.com': 'linkedin',
      'youtube.com': 'youtube',
      'tiktok.com': 'tiktok',
      'wa.me': 'whatsapp',
      'api.whatsapp.com': 'whatsapp',
    };

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        const url = new URL(href, baseUrl);
        const host = url.hostname.toLowerCase().replace('www.', '');

        for (const [domain, name] of Object.entries(socialDomains)) {
          if (host.includes(domain) && !profile.socialLinks[name]) {
            profile.socialLinks[name] = url.href;
          }
        }
      } catch {
        // URL inválida
      }
    });
  }

  /**
   * Busca secciones por selectores CSS (misión, visión, valores, historia).
   */
  private extractContentSections($: cheerio.CheerioAPI, profile: CompanyProfile): void {
    for (const [field, selectors] of Object.entries(this.CONTENT_SELECTORS)) {
      for (const selector of selectors) {
        const el = $(selector).first();
        if (!el.length) continue;

        const text = this.cleanText(el.text());
        if (text.length < 15) continue; // Muy corto, probablemente un label

        switch (field) {
          case 'mission':
            if (!profile.mission) profile.mission = text;
            break;
          case 'vision':
            if (!profile.vision) profile.vision = text;
            break;
          case 'values':
            if (profile.values.length === 0) {
              // Intentar separar valores en lista
              const items = el.find('li, p, h3, h4');
              if (items.length > 1) {
                items.each((_, item) => {
                  const v = this.cleanText($(item).text());
                  if (v.length > 3 && v.length < 200) profile.values.push(v);
                });
              } else {
                profile.values.push(text);
              }
            }
            break;
          case 'history':
            if (!profile.history || text.length > profile.history.length) {
              profile.history = text;
            }
            break;
          case 'about':
            if (!profile.description || text.length > profile.description.length) {
              profile.description = text;
            }
            break;
        }
      }
    }
  }

  /**
   * Busca datos en el texto visible de la página usando patterns.
   */
  private extractFromText($: cheerio.CheerioAPI, profile: CompanyProfile): void {
    // Obtener texto de secciones principales (evitar footer/nav/script)
    const bodyText = $('main, article, [role="main"], .content, .main, #content, #main')
      .first()
      .text();
    const fullText = bodyText || $('body').text();

    if (!fullText) return;

    // Año de fundación
    if (!profile.foundedYear) {
      const foundedPatterns = [
        /fundad[ao]?\s+(?:en\s+)?(?:el\s+)?(?:\d{1,2}\s+de\s+\w+\s+de\s+)?(\d{4})/i,
        /desde\s+(\d{4})/i,
        /established\s+(?:in\s+)?(\d{4})/i,
        /founded\s+(?:in\s+)?(\d{4})/i,
        /creado\s+en\s+(\d{4})/i,
        /(?:año|año de fundación|founded|established)[:\s]+(\d{4})/i,
      ];

      for (const pattern of foundedPatterns) {
        const match = fullText.match(pattern);
        if (match) {
          const year = parseInt(match[1]);
          if (year > 1800 && year < 2100) {
            profile.foundedYear = year;
            break;
          }
        }
      }
    }

    // Fecha completa de fundación
    if (!profile.foundedDate) {
      const datePatterns = [
        /fundad[ao]?\s+(?:en\s+)?(?:el\s+)?(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
        /(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})\s+.*?fund/i,
      ];
      for (const pattern of datePatterns) {
        const match = fullText.match(pattern);
        if (match) {
          profile.foundedDate = match[1].trim();
          break;
        }
      }
    }

    // Número de empleados
    if (!profile.employeeCount) {
      const empPatterns = [
        /(?:más de\s+)?(\d[\d,.]*)\s*(?:colaboradores|empleados|trabajadores|employees)/i,
        /(\d[\d,.]*)\+?\s*(?:colaboradores|empleados|trabajadores)/i,
      ];
      for (const pattern of empPatterns) {
        const match = fullText.match(pattern);
        if (match) {
          profile.employeeCount = match[0].trim();
          break;
        }
      }
    }

    // Cobertura / red de distribución
    if (!profile.coverage) {
      const covPatterns = [
        /(\d+\+?\s*(?:agencias|tiendas|sucursales|oficinas|sedes|locales|puntos?\s+de\s+atención)[\s\S]{0,80}(?:\d+\+?\s*(?:cajeros|atm|cajeros\s+automáticos))?)/i,
        /(?:presencia|cobertura|red)\s+(?:en\s+)?(?:más de\s+)?(\d+\s*(?:ciudades|departamentos|provincias|regiones|países))/i,
      ];
      for (const pattern of covPatterns) {
        const match = fullText.match(pattern);
        if (match) {
          profile.coverage = this.cleanText(match[0]);
          break;
        }
      }
    }
  }

  /**
   * Extracción especial para páginas "Nosotros" / "About".
   */
  private extractAboutPage($: cheerio.CheerioAPI, profile: CompanyProfile): void {
    // Intentar obtener el contenido principal de la página
    const mainContent = $('main, article, [role="main"], .content, .main, #content, #main, .about, .nosotros')
      .first();

    const container = mainContent.length ? mainContent : $('body');

    // Historia: buscar párrafos largos que parezcan narrativa histórica
    const paragraphs: string[] = [];
    container.find('p').each((_, el) => {
      const text = this.cleanText($(el).text());
      if (text.length > 60) {
        paragraphs.push(text);
      }
    });

    if (paragraphs.length > 0 && !profile.history) {
      // Unir los párrafos que parecen narrativa histórica
      const historyKeywords = /fundad|creado|nació|inicio|comenzó|historia|surgió|estableció|1[89]\d{2}|20[012]\d/i;
      const historyParagraphs = paragraphs.filter((p) => historyKeywords.test(p));

      if (historyParagraphs.length > 0) {
        profile.history = historyParagraphs.join('\n\n');
      } else if (paragraphs.length >= 2) {
        // Si no hay keywords de historia, usar los primeros párrafos como descripción
        if (!profile.description || paragraphs.join(' ').length > profile.description.length) {
          profile.description = paragraphs.slice(0, 3).join('\n\n');
        }
      }
    }

    // Buscar secciones por headings
    container.find('h1, h2, h3, h4').each((_, heading) => {
      const title = this.cleanText($(heading).text()).toLowerCase();
      const nextContent = this.getNextSiblingContent($, $(heading));

      if (nextContent.length < 20) return;

      if (/misi[oó]n/.test(title) && !profile.mission) {
        profile.mission = nextContent;
      } else if (/visi[oó]n/.test(title) && !profile.vision) {
        profile.vision = nextContent;
      } else if (/valores/.test(title) && profile.values.length === 0) {
        const next = $(heading).next();
        const items = next.find('li');
        if (items.length > 0) {
          items.each((_, li) => {
            const v = this.cleanText($(li).text());
            if (v.length > 3) profile.values.push(v);
          });
        } else {
          profile.values.push(nextContent);
        }
      } else if (/histori|trayectori|quién|acerca/i.test(title) && !profile.history) {
        profile.history = nextContent;
      }
    });

    // Buscar misión/visión/valores con CSS selectors también
    this.extractContentSections($, profile);
  }

  /**
   * Extracción especial para páginas de contacto.
   */
  private extractContactPage($: cheerio.CheerioAPI, profile: CompanyProfile): void {
    // Dirección: buscar elementos con "dirección" o "address"
    const addressSelectors = ['[class*="direcc"]', '[class*="address"]', '[id*="direcc"]', 'address'];
    for (const sel of addressSelectors) {
      const el = $(sel).first();
      if (el.length && !profile.headquarters) {
        const text = this.cleanText(el.text());
        if (text.length > 10 && text.length < 300) {
          profile.headquarters = text;
        }
      }
    }

    // Buscar dirección en párrafos que contienen "Av." o "Calle" o "Jr."
    if (!profile.headquarters) {
      $('p, span, div').each((_, el) => {
        const text = this.cleanText($(el).text());
        if (
          text.length > 15 && text.length < 200 &&
          /\b(Av\.|Avenida|Calle|Jr\.|Jirón|Pje\.|Pasaje|Mz\.|Urb\.|Km\.)\b/i.test(text)
        ) {
          profile.headquarters = text;
          return false; // Break
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════

  /**
   * Detecta links internos a sub-páginas relevantes.
   */
  private findSubpageLinks(
    $: cheerio.CheerioAPI,
    baseUrl: string,
  ): Array<{ url: string; type: 'about' | 'contact' | 'history' }> {
    const links: Array<{ url: string; type: 'about' | 'contact' | 'history' }> = [];
    const seen = new Set<string>();

    try {
      const baseHost = new URL(baseUrl).hostname;

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        try {
          const resolved = new URL(href, baseUrl);

          // Solo links del mismo dominio
          if (resolved.hostname !== baseHost) return;

          const fullUrl = resolved.origin + resolved.pathname;
          if (seen.has(fullUrl)) return;

          for (const { pattern, type } of this.SUBPAGE_PATTERNS) {
            if (pattern.test(resolved.pathname)) {
              seen.add(fullUrl);
              links.push({ url: fullUrl, type });
              break;
            }
          }
        } catch {
          // URL inválida
        }
      });

      // Si no encontramos /nosotros, probar URLs comunes
      const aboutTypes = links.filter((l) => l.type === 'about');
      if (aboutTypes.length === 0) {
        const commonAbout = ['/nosotros', '/about', '/quienes-somos', '/about-us', '/acerca'];
        for (const path of commonAbout) {
          try {
            const url = new URL(path, baseUrl).href;
            if (!seen.has(url)) {
              links.push({ url, type: 'about' });
              break; // Solo una
            }
          } catch {
            // ignorar
          }
        }
      }

      const contactTypes = links.filter((l) => l.type === 'contact');
      if (contactTypes.length === 0) {
        const commonContact = ['/contacto', '/contactanos', '/contact', '/contact-us'];
        for (const path of commonContact) {
          try {
            const url = new URL(path, baseUrl).href;
            if (!seen.has(url)) {
              links.push({ url, type: 'contact' });
              break;
            }
          } catch {
            // ignorar
          }
        }
      }
    } catch {
      // baseUrl inválida
    }

    return links;
  }

  /**
   * Obtiene el contenido de los hermanos siguientes de un heading.
   */
  private getNextSiblingContent($: cheerio.CheerioAPI, heading: cheerio.Cheerio<any>): string {
    const parts: string[] = [];
    let next = heading.next();

    for (let i = 0; i < 5 && next.length > 0; i++) {
      const tag = next.prop('tagName')?.toLowerCase();

      // Parar si encontramos otro heading del mismo o mayor nivel
      if (tag && /^h[1-6]$/.test(tag)) break;

      const text = this.cleanText(next.text());
      if (text.length > 10) {
        parts.push(text);
      }

      next = next.next();
    }

    return parts.join('\n\n');
  }

  /**
   * Fetch de una página con manejo de redirects y timeouts.
   */
  private fetchPage(url: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      try {
        const parsed = new URL(url);
        const options = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent': ua,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'identity',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Sec-CH-UA': '"Chromium";v="120", "Google Chrome";v="120", "Not_A Brand";v="8"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Linux"',
          },
          ...(isHttps ? { rejectUnauthorized: false } : {}),
        };

        const req = client.request(options, (res) => {
          // Follow redirects (up to 3)
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).href;
            this.logger.debug(`   ↪ Redirect: ${redirectUrl}`);
            // Consume the response
            res.resume();
            this.fetchPage(redirectUrl, timeoutMs - 2000).then(resolve);
            return;
          }

          if (res.statusCode && res.statusCode >= 400) {
            this.logger.debug(`   ⚠️  HTTP ${res.statusCode} para ${url}`);
            res.resume();
            resolve(null);
            return;
          }

          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
          res.on('error', () => resolve(null));
        });

        req.on('error', (err) => {
          this.logger.debug(`   ⚠️  Request error: ${err.message}`);
          resolve(null);
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy();
          resolve(null);
        });

        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  private categoriseSocialLink(url: string, profile: CompanyProfile): void {
    const socialMap: Record<string, string> = {
      'facebook.com': 'facebook', 'fb.com': 'facebook',
      'twitter.com': 'twitter', 'x.com': 'twitter',
      'instagram.com': 'instagram', 'linkedin.com': 'linkedin',
      'youtube.com': 'youtube', 'tiktok.com': 'tiktok',
    };
    try {
      const host = new URL(url).hostname.toLowerCase().replace('www.', '');
      for (const [domain, name] of Object.entries(socialMap)) {
        if (host.includes(domain) && !profile.socialLinks[name]) {
          profile.socialLinks[name] = url;
        }
      }
    } catch {
      // URL inválida
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
