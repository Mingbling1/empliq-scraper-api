import { LogoResult } from '../entities/logo-result.entity';

/**
 * Puerto para proveedores de logos de empresas.
 * Cada adaptador implementa la descarga desde un proveedor distinto.
 */
export interface LogoProviderPort {
  /**
   * Nombre del proveedor (para logging / métricas).
   */
  readonly providerName: string;

  /**
   * Intenta descargar el logo de una empresa dado su dominio web.
   * @returns LogoResult con el buffer de la imagen, o null si no se encontró.
   */
  fetchLogo(domain: string): Promise<LogoResult | null>;

  /**
   * Intenta descargar el logo de una empresa dado su nombre comercial.
   * No todos los proveedores lo soportan — devuelve null si no está disponible.
   * @returns LogoResult con el buffer de la imagen, o null si no se encontró.
   */
  fetchLogoByName?(name: string): Promise<LogoResult | null>;
}

export const LOGO_PROVIDER_PRIMARY = Symbol('LOGO_PROVIDER_PRIMARY');
export const LOGO_PROVIDER_FALLBACK = Symbol('LOGO_PROVIDER_FALLBACK');
