import fs from "fs";
import path from "path";
import crypto from "crypto";

const DEFAULT_STORAGE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "storage", "attachments");

export interface StoredFile {
  storageKey: string;
  absolutePath: string;
  size: number;
  sha256: string;
}

export function computeFileSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function getAttachmentStorageDir(): string {
  const dir = path.resolve(process.env.ATTACHMENT_DIR || DEFAULT_STORAGE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9.\-_ \u4e00-\u9fa5]/g, "_").slice(0, 120);
}

export async function saveFileToStorage(projectId: string, fileName: string, buffer: Buffer): Promise<StoredFile> {
  const storageDir = getAttachmentStorageDir();
  const sha256 = computeFileSha256(buffer);
  const cleanName = sanitizeFileName(fileName);
  const ext = path.extname(cleanName) || ".bin";
  const uniqueKey = `${projectId}_${sha256.slice(0, 12)}_${crypto.randomUUID()}${ext}`;
  const absolutePath = path.join(storageDir, uniqueKey);

  // 防止路径穿越
  const relativePath = path.relative(storageDir, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid storage path");
  }

  // 先写同命名空间的临时文件再改名：磁盘写满或进程被杀时不会留下半截原件。
  const temporaryPath = `${absolutePath}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, buffer);
    await fs.promises.rename(temporaryPath, absolutePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    storageKey: uniqueKey,
    absolutePath,
    size: buffer.length,
    sha256,
  };
}

export async function readAttachmentFile(storageKey: string): Promise<Buffer> {
  const storageDir = getAttachmentStorageDir();
  const absolutePath = path.join(storageDir, path.basename(storageKey));
  return fs.promises.readFile(absolutePath);
}

export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  const storageDir = getAttachmentStorageDir();
  const absolutePath = path.join(storageDir, path.basename(storageKey));
  await fs.promises.rm(absolutePath, { force: true });
}

// 上传进程在文件落盘后、数据库提交前崩溃时，文件仍属于原项目的存储命名空间。
export async function listProjectAttachmentFiles(projectId: string): Promise<string[]> {
  return (await fs.promises.readdir(getAttachmentStorageDir())).filter(name => name.startsWith(`${projectId}_`));
}
