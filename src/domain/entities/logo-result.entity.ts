/**
 * Resultado de la descarga de un logo desde un proveedor externo.
 */
export class LogoResult {
  /** Dominio de la empresa */
  domain: string;

  /** Buffer con la imagen del logo */
  imageBuffer: Buffer;

  /** Formato de la imagen (png, jpg, svg, webp) */
  format: string;

  /** Tipo MIME de la imagen */
  contentType: string;

  /** Proveedor que resolvió el logo (logo.dev | brandfetch) */
  provider: string;

  /** URL original de donde se descargó */
  sourceUrl: string;
}
