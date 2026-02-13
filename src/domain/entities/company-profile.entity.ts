/**
 * Datos extraídos del perfil web de una empresa.
 * Entidad de dominio — no depende de frameworks.
 */
export class CompanyProfile {
  /** URL principal desde donde se extrajo */
  sourceUrl: string;

  /** Nombre de la empresa encontrado en la web */
  name: string | null;

  /** Breve descripción / tagline */
  description: string | null;

  /** Historia de la empresa (texto largo) */
  history: string | null;

  /** Año de fundación */
  foundedYear: number | null;

  /** Fecha de fundación completa (si la hay) */
  foundedDate: string | null;

  /** Nombre original al fundarse */
  originalName: string | null;

  /** Dirección de sede principal */
  headquarters: string | null;

  /** Teléfonos encontrados */
  phones: string[];

  /** Emails encontrados */
  emails: string[];

  /** RUC (11 dígitos, empresas peruanas) */
  ruc: string | null;

  /** Sector / industria */
  industry: string | null;

  /** URL del logo de la empresa (SVG, PNG, JPG) */
  logoUrl: string | null;

  /** Misión */
  mission: string | null;

  /** Visión */
  vision: string | null;

  /** Valores corporativos */
  values: string[];

  /** Accionistas / propietarios */
  shareholders: string[];

  /** Número de empleados o rango */
  employeeCount: string | null;

  /** Red de distribución / cobertura */
  coverage: string | null;

  /** Links a redes sociales */
  socialLinks: Record<string, string>;

  /** URLs internas visitadas para extraer datos */
  pagesScraped: string[];

  /** Datos adicionales no categorizados */
  extras: Record<string, string>;

  /** Timestamp de extracción */
  scrapedAt: Date;

  /** Duración total del scraping en ms */
  durationMs: number;

  constructor(sourceUrl: string) {
    this.sourceUrl = sourceUrl;
    this.name = null;
    this.description = null;
    this.history = null;
    this.foundedYear = null;
    this.foundedDate = null;
    this.originalName = null;
    this.headquarters = null;
    this.phones = [];
    this.emails = [];
    this.ruc = null;
    this.industry = null;
    this.logoUrl = null;
    this.mission = null;
    this.vision = null;
    this.values = [];
    this.shareholders = [];
    this.employeeCount = null;
    this.coverage = null;
    this.socialLinks = {};
    this.pagesScraped = [];
    this.extras = {};
    this.scrapedAt = new Date();
    this.durationMs = 0;
  }

  /** Cuántos campos se lograron extraer */
  get fieldsExtracted(): number {
    let count = 0;
    if (this.name) count++;
    if (this.description) count++;
    if (this.history) count++;
    if (this.foundedYear) count++;
    if (this.headquarters) count++;
    if (this.phones.length > 0) count++;
    if (this.emails.length > 0) count++;
    if (this.ruc) count++;
    if (this.industry) count++;
    if (this.logoUrl) count++;
    if (this.mission) count++;
    if (this.vision) count++;
    if (this.values.length > 0) count++;
    if (this.shareholders.length > 0) count++;
    if (this.employeeCount) count++;
    if (this.coverage) count++;
    return count;
  }

  /** Resumen para logging */
  get summary(): string {
    const fields: string[] = [];
    if (this.name) fields.push(`name="${this.name}"`);
    if (this.ruc) fields.push(`ruc=${this.ruc}`);
    if (this.foundedYear) fields.push(`founded=${this.foundedYear}`);
    if (this.phones.length) fields.push(`phones=${this.phones.length}`);
    if (this.emails.length) fields.push(`emails=${this.emails.length}`);
    if (this.headquarters) fields.push('HQ');
    if (this.logoUrl) fields.push('logo');
    if (this.history) fields.push('history');
    if (this.mission) fields.push('mission');
    if (this.vision) fields.push('vision');
    return `[${this.fieldsExtracted} fields] ${fields.join(', ')}`;
  }
}
