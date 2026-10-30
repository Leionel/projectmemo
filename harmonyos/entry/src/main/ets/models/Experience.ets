// P3-A / CT-8 项目内经验：双端共享契约的 ArkTS 侧模型。
// 建议不改变权限；条件 MATCH + ACTIVE 才注入；旧数据条件不足降级为案例参考。

export interface ExperienceCounterExample {
  missionId?: string;
  reason?: string;
  note?: string;
}

export interface ExperienceUseDisposition {
  disposition?: string;
  reason?: string | null;
  by?: string;
}

export interface ExperienceSuggestion {
  id: string;
  kind: string;
  status: string;
  version: number;
  title: string;
  statement: string;
  conditions: string[];
  unknownConditions: string[];
  notApplicableWhen: string[];
  toolVersions: Record<string, string>;
  supportCount: number;
  counterCount: number;
  sampleCount: number;
  caseReferenceCount: number;
  matchState: string;
  eligibleForInjection: boolean;
  suppressed: string | null;
  originMissionId: string | null;
  revoked: boolean;
  counterExamples: ExperienceCounterExample[];
  modelDecision: ExperienceUseDisposition | null;
  userFeedback: ExperienceUseDisposition | null;
}

export interface MissionExperience {
  enabled: boolean;
  suggestions: ExperienceSuggestion[];
  note: string;
}

export interface ExperienceEligibility {
  eligible: boolean;
  reason: string;
}

export interface ExperienceResultLabels {
  engineeringCompleted?: number;
  draftExists?: number;
  adopted?: number;
  actionCreated?: number;
  actionCompletedWithReceipt?: number;
  userAttested?: number;
  independentMeasurement?: number;
  explicitNegative?: number;
}

export interface ExperienceHistoryRow extends ExperienceSuggestion {
  tools: string[];
  sampleMissions: string[];
  revokedReason: string | null;
  activatedAt: string | null;
  validUntil: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  conditionsComplete: boolean;
  eligibility: ExperienceEligibility;
  resultLabels: ExperienceResultLabels;
}

export interface ExperienceTrajectory {
  missionCount: number;
  truncated: boolean;
  engineeringSucceeded: number;
  adopted: number;
  actionsCompleted: number;
  realOutcomeAttested: number;
  independentMeasurements: number;
  explicitNegative: number;
  note: string;
}

export interface ExperienceSyncReply {
  changed: number;
  at: string;
}

export interface ExperienceListReply {
  enabled: boolean;
  trajectory: ExperienceTrajectory | null;
  experiences: ExperienceHistoryRow[];
  synced?: ExperienceSyncReply;
}

export interface ExperienceActionResult {
  id: string;
  kind: string;
  status: string;
  version: number;
  supportCount: number;
  counterCount: number;
  activatedAt: string | null;
  revokedAt: string | null;
  validUntil: string | null;
  targetExperienceId?: string;
  feedback?: string;
}

export class ExperienceActionBody {
  action: string = 'ACTIVATE';
  requestId: string = '';
  expectedVersion?: number;
  reason?: string;
  disposition?: string;
  missionId?: string;
  conversationId?: string;
  turnId?: string;
  targetProjectId?: string;
}

export class ExperienceRefreshBody {
  action: string = 'REFRESH';
  requestId: string = '';
}
