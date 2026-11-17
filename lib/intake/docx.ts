import path from "node:path";
import { Worker } from "node:worker_threads";
import { AppError } from "@/lib/api";

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new AppError("DOCX_SIZE_LIMIT", "DOCX 文件需在 2MB 以内", 422);
  return new Promise((resolve, reject) => {
    let settled = false;
    // Turbopack adds worker metadata by spreading workerData. An envelope preserves the typed
    // array's length/prototype instead of turning it into a plain object with numeric keys.
    const worker = new Worker(path.resolve("lib/intake/docxWorker.cjs"), { workerData: { schemaVersion: 1, bytes },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    const failed = () => new AppError("DOCX_EXTRACTION_FAILED", "DOCX 无法提取文字：请检查文件是否损坏、加密、含宏或内容过大；提取后需在 2 万字以内", 422);
    const timer = setTimeout(() => { settled = true; void worker.terminate(); reject(new AppError("DOCX_TIMEOUT", "DOCX 解析超时，请缩小文件后重试", 422)); }, 5000);
    worker.once("message", (message: { ok?: boolean; text?: string }) => {
      settled = true; clearTimeout(timer); void worker.terminate();
      if (message.ok && typeof message.text === "string") resolve(message.text); else reject(failed());
    });
    worker.once("error", () => { settled = true; clearTimeout(timer); void worker.terminate(); reject(failed()); });
    worker.once("exit", () => { clearTimeout(timer); if (!settled) reject(failed()); });
  });
}
