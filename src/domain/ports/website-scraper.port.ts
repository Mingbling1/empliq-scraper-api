import { CompanyProfile } from '../entities/company-profile.entity';

/**
 * Token de inyección para los adaptadores de scraping.
 */
export const WEBSITE_SCRAPER_PORT = 'WEBSITE_SCRAPER_PORT';

/**
 * Puerto (interfaz) para extraer datos de la web oficial de una empresa.
 * Parte del dominio — no conoce frameworks ni infraestructura.
 */
export interface WebsiteScraperPort {
  /**
   * Extrae datos del perfil corporativo de una URL.
   * Puede internamente navegar a sub-páginas (/nosotros, /about, /contacto).
   *
   * @param url URL principal de la empresa
   * @param options Opciones de extracción
   * @returns Perfil extraído con todos los datos encontrados
   */
  scrape(
    url: string,
    options?: ScrapeOptions,
  ): Promise<CompanyProfile>;
}

export interface ScrapeOptions {
  /** Navegar automáticamente a sub-páginas (/nosotros, /about, etc.). Default: true */
  followSubpages?: boolean;

  /** Timeout total en ms. Default: 30000 */
  timeoutMs?: number;

  /** Máximo de sub-páginas a visitar. Default: 3 */
  maxSubpages?: number;
}
