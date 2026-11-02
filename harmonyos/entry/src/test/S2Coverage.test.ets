import { describe, it, expect } from '@ohos/hypium';
import {
  IntakeCoverage, IntakeCoverageCurrent, IntakeCoverageItem, IntakeCoverageLastSent,
  intakeCoverageItemLabel, intakeCoverageSummary
} from '../main/ets/models/ProjectIntake';

export default function s2CoverageContractTest() {
  describe('s2CoverageContract', () => {
    it('coverage_item_states_are_not_collapsed', 0, () => {
      const neverSent = new IntakeCoverageItem();
      neverSent.label = '文本 1'; neverSent.availableChars = 5000; neverSent.plannedChars = 5000; neverSent.lastSentChars = -1;
      expect(intakeCoverageItemLabel(neverSent)).assertEqual('待送入 5000 字 / 共 5000 字');

      const sent = new IntakeCoverageItem();
      sent.availableChars = 3200; sent.plannedChars = 3200; sent.lastSentChars = 3200;
      expect(intakeCoverageItemLabel(sent)).assertEqual('已送入 3200 字');

      const truncated = new IntakeCoverageItem();
      truncated.availableChars = 30000; truncated.plannedChars = 20000; truncated.lastSentChars = 20000; truncated.lastSentTruncated = true;
      expect(intakeCoverageItemLabel(truncated)).assertEqual('送入 20000 字 / 共 30000 字（截取）');

      const overBudget = new IntakeCoverageItem();
      overBudget.availableChars = 800; overBudget.plannedChars = 0; overBudget.lastSentChars = 0; overBudget.reason = 'OVER_BUDGET';
      expect(intakeCoverageItemLabel(overBudget)).assertEqual('超出本轮总量，未送入（共 800 字）');

      const noText = new IntakeCoverageItem();
      noText.reason = 'NO_READABLE_TEXT';
      expect(intakeCoverageItemLabel(noText)).assertEqual('没有可读文本');

      const added = new IntakeCoverageItem();
      added.availableChars = 120; added.plannedChars = 120; added.lastSentChars = 0; added.reason = 'ADDED_AFTER_UNDERSTANDING';
      expect(intakeCoverageItemLabel(added)).assertEqual('之后新增，还没送入（计划 120 字）');

      const sentButZero = new IntakeCoverageItem();
      sentButZero.availableChars = 50; sentButZero.plannedChars = 0; sentButZero.lastSentChars = 0;
      expect(intakeCoverageItemLabel(sentButZero)).assertEqual('未送入（共 50 字）');
    });
    it('coverage_summary_separates_last_sent_and_planned', 0, () => {
      const coverage = new IntakeCoverage();
      coverage.current = new IntakeCoverageCurrent();
      coverage.current.totalSentChars = 900; coverage.current.totalAvailableChars = 1200;
      expect(intakeCoverageSummary(coverage)).assertEqual('尚未送入 · 下次会送入 900 字 / 共 1200 字');

      const published = new IntakeCoverageLastSent();
      published.understandingPublished = true; published.totalSentChars = 20000; published.totalAvailableChars = 30000;
      coverage.lastSent = published;
      expect(intakeCoverageSummary(coverage)).assertEqual('上一版送入 20000 字 / 材料共 30000 字');

      published.understandingPublished = false;
      expect(intakeCoverageSummary(coverage)).assertEqual('上一版送过但未形成理解 20000 字 / 材料共 30000 字');
    });
  });
}
