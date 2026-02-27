import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DatosPeruEnrichmentPort,
  DATOS_PERU_ENRICHMENT_PORT,
  EnrichResult,
} from '../../domain/ports/datos-peru-enrichment.port';

/**
 * Servicio de enriquecimiento de datos de empresas.
 *
 * Usa datosperu.org para obtener información pública estructurada:
 * - Datos SUNAT (RUC, estado, tipo, dirección)
 * - Ejecutivos / representantes legales
 * - Historial de trabajadores
 * - Establecimientos anexos
 * - Info histórica
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    @Inject(DATOS_PERU_ENRICHMENT_PORT)
    private readonly datosPeru: DatosPeruEnrichmentPort,
  ) {}

  /**
   * Enriquece datos de una empresa por su RUC desde datosperu.org.
   * Retorna resultado estructurado con tipo de error si falla.
   */
  async enrichFromDatosPeru(ruc: string): Promise<EnrichResult> {
    this.logger.log(`🔎 Enriqueciendo RUC ${ruc} desde DatosPeru`);
    return this.datosPeru.enrich(ruc);
  }
}
