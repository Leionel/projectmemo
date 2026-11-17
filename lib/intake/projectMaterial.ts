import { parse } from "csv-parse/sync";
import { AppError } from "@/lib/api";

/** Plain project material, independent of experimental metric parsing. Original cells stay strings. */
export function parseProjectMaterial(raw: string, name?: string) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > 20000 || Buffer.byteLength(raw, "utf8") > 65536)
    throw new AppError("MATERIAL_SIZE_LIMIT", "材料需在 2 万字、64KB 以内", 422);
  if (/[\u0000\uFFFD]/u.test(text)) throw new AppError("MATERIAL_ENCODING", "请使用 UTF-8 编码的文本文件", 422);
  const extension = name?.split(".").at(-1)?.toLowerCase();
  if (name && !["txt", "md", "csv", "docx"].includes(extension ?? ""))
    throw new AppError("MATERIAL_FORMAT", "支持 TXT、Markdown、普通 CSV 和 DOCX 提取文本", 422);
  const format = extension === "csv" ? "CSV" : extension === "md" ? "MARKDOWN" : extension === "docx" ? "DOCX_TEXT" : "TEXT";
  let rows: number | undefined, columns: number | undefined;
  if (format === "CSV") {
    try {
      const cells = parse(text, { bom: true, skip_empty_lines: true, max_record_size: 8192 }) as string[][];
      columns = cells[0]?.length ?? 0; rows = Math.max(0, cells.length - 1);
      if (!columns || columns > 40 || rows > 200 || cells[0].some(cell => !cell.trim())) throw new Error("TABLE_LIMIT");
    } catch { throw new AppError("MATERIAL_CSV_INVALID", "CSV 需列数一致、首行有列名，最多 200 行数据、40 列", 422); }
  }
  return { text, format, name: name ?? null, characters: text.length, ...(rows !== undefined ? { rows, columns } : {}) };
}
