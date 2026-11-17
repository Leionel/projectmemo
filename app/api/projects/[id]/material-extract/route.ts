import { authenticateUser } from "@/lib/auth/guard";
import { AppError, apiError } from "@/lib/api";
import { assertOwner } from "@/lib/mission/repository";
import { extractDocxText } from "@/lib/intake/docx";
import { extractPlainText, plainMaterialFormat } from "@/lib/intake/plainText";
import { isFeatureEnabled } from "@/lib/config/features";
export const runtime = "nodejs";

/**
 * Read-only parser preview for native/Web pickers. Never stores the upload, calls a model or creates a
 * Mission; the caller must preview, confirm the target Mission and then save the returned text.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request), { id } = await context.params;
    await assertOwner(user.id, id);
    if (!isFeatureEnabled("MISSION_V2_ENABLED", false)) throw new AppError("MISSION_V2_DISABLED", "持续成果试验尚未启用", 409);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new AppError("MATERIAL_FORMAT", "请以文件形式上传材料", 422);
    const limit = 2 * 1024 * 1024 + 65536;
    if (Number(request.headers.get("content-length")) > limit || !request.body) throw new AppError("MATERIAL_SIZE_LIMIT", "材料文件过大", 413);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length;
        if (length > limit) { await reader.cancel(); throw new AppError("MATERIAL_SIZE_LIMIT", "材料文件过大", 413); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    let data: FormData;
    try { data = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
    catch { throw new AppError("MATERIAL_FORMAT", "文件上传内容不完整，请重新选择文件", 422); }
    const file = data.get("file");
    if (!(file instanceof File) || file.name.length > 180) throw new AppError("MATERIAL_FORMAT", "请选择一个材料文件", 422);
    const format = plainMaterialFormat(file.name);
    if (!format) throw new AppError("MATERIAL_FORMAT", "请选择 TXT、Markdown、普通 CSV 或 DOCX 文件", 422);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (format === "DOCX") {
      const text = await extractDocxText(bytes);
      if (text.length > 20_000) throw new AppError("MATERIAL_TEXT_LIMIT", "Word 正文超过 20,000 字，请拆分后导入", 413);
      return Response.json({ text, name: file.name, format: "DOCX_TEXT", limitations: "仅提取正文和表格文字，不保留排版、图片或嵌入附件" },
        { headers: { "Cache-Control": "private, no-store" } });
    }
    const parsed = extractPlainText(bytes, file.name);
    return Response.json(parsed, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
