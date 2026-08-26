export class Attachment {
  id: string = '';
  projectId: string = '';
  type: string = 'FILE'; // 'IMAGE' | 'PDF' | 'FILE'
  storageKey: string = '';
  fileName: string = '';
  mimeType: string = '';
  size: number = 0;
  sha256: string = '';
  extractedText: string = '';
  extractionStatus: string = 'PENDING';
  extractionError: string = '';
  createdAt: string = '';
}
