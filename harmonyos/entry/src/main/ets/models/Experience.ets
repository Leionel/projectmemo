// P3-A 项目内经验：双端共享契约的 ArkTS 侧模型。
// 建议不改变权限；SHADOW 只观察不注入。来源与停用入口在委托详情就近展示。

export interface ExperienceSuggestion {
  id: string;
  kind: string;
  status: string;
  title: string;
  statement: string;
  conditions: string[];
  toolVersions: Record<string, string>;
  supportCount: number;
  counterCount: number;
  sampleCount: number;
}

export interface MissionExperience {
  enabled: boolean;
  suggestions: ExperienceSuggestion[];
  note: string;
}

export interface ExperienceHistoryRow extends ExperienceSuggestion {
  tools: string[];
  sampleMissions: string[];
  revokedReason: string | null;
  createdAt: string;
}

export interface ExperienceTrajectory {
  missionCount: number;
  truncated: boolean;
  engineeringSucceeded: number;
  adopted: number;
  actionsCompleted: number;
  realOutcomeAttested: number;
  note: string;
}

export interface ExperienceListReply {
  enabled: boolean;
  trajectory: ExperienceTrajectory | null;
  experiences: ExperienceHistoryRow[];
}

export interface ExperienceActionResult {
  id: string;
  kind: string;
  status: string;
  supportCount: number;
  counterCount: number;
}

export class ExperienceActionBody {
  action: string = 'ACTIVATE';
  requestId: string = '';
  reason?: string;
}
