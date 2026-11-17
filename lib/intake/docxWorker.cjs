// Isolated raw-text extraction. No HTML rendering, file paths, macros, or external resource access.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node Worker runs CommonJS without a TypeScript loader. */
const { parentPort, workerData } = require("node:worker_threads");
const { unzipSync, zipSync, strFromU8 } = require("fflate");
const mammoth = require("mammoth");
(async () => {
  let total = 0, count = 0;
  const seen = new Set();
  const parts = unzipSync(new Uint8Array(workerData), { filter(entry) {
    if (++count > 512 || seen.has(entry.name) || entry.name.includes("..") || entry.name.startsWith("/")) throw new Error("ARCHIVE_LIMIT");
    seen.add(entry.name); total += entry.originalSize;
    if (total > 8 * 1024 * 1024 || entry.originalSize > 4 * 1024 * 1024) throw new Error("ARCHIVE_LIMIT");
    if (/vbaproject|activex/i.test(entry.name)) throw new Error("MACRO_DOCUMENT");
    return entry.name === "[Content_Types].xml" || entry.name === "_rels/.rels" || /^word\/.*\.(xml|rels)$/.test(entry.name);
  } });
  if (!parts["word/document.xml"] || !parts["[Content_Types].xml"]) throw new Error("NOT_DOCX");
  for (const bytes of Object.values(parts)) {
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY|macroEnabled/i.test(xml)) throw new Error("UNSUPPORTED_XML");
  }
  // Repackage bounded XML only: media and embedded binary payloads never reach the document reader.
  const result = await mammoth.extractRawText({ buffer: Buffer.from(zipSync(parts)) });
  const text = result.value.trim();
  if (!text || text.length > 20000 || Buffer.byteLength(text, "utf8") > 65536) throw new Error("TEXT_LIMIT");
  parentPort.postMessage({ ok: true, text });
})().catch(() => parentPort.postMessage({ ok: false }));
