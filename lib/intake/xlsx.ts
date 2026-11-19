import path from "node:path";
import { Worker } from "node:worker_threads";
import { AppError } from "@/lib/api";

/** Isolated XLSX extraction: reads cell text only; never evaluates formulas or opens macros/media. */
export async function extractXlsxText(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new AppError("XLSX_SIZE_LIMIT", "XLSX 文件需在 2MB 以内", 422);
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(path.resolve("lib/intake/xlsxWorker.cjs"), { workerData: { schemaVersion: 1, bytes },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    const failed = () => new AppError("XLSX_EXTRACTION_FAILED", "XLSX 无法提取文字：请检查文件是否损坏、加密、含宏或内容过大；提取后需在 2 万字以内", 422);
    const timer = setTimeout(() => { settled = true; void worker.terminate(); reject(new AppError("XLSX_TIMEOUT", "XLSX 解析超时，请缩小文件后重试", 422)); }, 5000);
    worker.once("message", (message: { ok?: boolean; text?: string }) => {
      settled = true; clearTimeout(timer); void worker.terminate();
      if (message.ok && typeof message.text === "string") resolve(message.text); else reject(failed());
    });
    worker.once("error", () => { settled = true; clearTimeout(timer); void worker.terminate(); reject(failed()); });
    worker.once("exit", () => { clearTimeout(timer); if (!settled) reject(failed()); });
  });
}
