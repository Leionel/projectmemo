import { AppError } from "@/lib/api";

/** Plain-text material accepted from Web or native file pickers. DOCX is parsed separately. */
export type PlainMaterialFormat = "TEXT" | "MARKDOWN" | "CSV";
export type PlainMaterial = { name: string; format: PlainMaterialFormat; text: string; limitations: string };

export const PLAIN_MATERIAL_MAX_BYTES = 64 * 1024;
export const MATERIAL_MAX_CHARS = 20_000;

export function plainMaterialFormat(name: string): PlainMaterialFormat | "DOCX" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "DOCX";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "MARKDOWN";
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".txt")) return "TEXT";
  return null;
}

const LIMITATIONS: Record<PlainMaterialFormat, string> = {
  TEXT: "按 UTF-8 纯文本读取；不识别排版、图片或扫描文字。",
  MARKDOWN: "按文本读取，保留 Markdown 标记；不渲染、不执行内嵌内容。",
  CSV: "按普通逗号分隔文本读取，不当作实验指标；不推断表头含义或校验数值口径。",
};

/** Bounded, strict UTF-8 decode; rejects binary payloads instead of guessing. */
export function extractPlainText(bytes: Uint8Array, name: string): PlainMaterial {
  const format = plainMaterialFormat(name);
  if (!format || format === "DOCX") throw new AppError("MATERIAL_FORMAT", "请选择 TXT、Markdown、普通 CSV 或 DOCX 文件", 422);
  if (bytes.byteLength === 0) throw new AppError("MATERIAL_EMPTY", "文件为空，请重新选择", 422);
  if (bytes.byteLength > PLAIN_MATERIAL_MAX_BYTES) throw new AppError("MATERIAL_SIZE_LIMIT", "文本材料需在 64KB 以内", 413);
  if (bytes.includes(0)) throw new AppError("MATERIAL_BINARY", "这个文件不是可读文本，请选择文本文件", 422);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AppError("MATERIAL_ENCODING", "文本不是有效的 UTF-8，请另存为 UTF-8 后重试", 422); }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new AppError("MATERIAL_EMPTY", "文件没有可读正文，请重新选择", 422);
  if (text.length > MATERIAL_MAX_CHARS) throw new AppError("MATERIAL_TEXT_LIMIT", "文本正文超过 " + MATERIAL_MAX_CHARS + " 字，请拆分后导入", 413);
  return { name, format, text, limitations: LIMITATIONS[format] };
}
