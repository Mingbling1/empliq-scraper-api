import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogoProviderPort } from '../../domain/ports/logo-provider.port';
import { LogoResult } from '../../domain/entities/logo-result.entity';

/**
 * Adaptador para Brandfetch API — FALLBACK.
 *
 * Tier gratuito: 100 requests totales (muy limitado).
 * Endpoint: GET https://api.brandfetch.io/v2/brands/domain/{domain}
 * Auth: Bearer token en header.
 *
 * Devuelve JSON con array de logos → selecciona el mejor y descarga la imagen.
 */
@Injectable()
export class BrandfetchAdapter implements LogoProviderPort {
  readonly providerName = 'brandfetch';
  private readonly logger = new Logger(BrandfetchAdapter.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.brandfetch.io/v2/brands/domain';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BRANDFETCH_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn('⚠️  BRANDFETCH_API_KEY no configurado — Brandfetch deshabilitado.');
    }
  }

  async fetchLogo(domain: string): Promise<LogoResult | null> {
    if (!this.apiKey) {
      this.logger.warn('Brandfetch no configurado, saltando...');
      return null;
    }

    this.logger.log(`📥 Buscando logo en Brandfetch: ${domain}`);

    try {
      // 1. Obtener datos de marca
      const response = await fetch(`${this.baseUrl}/${domain}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.log(`Marca no encontrada en Brandfetch para: ${domain}`);
          return null;
        }
        if (response.status === 429) {
          this.logger.warn('⚠️  Brandfetch rate limit alcanzado (100 requests)');
          return null;
        }
        this.logger.warn(`Brandfetch error ${response.status}: ${response.statusText}`);
        return null;
      }

      const brandData = await response.json();

      // 2. Extraer la mejor URL de logo
      const logoUrl = this.selectBestLogo(brandData);
      if (!logoUrl) {
        this.logger.log(`No se encontró logo utilizable en Brandfetch para: ${domain}`);
        return null;
      }

      // 3. Descargar la imagen del logo
      const imageResponse = await fetch(logoUrl);
      if (!imageResponse.ok) {
        this.logger.warn(`Error descargando imagen de Brandfetch: ${imageResponse.status}`);
        return null;
      }

      const contentType = imageResponse.headers.get('content-type') || 'image/png';
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length < 512) {
        this.logger.warn(`Logo muy pequeño de Brandfetch para ${domain} (${buffer.length} bytes)`);
        return null;
      }

      // Determinar formato desde URL o content-type
      const format = this.detectFormat(logoUrl, contentType);

      const result = new LogoResult();
      result.domain = domain;
      result.imageBuffer = buffer;
      result.format = format;
      result.contentType = contentType;
      result.provider = this.providerName;
      result.sourceUrl = logoUrl;

      this.logger.log(`✅ Logo descargado de Brandfetch: ${domain} (${buffer.length} bytes, ${format})`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error en Brandfetch para ${domain}: ${error}`);
      return null;
    }
  }

  /**
   * Selecciona el mejor logo de la respuesta de Brandfetch.
   * Prioridad: icon > logo > symbol.
   * Prefiere: PNG > JPG > SVG (para consistencia en el bucket).
   */
  private selectBestLogo(brandData: any): string | null {
    const logos = brandData?.logos;
    if (!Array.isArray(logos) || logos.length === 0) return null;

    // Prioridad por tipo
    const typeOrder = ['icon', 'logo', 'symbol'];

    for (const type of typeOrder) {
      const logoGroup = logos.find((l: any) => l.type === type);
      if (!logoGroup?.formats?.length) continue;

      // Prioridad por formato: PNG > JPG > SVG > cualquiera
      const formatOrder = ['png', 'jpg', 'jpeg', 'svg'];
      for (const fmt of formatOrder) {
        const match = logoGroup.formats.find(
          (f: any) => f.format === fmt && f.src,
        );
        if (match) return match.src;
      }

      // Si no coincide ningún formato preferido, tomar el primero disponible
      const first = logoGroup.formats.find((f: any) => f.src);
      if (first) return first.src;
    }

    // Último recurso: cualquier logo con src
    for (const logo of logos) {
      if (logo.formats?.length) {
        const first = logo.formats.find((f: any) => f.src);
        if (first) return first.src;
      }
    }

    return null;
  }

  /**
   * Detecta el formato de imagen desde la URL o content-type.
   */
  private detectFormat(url: string, contentType: string): string {
    // Intentar desde la URL
    const urlMatch = url.match(/\.(png|jpg|jpeg|svg|webp)(\?|$)/i);
    if (urlMatch) return urlMatch[1].toLowerCase();

    // Desde content-type
    if (contentType.includes('svg')) return 'svg';
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
    if (contentType.includes('webp')) return 'webp';

    return 'png'; // default
  }
}
