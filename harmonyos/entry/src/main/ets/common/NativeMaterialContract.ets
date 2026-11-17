export type NativeMaterialFormat = 'TEXT' | 'MARKDOWN' | 'CSV' | 'DOCX' | 'UNSUPPORTED';

export const NATIVE_MATERIAL_MAX_CHARS: number = 20000;
export const NATIVE_TEXT_MAX_BYTES: number = 64 * 1024;
export const NATIVE_DOCX_MAX_BYTES: number = 2 * 1024 * 1024;

export function nativeMaterialFormat(fileName: string): NativeMaterialFormat {
  const name = fileName.trim().toLowerCase();
  if (name.endsWith('.docx')) return 'DOCX';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'MARKDOWN';
  if (name.endsWith('.csv')) return 'CSV';
  if (name.endsWith('.txt')) return 'TEXT';
  return 'UNSUPPORTED';
}

export function nativeMaterialMime(format: NativeMaterialFormat): string {
  if (format === 'DOCX') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (format === 'MARKDOWN') return 'text/markdown';
  if (format === 'CSV') return 'text/csv';
  if (format === 'TEXT') return 'text/plain';
  return '';
}

export function nativeMaterialLimit(format: NativeMaterialFormat): number {
  return format === 'DOCX' ? NATIVE_DOCX_MAX_BYTES : NATIVE_TEXT_MAX_BYTES;
}

export function nativeFileDisplayName(uri: string, fallback: string): string {
  const clean = uri.split('?')[0].split('#')[0];
  const raw = clean.split('/').pop() ?? '';
  if (raw === '') return fallback;
  try { return decodeURIComponent(raw); } catch (_e) { return raw; }
}

/** Returns at most one file URI from a share Want. Never resolves arbitrary paths or directory URIs. */
export function nativeShareFileUri(uri: string, parameters: Record<string, Object> | undefined): string {
  const candidates: string[] = [];
  if (typeof uri === 'string' && uri !== '') candidates.push(uri);
  if (parameters !== undefined) {
    const keys: string[] = ['ability.params.stream', 'uris', 'uri', 'fileUri'];
    keys.forEach((key: string) => {
      const value: Object | undefined = parameters[key];
      if (typeof value === 'string') candidates.push(value);
      else if (Array.isArray(value)) {
        (value as Object[]).forEach((item: Object) => { if (typeof item === 'string') candidates.push(item); });
      }
    });
  }
  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i].trim();
    // Only app-readable file URIs are accepted; http(s), content and relative paths are ignored.
    if (value.startsWith('file://') && value.length <= 2048 && !value.endsWith('/')) return value;
  }
  return '';
}

export function nativeDraftError(text: string, format: NativeMaterialFormat, bytes: number): string {
  if (format === 'UNSUPPORTED') return '请选择 TXT、Markdown、普通 CSV 或 DOCX 文件';
  if (bytes <= 0 || bytes > nativeMaterialLimit(format)) {
    return format === 'DOCX' ? 'Word 文件需在 2MB 以内' : '文本材料需在 64KB 以内';
  }
  if (format !== 'DOCX' && text.trim() === '') return '文件没有可读正文，请重新选择';
  if (format !== 'DOCX' && text.length > NATIVE_MATERIAL_MAX_CHARS) return '正文超过 20,000 字，请拆分后导入';
  return '';
}

/** Stable per-draft request id: a retry after a lost response reuses the same id. */
export function nativeMaterialRequestId(missionId: string, fileName: string, text: string): string {
  let hash = 2166136261;
  const seed = missionId + '|' + fileName + '|' + text.length + '|' + text.slice(0, 64);
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `harmony-material-${hash.toString(16)}`;
}

export function nativeMaterialPreview(text: string, limit: number = 600): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : compact.slice(0, limit) + '…';
}
