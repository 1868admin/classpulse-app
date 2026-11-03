import * as XLSX from 'xlsx';
import { downloadFile, toCSV } from './csv.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const norm = (value) => String(value ?? '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');

export function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const pad = (value) => String(value).padStart(2, '0');

// Excel stores dates as serial numbers; convert without any time-zone shift.
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return String(value).trim();
}

export function excelDateToIso(value) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${String(parsed.y).padStart(4, '0')}-${pad(parsed.m)}-${pad(parsed.d)}` : '';
  }
  return cellText(value);
}

/** Reads every worksheet into a grid of rows, keeping blank rows so spreadsheet row numbers stay accurate. */
export async function readWorkbook(file) {
  if (!file) throw new Error('Choose a spreadsheet to upload.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('The file is larger than 10 MB. Split it into smaller files.');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Upload an Excel (.xlsx) or CSV (.csv) file.');
  const isCsv = /\.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }),
  }));
  if (!sheets.length) throw new Error('The workbook does not contain a worksheet.');
  return sheets;
}

/** Turns a grid into row objects using header aliases. Each object keeps its spreadsheet row in `__row`. */
export function gridToObjects(rows, aliases, dateFields = []) {
  const headerIndex = rows.findIndex((row) => row.filter((cell) =>
    Object.values(aliases).some((list) => list.includes(norm(cell)))).length >= 2);
  if (headerIndex < 0) throw new Error('The header row was not recognised. Download a fresh template and keep its column headings.');
  const fieldByColumn = rows[headerIndex].map((header) =>
    Object.entries(aliases).find(([, list]) => list.includes(norm(header)))?.[0] || '');
  const objects = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const object = { __row: index + 1 };
    fieldByColumn.forEach((field, column) => {
      if (!field) return;
      object[field] = dateFields.includes(field) ? excelDateToIso(rows[index][column]) : cellText(rows[index][column]);
    });
    if (Object.entries(object).some(([key, value]) => key !== '__row' && String(value || '').trim())) objects.push(object);
  }
  return objects;
}

export function downloadCsv(filename, headers, rows) {
  downloadFile(filename, `\uFEFF${toCSV(headers, rows)}`);
}

export function downloadIssueReport(filename, issues) {
  downloadCsv(filename, ['Spreadsheet row', 'Column', 'Reference', 'Error'],
    issues.map((issue) => [issue.row || '', issue.column || '', issue.reference || '', issue.message]));
}

export function downloadWorkbookBuffer(filename, buffer) {
  downloadFile(filename, buffer, XLSX_MIME);
}
