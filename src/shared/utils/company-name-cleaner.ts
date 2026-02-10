/**
 * Limpia el nombre de una empresa peruana removiendo sufijos legales.
 * "ALICORP S.A.A." → "ALICORP"
 * "BANCO DE CREDITO DEL PERU S.A.C." → "BANCO DE CREDITO DEL PERU"
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
  const prefixes = ['EMPRESA', 'COMPANIA', 'COMPAÑIA', 'CORPORACION', 'GRUPO'];
  for (const p of prefixes) {
    clean = clean.replace(new RegExp('^' + p + '\\b\\s*', 'gi'), '');
  }

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
