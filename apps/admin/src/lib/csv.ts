/**
 * Serializa un array de objetos a CSV compatible con Excel.
 * - Si el header no se pasa, lo infiere de las keys del primer item.
 * - Usa `;` como separador (default español de Excel).
 * - Escapa comillas y envuelve campos con `;`, `"`, `\n` o `\r`.
 * - Prepende BOM UTF-8 para que Excel respete los acentos.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  opts?: { headers?: (keyof T)[]; separator?: ';' | ',' },
): string {
  const sep = opts?.separator ?? ';';
  if (rows.length === 0 && !opts?.headers) return '﻿';

  const headers = (opts?.headers ?? (Object.keys(rows[0] ?? {}) as (keyof T)[])) as string[];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    const needsQuote = s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r');
    const safe = s.replace(/"/g, '""');
    return needsQuote ? `"${safe}"` : safe;
  };

  const lines: string[] = [];
  lines.push(headers.join(sep));
  for (const row of rows) {
    lines.push(headers.map((h) => escape((row as Record<string, unknown>)[h])).join(sep));
  }
  return '﻿' + lines.join('\n');
}
