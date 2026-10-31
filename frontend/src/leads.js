import Papa from "papaparse";
import * as XLSX from "xlsx";

// Returns { columns: string[], rows: object[] }
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (res) => {
        try {
          resolve(normalizeMatrix(res.data));
        } catch (e) {
          reject(e);
        }
      },
      error: reject,
    });
  });
}

export async function parseXlsxFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  return normalizeMatrix(matrix);
}

// Decide if first row is a header (non-numeric) or data.
function normalizeMatrix(matrix) {
  const rows2d = matrix
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : [String(r ?? "").trim()]))
    .filter((r) => r.some((c) => c !== ""));
  if (rows2d.length === 0) return { columns: [], rows: [] };

  const first = rows2d[0];
  const firstLooksLikeNumbers = first.some((c) => /\d{5,}/.test(c));
  let columns, dataRows;
  if (firstLooksLikeNumbers) {
    columns = first.map((_, i) => (i === 0 ? "number" : i === 1 ? "variable" : `col${i + 1}`));
    dataRows = rows2d;
  } else {
    columns = first.map((c, i) => c || `col${i + 1}`);
    dataRows = rows2d.slice(1);
  }
  const rows = dataRows.map((r) => {
    const o = {};
    columns.forEach((c, i) => (o[c] = r[i] ?? ""));
    return o;
  });
  return { columns, rows };
}

// Parse a manually pasted block: one lead per line, optional "number,variable" / "number<tab>variable".
export function parsePasted(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = lines.map((l) => {
    const parts = l.split(/[,\t]/).map((p) => p.trim());
    return { number: parts[0] || "", variable: parts[1] || "" };
  });
  return { columns: ["number", "variable"], rows };
}

export function digits(s) {
  return String(s ?? "").replace(/[^\d+]/g, "");
}
