import { Attachment } from '../models/Attachment';

export function attachmentFilePath(projectId: string, attachmentId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
}

export function attachmentPreviewKind(mimeType: string): string {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'].includes(mimeType.toLowerCase())) return 'image';
  if (mimeType.toLowerCase() === 'application/pdf') return 'pdf';
  return 'file';
}

export function attachmentStatus(item: Attachment): string {
  if (item.extractionStatus === 'SUCCESS') return '已提取文本';
  if (item.extractionStatus === 'NEEDS_OCR') return '待提取文字 · 原件可查看';
  if (item.extractionStatus === 'FAILED') return '提取失败 · 原件可查看';
  return '处理中 · 原件可查看';
}

export function attachmentSize(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

export function attachmentSaveName(name: string): string {
  const safe = name.replace(/[\\/\x00-\x1f:*?"<>|]/g, '_').trim();
  return safe === '' || safe === '.' || safe === '..' ? '附件原件' : safe;
}
