/**
 * Perfil enriquecido desde datosperu.org.
 * Contiene información pública estructurada de SUNAT + fuentes adicionales.
 */

export interface DatosPeruExecutive {
  cargo: string; // APODERADO, GERENTE GENERAL, etc.
  nombre: string;
  desde: string | null; // fecha "23/01/2025"
}

export interface DatosPeruBranch {
  direccion: string;
  ubicacion: string | null; // "AG. AGENCIA", "SU. SUCURSAL"
}

export interface DatosPeruWorkerHistory {
  periodo: string; // "2025-09"
  nroTrabajadores: number;
  nroPensionistas: number;
  nroPrestadores: number;
}

export interface DatosPeruHistoricalAddress {
  direccion: string;
  fechaBaja: string | null;
}

export interface DatosPeruHistoricalCondition {
  condicion: string;
  desde: string | null;
  hasta: string | null;
}

export class DatosPeruProfile {
  sourceUrl: string;

  // ── Datos básicos SUNAT ──
  nombre: string | null;
  ruc: string;
  fechaInicio: string | null;
  fechaInscripcion: string | null;
  estado: string | null; // "ACTIVO", "BAJA DE OFICIO", etc.
  tipo: string | null; // "SOCIEDAD ANONIMA", "EMPRESA INDIVIDUAL", etc.
  condicion: string | null; // "HABIDO", "NO HABIDO", "ANULADO", etc.
  tipoContribuyente: string | null; // "SOCIEDAD ANONIMA CERRADA", etc.

  // ── CIIU / Actividades ──
  ciiu: string | null; // Código CIIU principal
  sectorEconomico: string | null; // Primera actividad económica (para compatibilidad)
  actividadesEconomicas: string[]; // Todas las actividades económicas

  // ── Sistemas de emisión / contabilidad ──
  sistemaEmisionComprobantes: string | null;
  sistemaContabilidad: string | null;
  actividadComercioExterior: string | null;
  comprobantesPagoAutorizados: string[]; // ["FACTURA", "BOLETA", etc.]
  comprobantesElectronicos: { tipo: string; fecha: string }[];
  sistemasEmisionElectronica: string[];

  // ── Deuda coactiva ──
  deudaCoactivaReacta: boolean;
  deudaCoactivaCovid: boolean;

  // ── Dirección ──
  direccion: string | null;
  referencia: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  pais: string | null;

  // ── Contacto ──
  telefonos: string[];
  web: string | null;
  proveedorEstado: boolean;

  // ── Descripción (Top300 u otra) ──
  descripcion: string | null;
  logoUrl: string | null;

  // ── Comercio exterior ──
  marcaComercioExterior: string | null; // "SIN ACTIVIDAD" / "IMPORTADOR/EXPORTADOR"

  // ── Ejecutivos ──
  ejecutivos: DatosPeruExecutive[];

  // ── Establecimientos anexos ──
  establecimientosAnexos: DatosPeruBranch[];

  // ── Historial de trabajadores ──
  historialTrabajadores: DatosPeruWorkerHistory[];

  // ── Info histórica ──
  historialCondiciones: DatosPeruHistoricalCondition[];
  historialDirecciones: DatosPeruHistoricalAddress[];

  // ── Meta ──
  scrapedAt: Date;
  durationMs: number;

  constructor(ruc: string, sourceUrl: string) {
    this.sourceUrl = sourceUrl;
    this.ruc = ruc;
    this.nombre = null;
    this.fechaInicio = null;
    this.fechaInscripcion = null;
    this.estado = null;
    this.tipo = null;
    this.condicion = null;
    this.tipoContribuyente = null;
    this.ciiu = null;
    this.sectorEconomico = null;
    this.actividadesEconomicas = [];
    this.sistemaEmisionComprobantes = null;
    this.sistemaContabilidad = null;
    this.actividadComercioExterior = null;
    this.comprobantesPagoAutorizados = [];
    this.comprobantesElectronicos = [];
    this.sistemasEmisionElectronica = [];
    this.deudaCoactivaReacta = false;
    this.deudaCoactivaCovid = false;
    this.direccion = null;
    this.referencia = null;
    this.departamento = null;
    this.provincia = null;
    this.distrito = null;
    this.pais = null;
    this.telefonos = [];
    this.web = null;
    this.proveedorEstado = false;
    this.descripcion = null;
    this.logoUrl = null;
    this.marcaComercioExterior = null;
    this.ejecutivos = [];
    this.establecimientosAnexos = [];
    this.historialTrabajadores = [];
    this.historialCondiciones = [];
    this.historialDirecciones = [];
    this.scrapedAt = new Date();
    this.durationMs = 0;
  }

  /** Cuántos campos se lograron extraer */
  get fieldsExtracted(): number {
    let count = 0;
    if (this.nombre) count++;
    if (this.fechaInicio) count++;
    if (this.estado) count++;
    if (this.tipo) count++;
    if (this.condicion) count++;
    if (this.tipoContribuyente) count++;
    if (this.ciiu) count++;
    if (this.sectorEconomico) count++;
    if (this.actividadesEconomicas.length > 0) count++;
    if (this.sistemaEmisionComprobantes) count++;
    if (this.sistemaContabilidad) count++;
    if (this.actividadComercioExterior) count++;
    if (this.comprobantesPagoAutorizados.length > 0) count++;
    if (this.comprobantesElectronicos.length > 0) count++;
    if (this.sistemasEmisionElectronica.length > 0) count++;
    if (this.deudaCoactivaReacta || this.deudaCoactivaCovid) count++;
    if (this.direccion) count++;
    if (this.departamento) count++;
    if (this.provincia) count++;
    if (this.distrito) count++;
    if (this.telefonos.length > 0) count++;
    if (this.web) count++;
    if (this.descripcion) count++;
    if (this.ejecutivos.length > 0) count++;
    if (this.establecimientosAnexos.length > 0) count++;
    if (this.historialTrabajadores.length > 0) count++;
    if (this.historialCondiciones.length > 0) count++;
    return count;
  }

  /** Resumen para logging */
  get summary(): string {
    const parts: string[] = [];
    if (this.nombre) parts.push(`name="${this.nombre}"`);
    parts.push(`ruc=${this.ruc}`);
    if (this.estado) parts.push(`estado=${this.estado}`);
    if (this.condicion) parts.push(`cond=${this.condicion}`);
    if (this.tipo) parts.push(`tipo=${this.tipo}`);
    if (this.ejecutivos.length) parts.push(`ejecutivos=${this.ejecutivos.length}`);
    if (this.establecimientosAnexos.length) parts.push(`anexos=${this.establecimientosAnexos.length}`);
    if (this.actividadesEconomicas.length) parts.push(`acts=${this.actividadesEconomicas.length}`);
    return `[${this.fieldsExtracted} fields] ${parts.join(', ')}`;
  }
}
