export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === '"') {
      if (value || closed) throw new Error("Unexpected quote in CSV. Quote the entire value.");
      quoted = true;
    } else if (c === ",") { row.push(value); value = ""; closed = false; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; value = ""; closed = false;
    } else {
      if (closed && c.trim()) throw new Error("Unexpected text after a quoted CSV value.");
      if (!closed) value += c;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
  const headers = rows.shift()?.map((cell) => cell.trim());
  if (!headers?.length || headers.some((cell) => !cell)) throw new Error("CSV needs a non-empty header row.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");
  if (!rows.length) throw new Error("CSV has no data rows.");
  if (rows.length > 1000) throw new Error("Import up to 1,000 rows per file.");
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Data row ${index + 1} has ${cells.length} values; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i].trim()]));
  });
}

export function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((row) => row.map((cell) => {
    const safe = /^[\s]*[=+\-@]/.test(cell) ? `'${cell}` : cell;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
