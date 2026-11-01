import { describe, it, expect } from '@ohos/hypium';
import { episodeStatusLabel, episodeStatusTone, formatDeadlineState, mapReentryToWidget } from '../main/ets/services/WidgetDataService';
import { ReentryData, ReentryEpisodePart, ReentryRiskPart, ReentrySchedulePart, ReentrySectionMeta } from '../main/ets/models/Reentry';
import { ProjectAgentContext, AgentNextStep, AgentGoalRef, AgentEntityRef } from '../main/ets/models/ProjectAgentContext';

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
    it('maps checkpoint status to widget labels and tones', 0, () => {
      expect(episodeStatusLabel('PUBLISHED')).assertEqual('结论有效');
      expect(episodeStatusTone('PUBLISHED')).assertEqual('brand');
      expect(episodeStatusLabel('PARTIALLY_STALE')).assertEqual('部分过期');
      expect(episodeStatusTone('PARTIALLY_STALE')).assertEqual('warning');
      expect(episodeStatusLabel('STALE')).assertEqual('需要重整');
      expect(episodeStatusTone('STALE')).assertEqual('risk');
      expect(episodeStatusLabel('DRAFT')).assertEqual('待整理');
      expect(episodeStatusTone('DRAFT')).assertEqual('neutral');
      expect(episodeStatusLabel(null)).assertEqual('待整理');
      expect(episodeStatusTone(null)).assertEqual('neutral');
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
      expect(payload.projectId).assertEqual('p1');
      expect(payload.projectTitle).assertEqual('闭环验收项目');
      expect(payload.nextAction).assertEqual('跑更大窗口对比实验');
      expect(payload.nextActionTitle).assertEqual('跑更大窗口对比实验');
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

    it('prioritizes nextStep.title over reason and avoids duplicating stale status', 0, () => {
      const reentry = emptyReentry();
      const nextStep: AgentNextStep = {
        attentionKind: 'ACTION',
        status: 'READY',
        entityRef: { kind: 'ACTION', id: 'act-1', version: 1, questionId: null, approvalId: null, outputRevision: null },
        title: '整理代码与模型接口文档',
        reason: '这是一段很长的内部原因说明：由于上游模型契约更新，需要同步核对各处接口与调用参数以保证系统稳定运行',
        actionLabel: '前往待办',
        href: '/projects/p1',
        evidenceRefs: [],
        priority: 1
      };
      const agentContext: ProjectAgentContext = {
        schemaVersion: 1,
        projectId: 'p1',
        projectTitle: '闭环验收项目',
        goalRef: { projectGoalHash: 'h1', missionId: null, planRevision: null },
        goal: '完成闭环',
        focusMissionId: null,
        nextStep: nextStep,
        observedAt: '2026-10-31T00:00:00Z',
        generatedAt: '2026-10-31T00:00:00Z',
        observationHash: 'ob1',
        freshness: 'FRESH',
        fallbackReason: null
      };
      reentry.agentContext = agentContext;
      reentry.episode = new ReentryEpisodePart();
      reentry.episode.status = 'STALE';
      reentry.episode.changesSince = []; // 无新变化

      const payload = mapReentryToWidget(reentry, 3, 50, true);
      // P0: 优先使用 nextStep.title 作为行动标题
      expect(payload.nextActionTitle).assertEqual('整理代码与模型接口文档');
      expect(payload.nextActionReason.length > 0).assertTrue();
      // P0: status 显示需要重整，而 checkpointInfo 绝不重复显示相同的「需要重整」
      expect(payload.status).assertEqual('需要重整');
      expect(payload.checkpointInfo !== '需要重整').assertTrue();
      // P1: 日期状态规范化
      expect(payload.deadlineKind).assertEqual('FUTURE');
      expect(payload.deadlineText).assertEqual('距截止 3 天');
    });

    it('correctly formats deadline states without fake countdowns', 0, () => {
      expect(formatDeadlineState(undefined, false).kind).assertEqual('NONE');
      expect(formatDeadlineState(undefined, false).text).assertEqual('未设截止日');
      expect(formatDeadlineState(0, false).kind).assertEqual('NONE');
      expect(formatDeadlineState(0, true).kind).assertEqual('TODAY');
      expect(formatDeadlineState(0, true).text).assertEqual('今天截止');
      expect(formatDeadlineState(-2, true).kind).assertEqual('OVERDUE');
      expect(formatDeadlineState(-2, true).text).assertEqual('已逾期 2 天');
      expect(formatDeadlineState(5, true).kind).assertEqual('FUTURE');
      expect(formatDeadlineState(5, true).text).assertEqual('距截止 5 天');
    });
  });
}
