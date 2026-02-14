import { DatosPeruProfile } from '../entities/datos-peru-profile.entity';

/**
 * Puerto para enriquecimiento de datos desde datosperu.org.
 * Dado un RUC, busca y extrae toda la información pública.
 */
export interface DatosPeruEnrichmentPort {
  /**
   * Enriquece datos de una empresa por su RUC.
   * Flujo: buscar por RUC → obtener URL de empresa → parsear HTML.
   */
  enrich(ruc: string): Promise<DatosPeruProfile | null>;
}

export const DATOS_PERU_ENRICHMENT_PORT = Symbol('DATOS_PERU_ENRICHMENT_PORT');
