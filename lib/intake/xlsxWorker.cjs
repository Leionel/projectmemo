// Isolated XLSX text extraction. No formulas, macros, external links, styles or embedded media.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node Worker runs CommonJS without a TypeScript loader. */
const { parentPort, workerData } = require("node:worker_threads");
const { unzipSync, strFromU8 } = require("fflate");

const MAX_CHARS = 20000, MAX_SHEETS = 10, MAX_ROWS = 500, MAX_COLUMNS = 50, MAX_CELL = 1000;

function decode(value) {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()];
    if (named) return named;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}
function attribute(tag, name) {
  const match = new RegExp("\\b" + name.replace(":", "\\s*:\\s*") + "\\s*=\\s*\"([^\"]*)\"").exec(tag);
  return match ? decode(match[1]) : "";
}
function plain(value) {
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (text.length > MAX_CELL) throw new Error("CELL_LIMIT");
  return text;
}
function collectText(xml) {
  const parts = [];
  for (const match of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) parts.push(decode(match[1]));
  return plain(parts.join(""));
}
function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => collectText(match[1]));
}
function columnIndex(reference) {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase();
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}
function sheetRows(xml, shared) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    // Consume empty, styled cells separately so the next cell's value keeps its own address.
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1], body = cellMatch[2], column = columnIndex(attribute("<c" + attrs + ">", "r"));
      if (!body) continue;
      if (column < 0 || column >= MAX_COLUMNS) throw new Error("COLUMN_LIMIT");
      const type = attribute("<c" + attrs + ">", "t");
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      let value = "";
      if (type === "s") value = /^\d+$/.test(raw.trim()) ? shared[Number(raw)] ?? "" : "";
      else if (type === "inlineStr") value = collectText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "b") value = raw.trim() === "1" ? "TRUE" : raw.trim() === "0" ? "FALSE" : "";
      else value = plain(decode(raw));
      if (value) cells[column] = value;
    }
    const line = Array.from({ length: cells.length }, (_, index) => cells[index] ?? "").join("\t").replace(/\t+$/, "");
    if (line.trim()) rows.push(line);
    if (rows.length > MAX_ROWS) throw new Error("ROW_LIMIT");
  }
  return rows;
}

(async () => {
  let total = 0, count = 0;
  const seen = new Set();
  const bytes = workerData?.schemaVersion === 1 ? workerData.bytes : workerData;
  const wanted = name => name === "[Content_Types].xml" || name === "_rels/.rels" || name === "xl/workbook.xml"
    || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
  const parts = unzipSync(new Uint8Array(bytes), { filter(entry) {
    if (++count > 512 || seen.has(entry.name) || entry.name.includes("..") || entry.name.startsWith("/")) throw new Error("ARCHIVE_LIMIT");
    seen.add(entry.name); total += entry.originalSize;
    if (total > 8 * 1024 * 1024 || entry.originalSize > 4 * 1024 * 1024) throw new Error("ARCHIVE_LIMIT");
    if (/vbaproject|activex|externalLink/i.test(entry.name)) throw new Error("UNSUPPORTED_WORKBOOK");
    return wanted(entry.name);
  } });
  if (!parts["[Content_Types].xml"] || !parts["xl/workbook.xml"]) throw new Error("NOT_XLSX");
  for (const bytes of Object.values(parts)) {
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("UNSUPPORTED_XML");
  }
  const workbook = strFromU8(parts["xl/workbook.xml"]);
  const rels = parts["xl/_rels/workbook.xml.rels"] ? strFromU8(parts["xl/_rels/workbook.xml.rels"]) : "";
  const targets = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attribute(match[0], "Id"), target = attribute(match[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : "xl/" + target);
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = plain(attribute(match[0], "name")).slice(0, 80) || "工作表";
    const target = targets.get(attribute(match[0], "r:id"));
    if (target && parts[target]) sheets.push({ name, target });
  }
  if (!sheets.length || sheets.length > MAX_SHEETS) throw new Error("SHEET_LIMIT");
  const shared = sharedStrings(parts["xl/sharedStrings.xml"] ? strFromU8(parts["xl/sharedStrings.xml"]) : "");
  const sections = [];
  let chars = 0;
  for (const sheet of sheets) {
    const rows = sheetRows(strFromU8(parts[sheet.target]), shared);
    if (!rows.length) continue;
    const section = "工作表：" + sheet.name + "\n" + rows.join("\n");
    chars += section.length;
    if (chars > MAX_CHARS) throw new Error("TEXT_LIMIT");
    sections.push(section);
  }
  const text = sections.join("\n\n").trim();
  if (!text || text.length > MAX_CHARS || Buffer.byteLength(text, "utf8") > 65536) throw new Error("TEXT_LIMIT");
  parentPort.postMessage({ ok: true, text });
})().catch(() => parentPort.postMessage({ ok: false }));
