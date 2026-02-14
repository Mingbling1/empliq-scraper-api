/**
 * Limpia el nombre de una empresa peruana removiendo sufijos legales.
 * "ALICORP S.A.A." → "ALICORP"
 * "BANCO DE CREDITO DEL PERU S.A.C." → "BANCO DE CREDITO"
 * "BBVA CONTINENTAL" → "BBVA CONTINENTAL"
 */
export function cleanCompanyName(name: string): string {
  let clean = name.toUpperCase();

  // Sufijos legales peruanos (regex-safe)
  const legalSuffixes = [
    'S\\.?A\\.?C\\.?',
    'S\\.?A\\.?A\\.?',
    'S\\.?R\\.?L\\.?',
    'E\\.?I\\.?R\\.?L\\.?',
    'S\\.?C\\.?R\\.?L\\.?',
    'S\\.?C\\.?',
    'S\\.?A\\.?',
    'SOCIEDAD ANONIMA CERRADA',
    'SOCIEDAD ANONIMA ABIERTA',
    'SOCIEDAD ANONIMA',
    'SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA',
    'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
  ];

  for (const suffix of legalSuffixes) {
    clean = clean.replace(new RegExp('\\b' + suffix + '\\b', 'gi'), '');
  }

  // Prefijos genéricos
  const prefixes = [
    'EMPRESA', 'COMPANIA', 'COMPAÑIA', 'CORPORACION', 'GRUPO',
    // Gobierno: quitar prefijos de área/departamento que no aportan a la búsqueda
    'DIRECCION', 'DIRECCIÓN', 'OFICINA', 'UNIDAD', 'DIVISION', 'DIVISIÓN',
    'DEPARTAMENTO', 'GERENCIA', 'JEFATURA', 'SUBGERENCIA', 'SUBDIRECCIÓN',
    'SUBDIRECCION', 'AREA', 'ÁREA',
  ];
  for (const p of prefixes) {
    clean = clean.replace(new RegExp('^' + p + '\\b\\s*(DE\\s+)?', 'gi'), '');
  }

  // Quitar sufijos geográficos genéricos ("DEL PERU", "DEL PERÚ", "PERU", "PERÚ")
  // Estos alargan la query sin aportar al matching del dominio
  clean = clean.replace(/\b(DEL\s+)?PER[UÚ]\b/gi, '');

  // Quitar caracteres especiales (mantener letras, números, espacios, &, -)
  clean = clean.replace(/[^\w\sáéíóúñÁÉÍÓÚÑ&-]/g, ' ');

  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Extrae las palabras significativas del nombre de una empresa.
 * Filtra palabras cortas (≤2 chars) que no aportan al matching.
 */
export function getCompanyWords(companyName: string): string[] {
  return cleanCompanyName(companyName)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Genera variantes de búsqueda para una empresa.
 * Incluye siglas (para nombres largos), versiones cortas, etc.
 *
 * "BANCO DE CREDITO DEL PERU S.A." → ["BANCO CREDITO", "BCP", "BANCO"]
 * "INTERBANK" → ["INTERBANK"]
 * "ALICORP S.A.A." → ["ALICORP"]
 * "BANCO INTERNACIONAL DEL PERU" → ["BANCO INTERNACIONAL", "BIP"]
 */
export function generateSearchVariants(companyName: string): string[] {
  const clean = cleanCompanyName(companyName);
  const variants: string[] = [clean];

  // Quitar guiones y caracteres sueltos para las variantes
  const normalized = clean.replace(/[-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized !== clean) {
    variants[0] = normalized;
  }

  // ── Acrónimo: generar ANTES de quitar sufijos geográficos ──
  // Para el acrónimo usamos el nombre con los sufijos legales quitados
  // pero CON "DEL PERU" todavía presente, para que
  // "BANCO DE CREDITO DEL PERU" → B(anco) C(rédito) P(erú) = BCP
  let nameForAcronym = companyName.toUpperCase();
  // Quitar solo sufijos legales (SAC, SAA, etc.) pero mantener geo
  const legalOnly = [
    'S\\.?A\\.?C\\.?', 'S\\.?A\\.?A\\.?', 'S\\.?R\\.?L\\.?',
    'E\\.?I\\.?R\\.?L\\.?', 'S\\.?C\\.?R\\.?L\\.?', 'S\\.?C\\.?', 'S\\.?A\\.?',
    'SOCIEDAD ANONIMA CERRADA', 'SOCIEDAD ANONIMA ABIERTA', 'SOCIEDAD ANONIMA',
    'SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA',
    'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
  ];
  for (const suffix of legalOnly) {
    nameForAcronym = nameForAcronym.replace(new RegExp('\\b' + suffix + '\\b', 'gi'), '');
  }
  // Quitar prefijos genéricos
  const prefixes = ['EMPRESA', 'COMPANIA', 'COMPAÑIA', 'CORPORACION', 'GRUPO'];
  for (const p of prefixes) {
    nameForAcronym = nameForAcronym.replace(new RegExp('^' + p + '\\b\\s*', 'gi'), '');
  }
  nameForAcronym = nameForAcronym.replace(/[^\w\sáéíóúñÁÉÍÓÚÑ]/g, ' ').replace(/\s+/g, ' ').trim();

  // Para el acrónimo: tomar primera letra de cada palabra significativa
  // Excluir SOLO artículos, conjunciones y preposiciones que no aportan a siglas
  // "DE" se excluye, pero "CREDITO" y "PERU" se mantienen → BCP
  const acronymExclude = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'con', 'para', 'por', 'a', 'al']);
  const acronymWords = nameForAcronym
    .split(/\s+/)
    .filter((w) => w.length > 0 && !acronymExclude.has(w.toLowerCase()));

  if (acronymWords.length >= 2) {
    const acronym = acronymWords
      .map((w) => w[0])
      .join('')
      .toUpperCase();

    if (acronym.length >= 3 && acronym.length <= 6) {
      variants.push(acronym);
    }
  }

  // ── Variante sin preposiciones (para la query principal) ──
  // "BANCO DE CREDITO" → "BANCO CREDITO" (más natural para buscar)
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  const searchStopwords = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'con', 'para', 'por']);
  const significantWords = words.filter(
    (w) => !searchStopwords.has(w.toLowerCase()) && w.length > 1,
  );

  // Nombre completo con nombre después del guion
  // ej: BANCO INTERNACIONAL - INTERBANK → INTERBANK
  const dashParts = clean.split(/\s*[-–—]\s*/);
  if (dashParts.length > 1) {
    for (const part of dashParts) {
      const trimmed = part.trim();
      if (trimmed.length >= 3 && !variants.includes(trimmed)) {
        variants.push(trimmed);
      }
    }
  }

  // Primera palabra larga como último recurso
  // PERO no si es una palabra genérica de industria (banco, seguros, grupo, etc.)
  const genericWords = new Set(['banco', 'seguros', 'grupo', 'industria', 'servicios', 'empresa', 'corporacion', 'compania', 'inversiones', 'consultora', 'constructora', 'comercial', 'nacional', 'internacional', 'general', 'peruana', 'lima', 'global']);
  if (significantWords.length >= 2 && significantWords[0].length >= 5) {
    if (!variants.includes(significantWords[0]) && !genericWords.has(significantWords[0].toLowerCase())) {
      variants.push(significantWords[0]);
    }
  }

  return [...new Set(variants)];
}
