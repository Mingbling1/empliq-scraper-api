import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ExecutiveDto {
  @ApiProperty() cargo: string;
  @ApiProperty() nombre: string;
  @ApiPropertyOptional() desde: string | null;
}

class BranchDto {
  @ApiProperty() direccion: string;
  @ApiPropertyOptional() ubicacion: string | null;
}

class WorkerHistoryDto {
  @ApiProperty() periodo: string;
  @ApiProperty() nroTrabajadores: number;
  @ApiProperty() nroPensionistas: number;
  @ApiProperty() nroPrestadores: number;
}

class HistoricalConditionDto {
  @ApiProperty() condicion: string;
  @ApiPropertyOptional() desde: string | null;
  @ApiPropertyOptional() hasta: string | null;
}

class HistoricalAddressDto {
  @ApiProperty() direccion: string;
  @ApiPropertyOptional() fechaBaja: string | null;
}

export class DatosPeruEnrichResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty() ruc: string;
  @ApiProperty() sourceUrl: string;

  /** Tipo de error: not_found | proxy_error | parse_error (solo si success=false) */
  @ApiPropertyOptional() errorType: string | null;
  /** Detalle del error (solo si success=false) */
  @ApiPropertyOptional() errorMessage: string | null;

  // Datos básicos SUNAT
  @ApiPropertyOptional() nombre: string | null;
  @ApiPropertyOptional() fechaInicio: string | null;
  @ApiPropertyOptional() fechaInscripcion: string | null;
  @ApiPropertyOptional() estado: string | null;
  @ApiPropertyOptional() tipo: string | null;
  @ApiPropertyOptional() condicion: string | null;
  @ApiPropertyOptional() tipoContribuyente: string | null;

  // CIIU / Actividades
  @ApiPropertyOptional() ciiu: string | null;
  @ApiPropertyOptional() sectorEconomico: string | null;
  @ApiProperty({ type: [String] }) actividadesEconomicas: string[];

  // Sistemas de emisión / contabilidad
  @ApiPropertyOptional() sistemaEmisionComprobantes: string | null;
  @ApiPropertyOptional() sistemaContabilidad: string | null;
  @ApiPropertyOptional() actividadComercioExterior: string | null;
  @ApiProperty({ type: [String] }) comprobantesPagoAutorizados: string[];
  @ApiProperty({ type: Object }) comprobantesElectronicos: { tipo: string; fecha: string }[];
  @ApiProperty({ type: [String] }) sistemasEmisionElectronica: string[];

  // Deuda coactiva
  @ApiProperty() deudaCoactivaReacta: boolean;
  @ApiProperty() deudaCoactivaCovid: boolean;

  // Dirección
  @ApiPropertyOptional() direccion: string | null;
  @ApiPropertyOptional() referencia: string | null;
  @ApiPropertyOptional() departamento: string | null;
  @ApiPropertyOptional() provincia: string | null;
  @ApiPropertyOptional() distrito: string | null;
  @ApiPropertyOptional() pais: string | null;

  // Contacto
  @ApiProperty({ type: [String] }) telefonos: string[];
  @ApiPropertyOptional() web: string | null;
  @ApiProperty() proveedorEstado: boolean;

  // Extra
  @ApiPropertyOptional() descripcion: string | null;
  @ApiPropertyOptional() logoUrl: string | null;
  @ApiPropertyOptional() marcaComercioExterior: string | null;

  // Listas
  @ApiProperty({ type: [ExecutiveDto] }) ejecutivos: ExecutiveDto[];
  @ApiProperty({ type: [BranchDto] }) establecimientosAnexos: BranchDto[];
  @ApiProperty({ type: [WorkerHistoryDto] }) historialTrabajadores: WorkerHistoryDto[];
  @ApiProperty({ type: [HistoricalConditionDto] }) historialCondiciones: HistoricalConditionDto[];
  @ApiProperty({ type: [HistoricalAddressDto] }) historialDirecciones: HistoricalAddressDto[];

  // Meta
  @ApiProperty() fieldsExtracted: number;
  @ApiProperty() durationMs: number;
  @ApiProperty() timestamp: string;
}
