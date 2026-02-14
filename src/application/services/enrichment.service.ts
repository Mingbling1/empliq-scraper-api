import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DatosPeruEnrichmentPort,
  DATOS_PERU_ENRICHMENT_PORT,
} from '../../domain/ports/datos-peru-enrichment.port';
import { DatosPeruProfile } from '../../domain/entities/datos-peru-profile.entity';

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
   */
  async enrichFromDatosPeru(ruc: string): Promise<DatosPeruProfile | null> {
    this.logger.log(`🔎 Enriqueciendo RUC ${ruc} desde DatosPeru`);
    return this.datosPeru.enrich(ruc);
  }
}
