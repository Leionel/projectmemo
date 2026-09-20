import { describe, it, expect } from '@ohos/hypium';
import { episodeStatusLabel, mapReentryToWidget } from '../main/ets/services/WidgetDataService';
import { ReentryData, ReentryEpisodePart, ReentryRiskPart, ReentrySchedulePart, ReentrySectionMeta } from '../main/ets/models/Reentry';

function emptyReentry(): ReentryData {
  const data = new ReentryData();
  data.projectId = 'p1';
  data.projectName = '闭环验收项目';
  data.primaryMessage = '先整理一次阶段进展，再选择下一步';
  return data;
}

function publishedEpisodePart(): ReentryEpisodePart {
  const part = new ReentryEpisodePart();
  part.episodeId = 'ep1';
  part.revisionId = 'rev1';
  part.title = '阶段检查点 · 09-13 ~ 09-20';
  part.confirmedAt = '2026-09-20T02:00:00.000Z';
  part.status = 'PUBLISHED';
  part.changesSince = ['新增记录《更大窗口实验》'];
  part.meta = new ReentrySectionMeta();
  part.meta.status = 'OK';
  return part;
}

export default function reentryMappingTest() {
  describe('reentryMappingTest', () => {
    it('maps checkpoint status to widget labels', 0, () => {
      expect(episodeStatusLabel('PUBLISHED')).assertEqual('结论有效');
      expect(episodeStatusLabel('PARTIALLY_STALE')).assertEqual('部分过期');
      expect(episodeStatusLabel('STALE')).assertEqual('需要重整');
      expect(episodeStatusLabel('DRAFT')).assertEqual('待整理');
      expect(episodeStatusLabel(null)).assertEqual('待整理');
    });

    it('uses scheduled action title and keeps dashboard metrics', 0, () => {
      const reentry = emptyReentry();
      reentry.episode = publishedEpisodePart();
      reentry.schedule = new ReentrySchedulePart();
      reentry.schedule.actionId = 'a1';
      reentry.schedule.actionTitle = '跑更大窗口对比实验';
      reentry.schedule.meta = new ReentrySectionMeta();
      reentry.schedule.meta.status = 'OK';

      const payload = mapReentryToWidget(reentry, 9, 72);
      expect(payload.projectTitle).assertEqual('闭环验收项目');
      expect(payload.nextAction).assertEqual('跑更大窗口对比实验');
      expect(payload.daysLeft).assertEqual(9);
      expect(payload.readiness).assertEqual(72);
      expect(payload.checkpointInfo).assertEqual('结论有效 · 1 条新变化');
      expect(payload.status).assertEqual('结论有效');
    });

    it('falls back to primary message when no schedule and reports stale changes', 0, () => {
      const reentry = emptyReentry();
      reentry.episode = publishedEpisodePart();
      reentry.episode.status = 'PARTIALLY_STALE';
      reentry.primaryMessage = '部分结论的来源已变化，请先查看受影响的内容';
      reentry.schedule = new ReentrySchedulePart();
      reentry.schedule.meta = new ReentrySectionMeta();
      reentry.schedule.meta.status = 'EMPTY';

      const payload = mapReentryToWidget(reentry, 0, 40);
      expect(payload.nextAction).assertEqual('部分结论的来源已变化，请先查看受影响的内容');
      expect(payload.status).assertEqual('部分过期');
      expect(payload.checkpointInfo.startsWith('部分过期')).assertTrue();
    });

    it('keeps risk section data intact when mapped from aggregation', 0, () => {
      const reentry = emptyReentry();
      reentry.risk = new ReentryRiskPart();
      reentry.risk.text = '风险：单人开发时间不够';
      reentry.risk.meta = new ReentrySectionMeta();
      reentry.risk.meta.status = 'OK';
      expect(mapReentryToWidget(reentry, 0, 0).projectTitle).assertEqual('闭环验收项目');
      expect(reentry.risk.text).assertEqual('风险：单人开发时间不够');
    });
  });
}
