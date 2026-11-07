import { fileIo } from '@kit.CoreFileKit';

/** 选择器返回的 URI 里取文件名；取不到时用兜底名。 */
export function pickedFileName(uri: string, fallback: string): string {
  const raw = uri.split('?')[0].split('/').pop() ?? '';
  if (raw === '') { return fallback; }
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
}

/**
 * 系统 http 的 multipart filePath 只接受应用沙箱路径，不接受选择器返回的 file:// URI，
 * 直接传会在发出请求前失败。上传前先复制到缓存目录，用完由调用方 removePickedCopy 删除。
 * 已经是沙箱路径（如拍照结果）时原样返回。
 */
export function copyPickedFile(cacheDir: string, uri: string): string {
  if (!uri.startsWith('file://')) { return uri; }
  const localPath = `${cacheDir}/upload-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
  try { fileIo.copyFileSync(source.fd, localPath); } finally { fileIo.closeSync(source); }
  return localPath;
}

export function removePickedCopy(uri: string, localPath: string): void {
  if (localPath === uri || localPath === '') { return; }
  try { fileIo.unlinkSync(localPath); } catch (_) { /* 缓存文件留给系统回收 */ }
}
