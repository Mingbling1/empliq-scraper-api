import { getCompanyWords } from './company-name-cleaner';

/** TLDs peruanos tienen prioridad */
const PREFERRED_TLDS = ['.pe', '.com.pe', '.gob.pe', '.org.pe'];

/** Dominios que nunca son la web oficial de una empresa */
const BLACKLIST = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'youtube.com', 'wikipedia.org', 'glassdoor.com', 'indeed.com',
  'computrabajo.com', 'bumeran.com', 'google.com', 'duckduckgo.com',
  'bing.com', 'mercadolibre.com', 'amazon.com', 'rpp.pe',
  'elcomercio.pe', 'gestion.pe', 'larepublica.pe', 'tiktok.com',
  'datosperu.org', 'universidadperu.com', 'pinterest.com', 'yelp.com',
  'sunat.gob.pe', 'waze.com', 'tripadvisor.com',
];

/**
 * Verifica si una URL pertenece a un dominio bloqueado.
 */
export function isBlacklisted(url: string): boolean {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    return BLACKLIST.some((bl) => domain.includes(bl));
  } catch {
    return true;
  }
}

/**
 * Puntúa un resultado de búsqueda según relevancia para la empresa.
 *
 * Criterios:
 *  - TLD peruano (.pe, .com.pe) → +15
 *  - Palabra de empresa en dominio → +10 c/u
 *  - Palabra de empresa en título → +5 c/u
 *  - Dice "oficial" / "official" → +3
 *  - HTTPS → +2
 */
export function scoreResult(
  url: string,
  title: string,
  companyName: string,
): number {
  let score = 0;

  try {
    const domain = new URL(url).hostname.toLowerCase();
    const words = getCompanyWords(companyName);

    // TLD peruano
    if (PREFERRED_TLDS.some((tld) => domain.endsWith(tld))) score += 15;

    // Palabras de empresa en dominio
    for (const w of words) {
      if (w.length > 3 && domain.includes(w)) score += 10;
    }

    // Palabras de empresa en título
    if (title) {
      const t = title.toLowerCase();
      for (const w of words) {
        if (w.length > 3 && t.includes(w)) score += 5;
      }
      if (t.includes('oficial') || t.includes('official')) score += 3;
    }

    // HTTPS
    if (url.startsWith('https://')) score += 2;
  } catch {
    // URL inválida
  }

  return score;
}

/**
 * Filtra, de-duplica y puntúa resultados de búsqueda.
 * Retorna los resultados ordenados por score descendente.
 */
export function rankResults(
  results: Array<{ url: string; title: string }>,
  companyName: string,
): Array<{ url: string; title: string; score: number }> {
  const seen = new Set<string>();

  return results
    .filter((r) => {
      if (!r.url || isBlacklisted(r.url)) return false;
      try {
        const domain = new URL(r.url).hostname;
        if (seen.has(domain)) return false;
        seen.add(domain);
        return true;
      } catch {
        return false;
      }
    })
    .map((r) => ({ ...r, score: scoreResult(r.url, r.title, companyName) }))
    .sort((a, b) => b.score - a.score);
}
