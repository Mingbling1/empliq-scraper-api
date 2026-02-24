import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogoProviderPort } from '../../domain/ports/logo-provider.port';
import { LogoResult } from '../../domain/entities/logo-result.entity';

/**
 * Adaptador para logo.dev — Image CDN.
 *
 * Tier gratuito: 500,000 requests/mes.
 * Endpoints:
 *   - Por dominio: https://img.logo.dev/{domain}?token={pk}&format=png&size=256&fallback=404
 *   - Por nombre:  https://img.logo.dev/name/{brand_name}?token={pk}&format=png&size=256&fallback=404
 *
 * Devuelve la imagen directamente como buffer binario.
 */
@Injectable()
export class LogoDevAdapter implements LogoProviderPort {
  readonly providerName = 'logo.dev';
  private readonly logger = new Logger(LogoDevAdapter.name);
  private readonly apiToken: string;
  private readonly baseUrl = 'https://img.logo.dev';

  constructor(private readonly config: ConfigService) {
    this.apiToken = this.config.get<string>('LOGO_DEV_TOKEN', '');
    if (!this.apiToken) {
      this.logger.warn('⚠️  LOGO_DEV_TOKEN no configurado — logo.dev deshabilitado.');
    }
  }

  async fetchLogo(domain: string): Promise<LogoResult | null> {
    if (!this.apiToken) {
      this.logger.warn('logo.dev no configurado, saltando...');
      return null;
    }

    const format = 'png';
    const url = `${this.baseUrl}/${domain}?token=${this.apiToken}&format=${format}&size=256&fallback=404`;

    this.logger.log(`📥 Descargando logo de logo.dev: ${domain}`);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'image/*',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.log(`Logo no encontrado en logo.dev para: ${domain}`);
          return null;
        }
        this.logger.warn(`logo.dev error ${response.status}: ${response.statusText}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Validar que realmente recibimos una imagen (mínimo 1KB)
      if (buffer.length < 1024) {
        this.logger.warn(`Logo muy pequeño para ${domain} (${buffer.length} bytes) — posible placeholder`);
        return null;
      }

      const result = new LogoResult();
      result.domain = domain;
      result.imageBuffer = buffer;
      result.format = format;
      result.contentType = contentType;
      result.provider = this.providerName;
      result.sourceUrl = `${this.baseUrl}/${domain}`;

      this.logger.log(`✅ Logo descargado de logo.dev: ${domain} (${buffer.length} bytes)`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error descargando logo de logo.dev para ${domain}: ${error}`);
      return null;
    }
  }

  /**
   * Busca el logo por nombre comercial usando img.logo.dev/name/{name}.
   * Útil cuando la empresa no tiene dominio web conocido.
   */
  async fetchLogoByName(name: string): Promise<LogoResult | null> {
    if (!this.apiToken) {
      this.logger.warn('logo.dev no configurado, saltando búsqueda por nombre...');
      return null;
    }

    const format = 'png';
    const encodedName = encodeURIComponent(name);
    const url = `${this.baseUrl}/name/${encodedName}?token=${this.apiToken}&format=${format}&size=256&fallback=404`;

    this.logger.log(`📥 Buscando logo por nombre en logo.dev: "${name}"`);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'image/*' },
      });

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.log(`Logo no encontrado en logo.dev por nombre: "${name}"`);
          return null;
        }
        this.logger.warn(`logo.dev name error ${response.status}: ${response.statusText}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Validar que realmente recibimos una imagen (mínimo 1KB)
      if (buffer.length < 1024) {
        this.logger.warn(`Logo muy pequeño para nombre "${name}" (${buffer.length} bytes) — posible placeholder`);
        return null;
      }

      const result = new LogoResult();
      result.domain = name; // Usamos el nombre como identificador
      result.imageBuffer = buffer;
      result.format = format;
      result.contentType = contentType;
      result.provider = `${this.providerName}/name`;
      result.sourceUrl = `${this.baseUrl}/name/${encodedName}`;

      this.logger.log(`✅ Logo descargado de logo.dev por nombre: "${name}" (${buffer.length} bytes)`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error buscando logo por nombre "${name}": ${error}`);
      return null;
    }
  }
}
