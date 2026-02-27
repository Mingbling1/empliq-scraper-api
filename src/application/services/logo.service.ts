import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  LogoProviderPort,
  LOGO_PROVIDER_PRIMARY,
  LOGO_PROVIDER_FALLBACK,
} from '../../domain/ports/logo-provider.port';
import { StoragePort, STORAGE_PORT } from '../../domain/ports/storage.port';
import { LogoResult } from '../../domain/entities/logo-result.entity';
import {
  cleanCompanyName,
  generateSearchVariants,
} from '../../shared/utils/company-name-cleaner';
import { guessPeruvianDomain } from '../../shared/utils/domain-guesser';

export interface LogoFetchResult {
  success: boolean;
  domain: string;
  name: string | null;
  provider: string | null;
  bucketUrl: string | null;
  objectName: string | null;
  format: string | null;
  sizeBytes: number | null;
  durationMs: number;
  error: string | null;
}

/**
 * Servicio de orquestación para descarga y almacenamiento de logos.
 *
 * Flujo:
 * 1. Intenta descargar el logo desde el proveedor primario (logo.dev — 500K free/mes)
 * 2. Si falla, intenta con el fallback (Brandfetch — 100 free total)
 * 3. Si obtiene un logo, lo sube a Oracle Object Storage
 * 4. Devuelve la URL pública del bucket
 */
@Injectable()
export class LogoService {
  private readonly logger = new Logger(LogoService.name);

  constructor(
    @Inject(LOGO_PROVIDER_PRIMARY)
    private readonly primaryProvider: LogoProviderPort,

    @Inject(LOGO_PROVIDER_FALLBACK)
    private readonly fallbackProvider: LogoProviderPort,

    @Inject(STORAGE_PORT)
    private readonly storage: StoragePort,
  ) {}

  /**
   * Descarga el logo de una empresa y lo sube al bucket.
   *
   * Flujo de búsqueda (se detiene en el primer éxito):
   * 1. logo.dev por dominio (si se proporcionó dominio)
   * 2. logo.dev por nombre comercial (si se proporcionó nombre)
   * 3. Brandfetch por dominio (si se proporcionó dominio)
   *
   * @param domain Dominio de la empresa (ej: "alicorp.com.pe") — opcional si se da name
   * @param ruc RUC opcional para nombrar el archivo en el bucket
   * @param name Nombre comercial de la empresa (ej: "Alicorp") — opcional si se da domain
   */
  async fetchAndStoreLogo(
    domain?: string,
    ruc?: string,
    name?: string,
  ): Promise<LogoFetchResult> {
    const startTime = Date.now();
    const identifier = domain || name || 'desconocido';

    this.logger.log(
      `🔎 Buscando logo para: ${identifier}${ruc ? ` (RUC: ${ruc})` : ''}` +
        `${domain ? ` [dominio: ${domain}]` : ''}${name ? ` [nombre: ${name}]` : ''}`,
    );

    let logo: LogoResult | null = null;

    // 1. Intentar proveedor primario por dominio (logo.dev)
    if (domain) {
      try {
        logo = await this.primaryProvider.fetchLogo(domain);
      } catch (error) {
        this.logger.warn(`Error en ${this.primaryProvider.providerName} (dominio): ${error}`);
      }
    }

    // 2. Intentar con dominios adivinados para empresas peruanas conocidas
    if (!logo && name) {
      const guessedDomains = guessPeruvianDomain(name);
      for (const gd of guessedDomains) {
        if (gd === domain) continue; // Ya lo intentamos
        this.logger.log(`🔮 Intentando dominio adivinado: ${gd}`);
        try {
          logo = await this.primaryProvider.fetchLogo(gd);
          if (logo) {
            this.logger.log(`✅ Logo encontrado con dominio adivinado: ${gd}`);
            break;
          }
        } catch (error) {
          this.logger.warn(`Error con dominio adivinado ${gd}: ${error}`);
        }
      }
    }

    // 3. Intentar proveedor primario por variantes de nombre (logo.dev/name)
    if (!logo && name && this.primaryProvider.fetchLogoByName) {
      const variants = generateSearchVariants(name);
      this.logger.log(`📝 Variantes de búsqueda para "${name}": [${variants.join(', ')}]`);

      for (const variant of variants) {
        try {
          logo = await this.primaryProvider.fetchLogoByName(variant);
          if (logo) {
            this.logger.log(`✅ Logo encontrado con variante: "${variant}"`);
            break;
          }
        } catch (error) {
          this.logger.warn(`Error en ${this.primaryProvider.providerName} (nombre: "${variant}"): ${error}`);
        }
      }
    }

    // 4. Fallback a Brandfetch por dominio
    if (!logo && domain) {
      this.logger.log(`Intentando fallback (${this.fallbackProvider.providerName})...`);
      try {
        logo = await this.fallbackProvider.fetchLogo(domain);
      } catch (error) {
        this.logger.warn(`Error en ${this.fallbackProvider.providerName}: ${error}`);
      }
    }

    // 4. Si no se encontró logo en ningún proveedor
    if (!logo) {
      const duration = Date.now() - startTime;
      this.logger.log(`❌ No se encontró logo para ${identifier} (${duration}ms)`);
      return {
        success: false,
        domain: domain || '',
        name: name || null,
        provider: null,
        bucketUrl: null,
        objectName: null,
        format: null,
        sizeBytes: null,
        durationMs: duration,
        error: 'Logo no encontrado en ningún proveedor',
      };
    }

    // 5. Subir al bucket de Oracle
    try {
      const sanitizedId = (domain || name || 'unknown').replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = ruc
        ? `${ruc}_${sanitizedId}.${logo.format}`
        : `${sanitizedId}.${logo.format}`;

      const { url, objectName } = await this.storage.uploadFile(
        logo.imageBuffer,
        fileName,
        'logos',
        logo.contentType,
      );

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Logo almacenado: ${url} (${logo.provider}, ${logo.imageBuffer.length} bytes, ${duration}ms)`,
      );

      return {
        success: true,
        domain: domain || '',
        name: name || null,
        provider: logo.provider,
        bucketUrl: url,
        objectName,
        format: logo.format,
        sizeBytes: logo.imageBuffer.length,
        durationMs: duration,
        error: null,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Error subiendo logo al bucket: ${errorMsg}`);
      return {
        success: false,
        domain: domain || '',
        name: name || null,
        provider: logo.provider,
        bucketUrl: null,
        objectName: null,
        format: logo.format,
        sizeBytes: logo.imageBuffer.length,
        durationMs: duration,
        error: `Error subiendo al bucket: ${errorMsg}`,
      };
    }
  }
}
