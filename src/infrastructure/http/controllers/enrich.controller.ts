import {
  Controller,
  Get,
  Query,
  Logger,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { EnrichmentService } from '../../../application/services/enrichment.service';
import { DatosPeruEnrichResponseDto } from '../dtos/enrich-response.dto';

@ApiTags('Enrich')
@ApiSecurity('x-api-key')
@Controller('enrich')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class EnrichController {
  private readonly logger = new Logger(EnrichController.name);

  constructor(private readonly enrichmentService: EnrichmentService) {}

  /**
   * GET /enrich/datosperu?ruc=20100047218
   * Enriquece datos de una empresa desde datosperu.org.
   */
  @Get('datosperu')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enriquecer datos de empresa desde DatosPeru.org',
    description:
      'Dado un RUC, busca en datosperu.org y extrae datos públicos: ' +
      'razón social, estado, tipo, dirección, teléfonos, web, CIIU, ' +
      'ejecutivos/directores, establecimientos anexos, historial de trabajadores, ' +
      'info histórica, descripción, logo y más.\n\n' +
      'HTTP puro — sin browser — ~2-5s.',
  })
  @ApiQuery({ name: 'ruc', description: 'RUC de la empresa (11 dígitos)', example: '20100047218' })
  @ApiResponse({ status: 200, type: DatosPeruEnrichResponseDto })
  async enrichFromDatosPeru(
    @Query('ruc') ruc: string,
  ): Promise<DatosPeruEnrichResponseDto> {
    this.logger.log(`🔎 Enrich request: RUC ${ruc}`);

    // Validar formato RUC
    if (!ruc || !/^\d{11}$/.test(ruc)) {
      return {
        success: false,
        ruc: ruc || '',
        sourceUrl: '',
        nombre: null,
        fechaInicio: null,
        fechaInscripcion: null,
        estado: null,
        tipo: null,
        ciiu: null,
        sectorEconomico: null,
        direccion: null,
        referencia: null,
        departamento: null,
        provincia: null,
        distrito: null,
        pais: null,
        telefonos: [],
        web: null,
        proveedorEstado: false,
        descripcion: null,
        logoUrl: null,
        marcaComercioExterior: null,
        ejecutivos: [],
        establecimientosAnexos: [],
        historialTrabajadores: [],
        historialCondiciones: [],
        historialDirecciones: [],
        fieldsExtracted: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const profile = await this.enrichmentService.enrichFromDatosPeru(ruc);

    if (!profile) {
      return {
        success: false,
        ruc,
        sourceUrl: '',
        nombre: null,
        fechaInicio: null,
        fechaInscripcion: null,
        estado: null,
        tipo: null,
        ciiu: null,
        sectorEconomico: null,
        direccion: null,
        referencia: null,
        departamento: null,
        provincia: null,
        distrito: null,
        pais: null,
        telefonos: [],
        web: null,
        proveedorEstado: false,
        descripcion: null,
        logoUrl: null,
        marcaComercioExterior: null,
        ejecutivos: [],
        establecimientosAnexos: [],
        historialTrabajadores: [],
        historialCondiciones: [],
        historialDirecciones: [],
        fieldsExtracted: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      success: profile.fieldsExtracted > 0,
      ruc: profile.ruc,
      sourceUrl: profile.sourceUrl,
      nombre: profile.nombre,
      fechaInicio: profile.fechaInicio,
      fechaInscripcion: profile.fechaInscripcion,
      estado: profile.estado,
      tipo: profile.tipo,
      ciiu: profile.ciiu,
      sectorEconomico: profile.sectorEconomico,
      direccion: profile.direccion,
      referencia: profile.referencia,
      departamento: profile.departamento,
      provincia: profile.provincia,
      distrito: profile.distrito,
      pais: profile.pais,
      telefonos: profile.telefonos,
      web: profile.web,
      proveedorEstado: profile.proveedorEstado,
      descripcion: profile.descripcion,
      logoUrl: profile.logoUrl,
      marcaComercioExterior: profile.marcaComercioExterior,
      ejecutivos: profile.ejecutivos,
      establecimientosAnexos: profile.establecimientosAnexos,
      historialTrabajadores: profile.historialTrabajadores,
      historialCondiciones: profile.historialCondiciones,
      historialDirecciones: profile.historialDirecciones,
      fieldsExtracted: profile.fieldsExtracted,
      durationMs: profile.durationMs,
      timestamp: new Date().toISOString(),
    };
  }
}
