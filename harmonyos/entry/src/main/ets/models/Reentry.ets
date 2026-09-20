// ---- R2 阶段检查点 / 排程 / 再入场（与 lib/types/episode.ts、schedule.ts、reentry.ts 契约保持一致） ----

export class EpisodeSourceRef {
  refId: string = '';
  kind: string = 'CARD';
  entityId: string = '';
  revisionIndex: number | null = null;
  observedAt: string = '';
  contentHash: string = '';
  title: string = '';
}

export class EpisodeClaim {
  claimId: string = '';
  kind: string = 'FACT';
  section: string = 'GOALS';
  text: string = '';
  sourceRefIds: string[] = [];
  ruleCode?: string;
  suggestedActionId?: string;
  suggestedReason?: string;
}

export class EpisodeSummarySection {
  section: string = 'GOALS';
  text: string = '';
}

export class EpisodeSummary {
  schemaVersion: number = 1;
  goals: string = '';
  sections: EpisodeSummarySection[] = [];
}

export class EpisodeSourceState {
  refId: string = '';
  kind: string = 'CARD';
  entityId: string = '';
  state: string = 'AVAILABLE';
  displayReason: string = '';
}

export class EpisodeClaimFreshness {
  claimId: string = '';
  affected: boolean = false;
  reason: string = '';
}

export class EpisodeFreshnessReport {
  status: string = 'FRESH';
  affectedClaims: EpisodeClaimFreshness[] = [];
  sources: EpisodeSourceState[] = [];
  evaluatedAt: string = '';
}

export class EpisodeRevision {
  id: string = '';
  episodeId: string = '';
  revision: number = 1;
  baseSnapshotId: string | null = null;
  endSnapshotId: string | null = null;
  sourceHash: string = '';
  sourceRefs: EpisodeSourceRef[] = [];
  claims: EpisodeClaim[] = [];
  summary: EpisodeSummary = new EpisodeSummary();
  generationMode: string = 'TEMPLATE';
  provider: string | null = null;
  fallbackReason: string | null = null;
  status: string = 'DRAFT';
  createdAt: string = '';
}

export class Episode {
  id: string = '';
  projectId: string = '';
  kind: string = 'MANUAL';
  title: string = '';
  windowStart: string = '';
  windowEnd: string = '';
  status: string = 'DRAFT';
  createdAt: string = '';
  updatedAt: string = '';
  revisions: EpisodeRevision[] = [];
  freshness?: EpisodeFreshnessReport;
}

export class EpisodePreviewResult {
  episode: Episode = new Episode();
  excludedReasons: string[] = [];
}

export class EpisodeListResponse {
  episodes: Episode[] = [];
}

export class EpisodeDetailResponse {
  episode: Episode = new Episode();
}

// ---- 排程 ----

export class ScheduleBlock {
  id: string | null = null;
  actionId: string = '';
  actionTitle: string = '';
  actionVersion: number = 1;
  start: string = '';
  end: string = '';
  locked: boolean = false;
}

export class ScheduleSkipReason {
  actionId: string = '';
  actionTitle: string = '';
  reasonCode: string = 'NO_CAPACITY';
  message: string = '';
}

export class SchedulePlan {
  id: string = '';
  projectId: string = '';
  episodeRevisionId: string | null = null;
  requestId: string = '';
  timezone: string = 'Asia/Shanghai';
  rangeStart: string = '';
  rangeEnd: string = '';
  version: number = 1;
  status: string = 'DRAFT';
  blocks: ScheduleBlock[] = [];
  scheduled: ScheduleBlock[] = [];
  unscheduled: ScheduleSkipReason[] = [];
  createdAt: string = '';
  updatedAt: string = '';
}

export class SchedulePlanResponse {
  status: string = 'EMPTY';
  plan: SchedulePlan | null = null;
}

// ---- 再入场聚合 ----

export class ReentrySectionMeta {
  status: string = 'EMPTY';
  observedAt: string | null = null;
  errorCode: string | null = null;
  message: string | null = null;
}

export class ReentryEpisodePart {
  episodeId: string | null = null;
  revisionId: string | null = null;
  title: string | null = null;
  confirmedAt: string | null = null;
  status: string | null = null;
  changesSince: string[] = [];
  meta: ReentrySectionMeta = new ReentrySectionMeta();
}

export class ReentryRiskPart {
  text: string | null = null;
  severity: string | null = null;
  entityId: string | null = null;
  meta: ReentrySectionMeta = new ReentrySectionMeta();
}

export class ReentrySchedulePart {
  planId: string | null = null;
  blockId: string | null = null;
  actionId: string | null = null;
  actionTitle: string | null = null;
  start: string | null = null;
  end: string | null = null;
  meta: ReentrySectionMeta = new ReentrySectionMeta();
}

export class ReentryData {
  projectId: string = '';
  projectName: string = '';
  freshness: string = 'FRESH';
  episode: ReentryEpisodePart = new ReentryEpisodePart();
  risk: ReentryRiskPart = new ReentryRiskPart();
  schedule: ReentrySchedulePart = new ReentrySchedulePart();
  primaryAction: string = 'START_ACTION';
  primaryMessage: string = '';
  generatedAt: string = '';
}
