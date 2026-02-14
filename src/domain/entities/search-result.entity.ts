import { SearchStrategy } from '../enums/search-strategy.enum';

/**
 * Un resultado individual de búsqueda.
 */
export class SearchResultItem {
  url: string;
  title: string;
  score: number;

  constructor(url: string, title: string, score: number) {
    this.url = url;
    this.title = title;
    this.score = score;
  }
}

/**
 * Resultado completo de una búsqueda de empresa.
 * Entidad de dominio — no depende de frameworks.
 */
export class SearchResult {
  /** Nombre original de la empresa */
  company: string;

  /** Nombre limpio (sin SAC, SRL, etc.) */
  cleanName: string;

  /** URL del mejor resultado */
  website: string | null;

  /** Score del mejor resultado */
  score: number;

  /** Título de la página encontrada */
  title: string | null;

  /** Estrategia que consiguió el resultado */
  strategy: SearchStrategy;

  /** Top resultados alternativos */
  allResults: SearchResultItem[];

  /** Timestamp de la búsqueda */
  timestamp: Date;

  constructor(params: {
    company: string;
    cleanName: string;
    website: string | null;
    score: number;
    title: string | null;
    strategy: SearchStrategy;
    allResults: SearchResultItem[];
  }) {
    this.company = params.company;
    this.cleanName = params.cleanName;
    this.website = params.website;
    this.score = params.score;
    this.title = params.title;
    this.strategy = params.strategy;
    this.allResults = params.allResults;
    this.timestamp = new Date();
  }

  /**
   * Un resultado se considera "encontrado" solo si tiene un score mínimo razonable.
   * Score 2 = solo bonus HTTPS (basura). Score 8+ = al menos una palabra del nombre en el dominio.
   */
  get found(): boolean {
    return this.website !== null && this.score >= 8;
  }
}
