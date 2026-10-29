import { describe, it, expect } from '@ohos/hypium';
import { Attachment } from '../main/ets/models/Attachment';
import { attachmentFilePath, attachmentPreviewKind, attachmentSaveName, attachmentSize, attachmentStatus } from '../main/ets/common/AttachmentPresentation';

export default function attachmentPresentationTest() {
  describe('attachmentPresentation', () => {
    it('original_path_encodes_ids_and_never_includes_credentials', 0, () => {
      expect(attachmentFilePath('p/a?x', 'a#b')).assertEqual('/api/projects/p%2Fa%3Fx/attachments/a%23b/file');
    });
    it('active_content_and_extension_only_files_are_not_inline_images', 0, () => {
      expect(attachmentPreviewKind('image/svg+xml')).assertEqual('file');
      expect(attachmentPreviewKind('text/html')).assertEqual('file');
      expect(attachmentPreviewKind('image/png')).assertEqual('image');
      expect(attachmentPreviewKind('application/pdf')).assertEqual('pdf');
    });
    it('successful_and_failed_extraction_keep_originals_accessible', 0, () => {
      const item = new Attachment(); item.extractionStatus = 'SUCCESS';
      expect(attachmentStatus(item)).assertEqual('已提取文本');
      item.extractionStatus = 'FAILED';
      expect(attachmentStatus(item).includes('原件可查看')).assertTrue();
      item.extractionStatus = 'NEEDS_OCR';
      expect(attachmentStatus(item).includes('原件可查看')).assertTrue();
    });
    it('save_name_preserves_chinese_and_removes_paths', 0, () => {
      expect(attachmentSaveName('../阶段/报告.pdf')).assertEqual('.._阶段_报告.pdf');
      expect(attachmentSaveName('..')).assertEqual('附件原件');
      expect(attachmentSaveName('实验记录.pdf')).assertEqual('实验记录.pdf');
      expect(attachmentSize(1024 * 1024)).assertEqual('1.0 MB');
    });
  });
}
