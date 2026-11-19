import { describe, it, expect } from '@ohos/hypium';
import { nativeMaterialFormat, nativeMaterialMime, nativeMaterialLimit, nativeFileDisplayName,
  nativeShareFileUri, nativeDraftError, nativeMaterialRequestId, nativeMaterialPreview } from '../main/ets/common/NativeMaterialContract';

export default function nativeMaterialContractTest() {
  describe('nativeMaterialContract', () => {
    it('supported_formats_and_limits', 0, () => {
      expect(nativeMaterialFormat('note.txt')).assertEqual('TEXT');
      expect(nativeMaterialFormat('计划.MD')).assertEqual('MARKDOWN');
      expect(nativeMaterialFormat('data.CSV')).assertEqual('CSV');
      expect(nativeMaterialFormat('简报.docx')).assertEqual('DOCX');
      expect(nativeMaterialFormat('清单.XLSX')).assertEqual('XLSX');
      expect(nativeMaterialFormat('scan.pdf')).assertEqual('UNSUPPORTED');
      expect(nativeMaterialMime('DOCX')).assertEqual('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(nativeMaterialLimit('TEXT')).assertEqual(64 * 1024);
      expect(nativeMaterialLimit('DOCX')).assertEqual(2 * 1024 * 1024);
      expect(nativeMaterialLimit('XLSX')).assertEqual(2 * 1024 * 1024);
    });
    it('share_route_accepts_one_file_uri_only', 0, () => {
      expect(nativeShareFileUri('file://docs/a.txt', undefined)).assertEqual('file://docs/a.txt');
      expect(nativeShareFileUri('', { 'uris': ['file://docs/a.txt', 'file://docs/b.txt'] })).assertEqual('');
      expect(nativeShareFileUri('file://docs/a.txt', { 'uris': ['file://docs/a.txt'] })).assertEqual('file://docs/a.txt');
      expect(nativeShareFileUri('https://evil.example/a.txt', undefined)).assertEqual('');
      expect(nativeShareFileUri('file://docs/dir/', undefined)).assertEqual('');
      expect(nativeFileDisplayName('file://docs/%E7%AC%94%E8%AE%B0.md', 'fallback')).assertEqual('笔记.md');
    });
    it('local_validation_matches_server_boundaries', 0, () => {
      expect(nativeDraftError('正文', 'TEXT', 10)).assertEqual('');
      expect(nativeDraftError('', 'TEXT', 10)).assertEqual('文件没有可读正文，请重新选择');
      expect(nativeDraftError('正文', 'TEXT', 65 * 1024)).assertEqual('文本材料需在 64KB 以内');
      expect(nativeDraftError('正文', 'DOCX', 2 * 1024 * 1024 + 1)).assertEqual('Word 文件需在 2MB 以内');
      expect(nativeDraftError('正文', 'UNSUPPORTED', 10)).assertEqual('请选择 TXT、Markdown、普通 CSV、DOCX 或 XLSX 文件');
    });
    it('retry_request_id_is_stable_and_scoped', 0, () => {
      const first = nativeMaterialRequestId('mission-a', '客户.txt', '客户希望周五前看到第二版');
      expect(first).assertEqual(nativeMaterialRequestId('mission-a', '客户.txt', '客户希望周五前看到第二版'));
      expect(first === nativeMaterialRequestId('mission-b', '客户.txt', '客户希望周五前看到第二版')).assertFalse();
      const prefix = 'x'.repeat(80);
      expect(nativeMaterialRequestId('m', 'a.txt', prefix + 'a') === nativeMaterialRequestId('m', 'a.txt', prefix + 'b')).assertFalse();
    });
    it('preview_is_bounded_and_hides_whitespace', 0, () => {
      expect(nativeMaterialPreview('  a\n\n b  ', 10)).assertEqual('a b');
      expect(nativeMaterialPreview('0123456789abcdef', 5)).assertEqual('01234…');
    });
  });
}
