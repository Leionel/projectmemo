import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from '@ohos/hypium';
import { TextFormatters } from '../main/ets/common/TextFormatters';
import { DateOnly } from '../main/ets/common/DateOnly';

export default function localUnitTest() {
  describe('localUnitTest', () => {
    // Defines a test suite. Two parameters are supported: test suite name and test suite function.
    beforeAll(() => {
      // Presets an action, which is performed only once before all test cases of the test suite start.
      // This API supports only one parameter: preset action function.
    });
    beforeEach(() => {
      // Presets an action, which is performed before each unit test case starts.
      // The number of execution times is the same as the number of test cases defined by **it**.
      // This API supports only one parameter: preset action function.
    });
    afterEach(() => {
      // Presets a clear action, which is performed after each unit test case ends.
      // The number of execution times is the same as the number of test cases defined by **it**.
      // This API supports only one parameter: clear action function.
    });
    afterAll(() => {
      // Presets a clear action, which is performed after all test cases of the test suite end.
      // This API supports only one parameter: clear action function.
    });
    it('assertContain', 0, () => {
      // Defines a test case. This API supports three parameters: test case name, filter parameter, and test case function.
      let a = 'abc';
      let b = 'b';
      // Defines a variety of assertion methods, which are used to declare expected boolean conditions.
      expect(a).assertContain(b);
      expect(a).assertEqual(a);
    });

    it('guards unreadable historical text', 0, () => {
      expect(TextFormatters.isUnreadableText('??????,?????? A ??? 1.8%?')).assertTrue();
      expect(TextFormatters.readableText('??????')).assertEqual('这条记录文本无法读取，请重新录入。');
      expect(TextFormatters.readableText('完成消融实验，结果显示模块 A 提升约 1.8%。')).assertEqual('完成消融实验，结果显示模块 A 提升约 1.8%。');
    });

    it('keeps readable markdown structure', 0, () => {
      const markdown = '- **??????**：????\n\n正常的项目事实';
      const readable = TextFormatters.readableMarkdown(markdown);
      expect(readable).assertContain('- 历史记录文本无法读取，请重新录入。');
      expect(readable).assertContain('正常的项目事实');
    });

    it('deduplicates identical summaries', 0, () => {
      expect(TextFormatters.shouldShowSummary('完成实验。', '完成实验')).assertFalse();
      expect(TextFormatters.shouldShowSummary('项目标题', '项目摘要')).assertTrue();
    });

    it('marks damaged memories without replacing source data', 0, () => {
      expect(TextFormatters.isDamagedMemory('????', '????')).assertTrue();
      expect(TextFormatters.isDamagedMemory('正常标题', '正常摘要')).assertFalse();
    });

    it('keeps picked calendar days in local time, including leap day', 0, () => {
      const picked = DateOnly.selected('2028-02-29');
      expect(DateOnly.format(picked)).assertEqual('2028-02-29');
      expect(DateOnly.format(DateOnly.selected('2028-02-30')) === '2028-02-30').assertFalse();
    });
  });
}
