import { DatosPeruProfile } from '../entities/datos-peru-profile.entity';

/**
 * Tipos de error posibles al enriquecer un RUC.
 * - not_found: la empresa NO existe en datosperu.org (no reintentar)
 * - proxy_error: todos los proxies fallaron (temporal, reintentar)
 * - parse_error: se descargó HTML pero falló el parseo
 */
export type EnrichErrorType = 'not_found' | 'proxy_error' | 'parse_error';

/**
 * Resultado estructurado del enriquecimiento.
 * Permite al caller distinguir entre "no existe" vs "proxy falló".
 */
export interface EnrichResult {
  profile: DatosPeruProfile | null;
  errorType?: EnrichErrorType;
  errorMessage?: string;
}

/**
 * Puerto para enriquecimiento de datos desde datosperu.org.
 * Dado un RUC, busca y extrae toda la información pública.
 */
export interface DatosPeruEnrichmentPort {
  /**
   * Enriquece datos de una empresa por su RUC.
   * Flujo: buscar por RUC → obtener URL de empresa → parsear HTML.
   */
  enrich(ruc: string): Promise<EnrichResult>;
}

export const DATOS_PERU_ENRICHMENT_PORT = Symbol('DATOS_PERU_ENRICHMENT_PORT');
