import { getCompanyWords } from './company-name-cleaner';

/** TLDs peruanos tienen prioridad */
const PREFERRED_TLDS = ['.pe', '.com.pe', '.gob.pe', '.org.pe'];

/** Dominios que nunca son la web oficial de una empresa */
const BLACKLIST = [
  // Redes sociales
  'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'youtube.com', 'tiktok.com', 'pinterest.com',
  // Buscadores
  'google.com', 'duckduckgo.com', 'bing.com',
  // Enciclopedias
  'wikipedia.org',
  // Empleo
  'glassdoor.com', 'indeed.com', 'computrabajo.com', 'bumeran.com',
  // Marketplaces
  'mercadolibre.com', 'amazon.com',
  // Noticias / prensa
  'rpp.pe', 'elcomercio.pe', 'gestion.pe', 'larepublica.pe',
  // Directorios / perfiles
  'universidadperu.com', 'yelp.com',
  'sunat.gob.pe', 'waze.com', 'tripadvisor.com',
  'emis.com', 'dnb.com', 'bloomberg.com', 'reuters.com',
  'crunchbase.com', 'zoominfo.com', 'empresite.com',
  'infobel.com', 'guiadeservicios.com.pe', 'paginasamarillas.com.pe',
  'peru-retail.com', 'semana-economica.com',
  'baidu.com', 'zhidao.baidu.com', 'rankia.pe', 'companias.top',
  'delrisco.com.pe', 'entel.pe', 'findglocal.com', 'expat.com',
  'kompass.com', 'dnb.com', 'manta.com', 'trustpilot.com',
  'cajasybancos.com', 'deperu.com', 'telefonos.info',
  'aprendeperu.com', 'perusaber.com',
  // Gobierno (nunca son sitios de empresas privadas)
  'smv.gob.pe', 'sbs.gob.pe', 'bvl.com.pe', 'bcrp.gob.pe',
  'gob.pe', 'congreso.gob.pe', 'mef.gob.pe',
  // Más directorios y agregadores
  'dnb.com', 'hoovers.com', 'owler.com', 'craft.co',
  'ambito.com', 'elperuano.pe', 'andina.pe',
  'bolsadevalores.info', 'marketscreener.com',
  'planetaperu.pe', 'greatplacetowork.com.pe', 'greatplacetowork.com',
  'adepia.com.pe', 'peru21.pe', 'muustack.com',
  'ayudaalcliente.org', 'bancos.guru',
  'cylex.com.pe', 'cylex.com', 'cylex.es',
  'tuugo.com.pe', 'tuugo.com', 'hotfrog.com.pe',
  'infoisinfo.com.pe', 'perucontable.com',
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
 *  - Es homepage (path = "/" o vacío) → +8
 *  - Dominio corto (parece sitio oficial vs directorio) → +5
 *  - Path profundo (parece directorio/perfil) → -5
 */
export function scoreResult(
  url: string,
  title: string,
  companyName: string,
  variants?: string[],
): number {
  let score = 0;

  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    const words = getCompanyWords(companyName);

    // TLD peruano
    if (PREFERRED_TLDS.some((tld) => domain.endsWith(tld))) score += 15;

    // Palabras de empresa en dominio
    for (const w of words) {
      if (w.length > 3 && domain.includes(w)) score += 10;
    }

    // Variantes (acrónimos como BCP, BIP) en dominio → bonus alto
    if (variants) {
      const domainBase = domain.replace('www.', '').split('.')[0];
      for (const v of variants) {
        const vLow = v.toLowerCase();
        if (vLow.length >= 3 && vLow.length <= 6 && domainBase.includes(vLow)) {
          score += 12; // Acronym match is very strong signal
        }
      }
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

    // ── Bonus/penalizaciones por estructura de URL ──

    // Homepage o raíz del sitio → probablemente el sitio oficial
    if (path === '/' || path === '' || /^\/[a-z]{2}(-[A-Z]{2})?(\/)?$/.test(path)) {
      score += 8;
    }

    // Path profundo → probablemente un perfil en directorio o documento
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 3) {
      score -= 5;
    } else if (segments.length >= 2) {
      score -= 2;
    }

    // Gobierno/regulador .gob.pe → penalizar (no son empresas privadas)
    if (domain.endsWith('.gob.pe')) {
      score -= 20;
    }

    // Archivos (PDF, doc) en la URL → penalizar fuertemente
    if (/\.(pdf|doc|docx|xls|xlsx|ppt)$/i.test(path)) {
      score -= 15;
    }

    // URLs con query params largos → probablemente no la homepage oficial
    if (parsed.search.length > 20) {
      score -= 5;
    }

    // Subdominio de login/zonasegura → penalizar (preferir www)
    if (/^(login|zonasegura|auth|secure|app|portal)/.test(domain.replace('www.', ''))) {
      score -= 3;
    }

    // Dominio corto con palabra de empresa → muy probablemente el sitio oficial
    // Ej: viabcp.com, interbank.pe, alicorp.com.pe
    const domainBase = domain.replace('www.', '').split('.')[0];
    if (domainBase.length <= 15 && words.some((w) => w.length > 3 && domainBase.includes(w))) {
      score += 5;
    }
  } catch {
    // URL inválida
  }

  return score;
}

/**
 * Filtra, de-duplica, puntúa y consolida resultados de búsqueda.
 * - Elimina dominios blacklisteados
 * - De-dupa por hostname exacto
 * - Consolida por dominio raíz (prefiere www/root sobre subdominios)
 * - Retorna los resultados ordenados por score descendente
 */
/**
 * Extrae el dominio raíz de un hostname.
 * "bcpzonasegura.viabcp.com" → "viabcp.com"
 * "www.alicorp.com.pe" → "alicorp.com.pe"
 */
function getRootDomain(hostname: string): string {
  const parts = hostname.split('.');
  // .com.pe, .org.pe, .gob.pe → necesitan 3 partes mínimo
  if (parts.length >= 3 && /^(com|org|gob|net|edu)$/.test(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  // .pe, .com → 2 partes
  return parts.slice(-2).join('.');
}

export function rankResults(
  results: Array<{ url: string; title: string }>,
  companyName: string,
  variants?: string[],
): Array<{ url: string; title: string; score: number }> {
  const seen = new Set<string>();

  // Primera pasada: filtrar blacklisted, de-dupar por hostname exacto
  const filtered = results
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
    .map((r) => ({ ...r, score: scoreResult(r.url, r.title, companyName, variants) }))
    .sort((a, b) => b.score - a.score);

  // Segunda pasada: consolidar por dominio raíz
  // Si hay bcpzonasegura.viabcp.com y www.viabcp.com, quédate con el mejor
  // y normaliza la URL al homepage del dominio raíz (https://www.viabcp.com/)
  const rootDomainMap = new Map<string, typeof filtered[0]>();
  for (const r of filtered) {
    try {
      const parsed = new URL(r.url);
      const hostname = parsed.hostname;
      const root = getRootDomain(hostname);
      const existing = rootDomainMap.get(root);

      // Calcular URL normalizada al homepage del dominio raíz
      const normalizedUrl = `https://www.${root}/`;
      // Re-calcular score con la URL normalizada (homepage)
      const normalizedScore = scoreResult(normalizedUrl, r.title, companyName, variants);

      if (!existing) {
        // Usar la URL normalizada al homepage con el mejor score
        const bestScore = Math.max(r.score, normalizedScore);
        rootDomainMap.set(root, { url: normalizedUrl, title: r.title, score: bestScore });
      } else {
        // Merge: tomar el mejor score entre todos los resultados del mismo dominio
        const bestScore = Math.max(existing.score, r.score, normalizedScore);
        // Preferir el título más descriptivo (más largo)
        const bestTitle = (r.title && r.title.length > (existing.title?.length || 0)) ? r.title : existing.title;
        rootDomainMap.set(root, { url: normalizedUrl, title: bestTitle, score: bestScore });
      }
    } catch {
      // ignorar
    }
  }

  return [...rootDomainMap.values()].sort((a, b) => b.score - a.score);
}
