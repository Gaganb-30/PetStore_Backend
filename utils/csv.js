/**
 * Minimal, dependency-free CSV reader/writer.
 *
 * Written by hand rather than pulled from npm because product import/export is
 * a small, well-defined surface and this keeps the deployment footprint (and
 * the supply-chain surface) smaller. Handles the parts that actually bite:
 * quoted fields, embedded commas, embedded newlines and escaped quotes ("").
 */

/**
 * Parse a CSV string into an array of row objects keyed by the header row.
 * @param {string} text
 * @returns {Array<Record<string,string>>}
 */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel loves adding one and it corrupts the first header
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }  // escaped quote
        else inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }

  // Flush the trailing field/row (files often lack a final newline)
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((cell) => cell.trim() !== ''))   // skip blank lines
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
};

/** Quote a single CSV cell when it contains a delimiter, quote or newline */
const quote = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

/**
 * Serialise an array of objects to CSV.
 * @param {Array<Record<string, any>>} rows
 * @param {string[]} [headers] Column order; inferred from the first row if omitted
 */
export const toCsv = (rows, headers) => {
  if (!rows.length) return (headers || []).join(',');
  const cols = headers || Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const row of rows) {
    lines.push(cols.map((c) => quote(row[c])).join(','));
  }
  return lines.join('\n');
};
