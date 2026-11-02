import { describe, it, expect } from '@ohos/hypium';
import {
  IntakeCoverage, IntakeCoverageCurrent, IntakeCoverageItem, IntakeCoverageLastSent, IntakePreview, IntakeMaterialTextReply,
  intakeCoverageItemLabel, intakeCoverageSummary, intakeOriginalViewKey, intakeOriginalPageMatches
} from '../main/ets/models/ProjectIntake';

export default function s2CoverageContractTest() {
  describe('s2CoverageContract', () => {
    it('wire_null_and_missing_last_sent_are_not_a_dispatch', 0, () => {
      const never = JSON.parse('{"availableChars":5000,"plannedChars":5000,"lastSentChars":null,"reason":"INCLUDED"}') as IntakeCoverageItem;
      expect(intakeCoverageItemLabel(never)).assertEqual('待送入 5000 字 / 共 5000 字');
      const missing = JSON.parse('{"availableChars":5000,"plannedChars":5000,"reason":"INCLUDED"}') as IntakeCoverageItem;
      expect(intakeCoverageItemLabel(missing)).assertEqual('待送入 5000 字 / 共 5000 字');
      const zero = JSON.parse('{"availableChars":5000,"plannedChars":0,"lastSentChars":0,"reason":"INCLUDED"}') as IntakeCoverageItem;
      expect(intakeCoverageItemLabel(zero)).assertEqual('未送入（共 5000 字）');
    });
    it('old_wire_without_coverage_has_no_fabricated_reading_fact', 0, () => {
      const old = JSON.parse('{"draftId":"d1","materials":[],"status":"DRAFT"}') as IntakePreview;
      expect(old.coverage === undefined).assertTrue();
      expect(intakeCoverageSummary(old.coverage)).assertEqual('当前服务未提供材料覆盖记录');
    });
    it('same_material_id_new_revision_invalidates_original_pages', 0, () => {
      const old = JSON.parse('{"draftId":"d1","status":"DRAFT","materialsHash":"v1","materials":[{"id":"m1","revision":1,"contentHash":"a"}]}') as IntakePreview;
      const revised = JSON.parse('{"draftId":"d1","status":"DRAFT","materialsHash":"v2","materials":[{"id":"m1","revision":2,"contentHash":"b"}]}') as IntakePreview;
      expect(intakeOriginalViewKey(old) === intakeOriginalViewKey(revised)).assertFalse();
      const confirmed = JSON.parse('{"draftId":"d1","status":"CONFIRMED","materialsHash":"v1","materials":[{"id":"m1","revision":1,"contentHash":"a"}]}') as IntakePreview;
      expect(intakeOriginalViewKey(old) === intakeOriginalViewKey(confirmed)).assertFalse();
    });
    it('pagination_must_match_the_material_version_not_only_its_id', 0, () => {
      const preview = JSON.parse('{"materials":[{"id":"m1","revision":1,"contentHash":"a"}]}') as IntakePreview;
      const first = JSON.parse('{"materialId":"m1","revision":1,"contentHash":"a","text":"原文"}') as IntakeMaterialTextReply;
      expect(intakeOriginalPageMatches(preview, 'm1', first)).assertTrue();
      const newer = JSON.parse('{"materialId":"m1","revision":2,"contentHash":"b","text":"新原文"}') as IntakeMaterialTextReply;
      expect(intakeOriginalPageMatches(preview, 'm1', newer)).assertFalse();
      const oldServer = JSON.parse('{"materialId":"m1","text":"缺版本"}') as IntakeMaterialTextReply;
      expect(intakeOriginalPageMatches(preview, 'm1', oldServer)).assertFalse();
    });
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
