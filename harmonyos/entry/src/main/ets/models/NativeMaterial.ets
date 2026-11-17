import { NativeMaterialFormat, nativeFileDisplayName, nativeMaterialFormat,
  nativeMaterialMime, nativeDraftError, nativeMaterialRequestId } from '../common/NativeMaterialContract';

export class NativeMaterialPreview {
  name: string = '';
  format: string = '';
  text: string = '';
  length: number = 0;
  limitations: string = '';
}

export class NativeMaterialExtract {
  text: string = '';
  name: string = '';
  format: string = '';
  limitations: string = '';
}

/** Client-side draft retained across failures: the URI, preview and request id are never regenerated on retry. */
export class NativeMaterialDraft {
  requestId: string = '';
  uri: string = '';
  name: string = '';
  format: NativeMaterialFormat = 'UNSUPPORTED';
  text: string = '';
  limitations: string = '';
  size: number = 0;
  error: string = '';
  canConfirm: boolean = false;

  static fromPreview(missionId: string, uri: string, preview: NativeMaterialPreview, format: NativeMaterialFormat, size: number): NativeMaterialDraft {
    const draft = new NativeMaterialDraft();
    draft.requestId = nativeMaterialRequestId(missionId, preview.name, preview.text);
    draft.uri = uri; draft.name = preview.name; draft.format = format; draft.text = preview.text;
    draft.limitations = preview.limitations; draft.size = size; draft.canConfirm = true;
    return draft;
  }

  static validate(fileName: string, text: string, bytes: number): string {
    return nativeDraftError(text, nativeMaterialFormat(fileName), bytes);
  }

  static mimeFor(fileName: string): string {
    return nativeMaterialMime(nativeMaterialFormat(fileName));
  }

  static displayName(uri: string, fallback: string): string {
    return nativeFileDisplayName(uri, fallback);
  }
}

export class NativeMaterialPreviewBody {
  name: string = '';
  text: string = '';
}
