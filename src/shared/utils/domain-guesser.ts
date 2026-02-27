/**
 * Adivina dominios web probables para empresas peruanas conocidas.
 *
 * Especialmente útil para entidades del gobierno (MINSA, MEF, etc.)
 * y empresas grandes con siglas conocidas.
 *
 * Flujo:
 * 1. Primero chequea el mapa de dominios conocidos (siglas y nombres).
 * 2. Luego intenta heurísticas: ministerio → sigla.gob.pe, etc.
 * 3. Finalmente genera combinaciones con dominios peruanos comunes.
 *
 * @returns Array de dominios ordenados por probabilidad (máx ~5).
 */
export function guessPeruvianDomain(name: string): string[] {
  const upper = name.toUpperCase().trim();
  const domains: string[] = [];

  // ── 1. Mapa de entidades peruanas conocidas ──
  // Clave: fragmento que debe estar presente en el nombre
  // Valor: dominio(s) conocidos
  const KNOWN_DOMAINS: Record<string, string[]> = {
    // Ministerios
    'MINISTERIO DE SALUD': ['minsa.gob.pe', 'gob.pe/minsa'],
    'MINISTERIO DE EDUCACION': ['minedu.gob.pe'],
    'MINISTERIO DE ECONOMIA': ['mef.gob.pe'],
    'MINISTERIO DE DEFENSA': ['mindef.gob.pe'],
    'MINISTERIO DE TRABAJO': ['trabajo.gob.pe', 'mtpe.gob.pe'],
    'MINISTERIO DE ENERGIA': ['minem.gob.pe'],
    'MINISTERIO DE AGRICULTURA': ['midagri.gob.pe'],
    'MINISTERIO DE TRANSPORTES': ['mtc.gob.pe'],
    'MINISTERIO DE VIVIENDA': ['vivienda.gob.pe'],
    'MINISTERIO DE PRODUCCION': ['produce.gob.pe'],
    'MINISTERIO DE COMERCIO EXTERIOR': ['mincetur.gob.pe'],
    'MINISTERIO DE JUSTICIA': ['minjus.gob.pe'],
    'MINISTERIO DE CULTURA': ['cultura.gob.pe'],
    'MINISTERIO DE AMBIENTE': ['minam.gob.pe'],
    'MINISTERIO DE DESARROLLO': ['midis.gob.pe'],
    'MINISTERIO DE RELACIONES': ['rree.gob.pe'],
    'MINISTERIO DEL INTERIOR': ['mininter.gob.pe'],
    'MINISTERIO DE LA MUJER': ['mimp.gob.pe'],
    'MINISTERIO PUBLICO': ['mpfn.gob.pe', 'fiscalia.gob.pe'],

    // Entidades gubernamentales
    'PODER JUDICIAL': ['pj.gob.pe'],
    'CONGRESO': ['congreso.gob.pe'],
    'CONTRALORIA': ['contraloria.gob.pe'],
    'DEFENSORIA': ['defensoria.gob.pe'],
    'SUNAT': ['sunat.gob.pe'],
    'RENIEC': ['reniec.gob.pe'],
    'ESSALUD': ['essalud.gob.pe'],
    'SUNARP': ['sunarp.gob.pe'],
    'INDECOPI': ['indecopi.gob.pe'],
    'OSINERGMIN': ['osinergmin.gob.pe'],
    'OSIPTEL': ['osiptel.gob.pe'],
    'ONPE': ['onpe.gob.pe'],
    'BANCO CENTRAL': ['bcrp.gob.pe'],
    'BANCO DE LA NACION': ['bn.com.pe'],
    'POLICIA NACIONAL': ['policia.gob.pe'],
    'EJERCITO': ['ejercito.mil.pe'],
    'MARINA DE GUERRA': ['marina.mil.pe'],
    'FUERZA AEREA': ['fap.mil.pe'],
    'SEGURO SOCIAL DE SALUD': ['essalud.gob.pe'],

    // Municipalidades
    'MUNICIPALIDAD METROPOLITANA DE LIMA': ['munlima.gob.pe'],
    'MUNICIPALIDAD DE LIMA': ['munlima.gob.pe'],

    // Universidades
    'UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS': ['unmsm.edu.pe'],
    'UNIVERSIDAD NACIONAL DE INGENIERIA': ['uni.edu.pe'],
    'UNIVERSIDAD CESAR VALLEJO': ['ucv.edu.pe'],
    'PONTIFICIA UNIVERSIDAD CATOLICA': ['pucp.edu.pe'],
    'UNIVERSIDAD DE LIMA': ['ulima.edu.pe'],
    'UNIVERSIDAD DEL PACIFICO': ['up.edu.pe'],
    'UNIVERSIDAD PERUANA DE CIENCIAS APLICADAS': ['upc.edu.pe'],
    'UNIVERSIDAD SAN MARTIN DE PORRES': ['usmp.edu.pe'],
    'UNIVERSIDAD CONTINENTAL': ['ucontinental.edu.pe'],
    'UNIVERSIDAD ESAN': ['esan.edu.pe'],

    // Empresas grandes conocidas
    'ALICORP': ['alicorp.com.pe'],
    'INTERBANK': ['interbank.pe'],
    'BANCO DE CREDITO': ['viabcp.com'],
    'BBVA': ['bbva.pe'],
    'SCOTIABANK': ['scotiabank.com.pe'],
    'TELEFONICA': ['telefonica.com.pe', 'movistar.com.pe'],
    'CLARO': ['claro.com.pe'],
    'ENTEL': ['entel.pe'],
    'BITEL': ['bitel.com.pe'],
    'FALABELLA': ['falabella.com.pe'],
    'RIPLEY': ['ripley.com.pe'],
    'BACKUS': ['backus.pe'],
    'GLORIA': ['grupogloria.com'],
    'INKAFARMA': ['inkafarma.pe'],
    'MIFARMA': ['mifarma.com.pe'],
    'CENCOSUD': ['cencosud.com.pe'],
    'SUPERMERCADOS PERUANOS': ['spsa.com.pe', 'plaza-vea.com.pe'],
    'SOUTHERN': ['southernperu.com'],
    'ANTAMINA': ['antamina.com'],
    'VOLCAN': ['volcan.com.pe'],
    'BUENAVENTURA': ['buenaventura.com'],
    'CERRO VERDE': ['cerroverde.pe'],
    'CAMPOSOL': ['camposol.com.pe'],
    'PRIMAX': ['primax.com.pe'],
    'REPSOL': ['repsol.pe'],
    'LATAM': ['latam.com'],
    'FERREYROS': ['ferreyros.com.pe'],
    'GRAÑA Y MONTERO': ['gym.com.pe'],
    'COSAPI': ['cosapi.com.pe'],
    'CREDICORP': ['credicorp.com.pe'],
    'RIMAC SEGUROS': ['rimac.com'],
    'MAPFRE': ['mapfre.com.pe'],
    'PACIFICO SEGUROS': ['pacificoseguros.com'],
    'INTERCORP': ['intercorp.com.pe'],
    'BELCORP': ['belcorp.biz'],
    'YANBAL': ['yanbal.com'],
    'AJE GROUP': ['ajegroup.com'],
    'TOTTUS': ['tottus.com.pe'],
    'WONG': ['wong.pe'],
    'METRO': ['metro.pe'],
  };

  // Buscar coincidencias en el mapa (match parcial)
  for (const [key, values] of Object.entries(KNOWN_DOMAINS)) {
    if (upper.includes(key) || key.includes(upper)) {
      domains.push(...values);
    }
  }

  if (domains.length > 0) {
    return [...new Set(domains)].slice(0, 5);
  }

  // ── 2. Heurísticas por tipo de entidad ──

  // Normalizar nombre (quitar acentos)
  const norm = upper
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Gobierno: MINISTERIO DE X → generar sigla + .gob.pe
  if (norm.startsWith('MINISTERIO')) {
    const words = norm.replace(/^MINISTERIO\s+(DE\s+)?/i, '').split(/\s+/);
    const sigla = words
      .filter((w) => !['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E'].includes(w))
      .map((w) => w[0])
      .join('')
      .toLowerCase();
    if (sigla.length >= 3) {
      domains.push(`${sigla}.gob.pe`);
      // También variante min + primera consonante
      domains.push(`min${sigla}.gob.pe`);
    }
  }

  // Municipalidades: MUNICIPALIDAD PROVINCIAL DE X → munix.gob.pe
  if (norm.includes('MUNICIPALIDAD')) {
    const after = norm.replace(/MUNICIPALIDAD\s+(PROVINCIAL|DISTRITAL|METROPOLITANA)?\s*(DE\s+)?/i, '').trim();
    const slug = after.toLowerCase().split(/\s+/).slice(0, 2).join('');
    if (slug.length >= 3) {
      domains.push(`muni${slug}.gob.pe`);
    }
  }

  // SAC / SA / empresas: intentar con nombre limpio + sufijos comunes
  const cleanWords = norm
    .replace(/\bS\s*A\s*C?\b|\bS\s*R\s*L\b|\bE\s*I\s*R\s*L\b|\bS\s*A\s*A?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'peru'].includes(w))
    .slice(0, 2);

  if (cleanWords.length > 0) {
    const slug = cleanWords.join('');
    // Solo agregar heurísticas si no hay match conocido
    if (domains.length === 0) {
      domains.push(`${slug}.com.pe`);
      domains.push(`${slug}.pe`);
      if (cleanWords.length === 1 && cleanWords[0].length >= 4) {
        domains.push(`${cleanWords[0]}.com`);
      }
    }
  }

  return [...new Set(domains)].slice(0, 5);
}
