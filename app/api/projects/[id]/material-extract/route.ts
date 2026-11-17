import { authenticateUser } from "@/lib/auth/guard";
import { AppError, apiError } from "@/lib/api";
import { assertOwner } from "@/lib/mission/repository";
import { extractDocxText } from "@/lib/intake/docx";
import { isFeatureEnabled } from "@/lib/config/features";
export const runtime = "nodejs";

/** Read-only parser preview. No upload storage, model, or Mission is created. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request), { id } = await context.params;
    await assertOwner(user.id, id);
    if (!isFeatureEnabled("MISSION_V2_ENABLED", false)) throw new AppError("MISSION_V2_DISABLED", "持续成果试验尚未启用", 409);
    const limit = 2 * 1024 * 1024 + 65536;
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new AppError("DOCX_FORMAT", "请以文件形式上传 DOCX", 422);
    if (Number(request.headers.get("content-length")) > limit || !request.body) throw new AppError("DOCX_SIZE_LIMIT", "DOCX 文件需在 2MB 以内", 413);
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length;
        if (length > limit) { await reader.cancel(); throw new AppError("DOCX_SIZE_LIMIT", "DOCX 文件需在 2MB 以内", 413); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    let data: FormData;
    try { data = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
    catch { throw new AppError("DOCX_FORMAT", "文件上传内容不完整，请重新选择文件", 422); }
    const file = data.get("file");
    if (!(file instanceof File) || !/\.docx$/i.test(file.name) || file.name.length > 180) throw new AppError("DOCX_FORMAT", "请选择 DOCX 文件；暂不支持 DOC、DOCM 或扫描件", 422);
    const text = await extractDocxText(new Uint8Array(await file.arrayBuffer()));
    return Response.json({ text, name: file.name, format: "DOCX_TEXT", limitations: "仅提取正文和表格文字，不保留排版、图片或嵌入附件" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
