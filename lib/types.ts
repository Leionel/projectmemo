export const knowledgeTypes = [
  "paper_note", "code_issue", "experiment_log", "meeting_note", "idea",
  "task", "risk", "requirement", "reflection",
] as const;

export type KnowledgeTypeValue = (typeof knowledgeTypes)[number];

export const artifactTypes = [
  "weekly_report", "competition_outline", "defense_ppt", "readme",
  "resume_description", "next_week_plan",
] as const;

export type ArtifactTypeValue = (typeof artifactTypes)[number];

export const scenarioOptions = [
  { value: "COURSE_DESIGN", label: "课程设计" },
  { value: "RESEARCH", label: "科研训练" },
  { value: "COMPETITION", label: "学科竞赛" },
  { value: "INNOVATION", label: "创新创业" },
  { value: "LAB_TASK", label: "实验室任务" },
] as const;

export type ProjectScenarioValue = (typeof scenarioOptions)[number]["value"];

export function getScenarioColor(scenarioValue: string) {
  switch (scenarioValue) {
    case "COURSE_DESIGN":
      return "bg-indigo-100/50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400";
    case "RESEARCH":
      return "bg-teal-100/50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400";
    case "COMPETITION":
      return "bg-amber-100/50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    case "INNOVATION":
      return "bg-rose-100/50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400";
    case "LAB_TASK":
      return "bg-slate-100/60 text-slate-700 dark:bg-slate-800/40 dark:text-slate-400";
    default:
      return "bg-[var(--paper)] text-[var(--navy)]";
  }
}

export const knowledgeTypeLabels: Record<KnowledgeTypeValue, string> = {
  paper_note: "论文笔记", code_issue: "代码问题", experiment_log: "实验记录",
  meeting_note: "会议纪要", idea: "灵感想法", task: "待办任务", risk: "项目风险",
  requirement: "材料要求", reflection: "阶段复盘",
};

export const artifactTypeLabels: Record<ArtifactTypeValue, string> = {
  weekly_report: "项目周报", competition_outline: "作品说明大纲", defense_ppt: "答辩 PPT 大纲",
  readme: "README 草稿", resume_description: "简历项目描述", next_week_plan: "下一周行动计划",
};

export function getKnowledgeTypeColor(typeValue: string) {
  switch (typeValue) {
    case "paper_note": 
      return "bg-[#EEF2FF] text-[#4338CA] dark:bg-[#312E81] dark:text-[#A5B4FC]";
    case "code_issue": 
      return "bg-[#FFF1F2] text-[#BE123C] dark:bg-[#881337] dark:text-[#FDA4AF]";
    case "experiment_log": 
      return "bg-[#ECFDF5] text-[#047857] dark:bg-[#064E3B] dark:text-[#6EE7B7]";
    case "meeting_note": 
      return "bg-[#F5F3FF] text-[#6D28D9] dark:bg-[#4C1D95] dark:text-[#C4B5FD]";
    case "idea": 
      return "bg-[#FFFBEB] text-[#B45309] dark:bg-[#78350F] dark:text-[#FCD34D]";
    case "task": 
      return "bg-[#F0F9FF] text-[#0369A1] dark:bg-[#0C4A6E] dark:text-[#7DD3FC]";
    case "risk": 
      return "bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#7F1D1D] dark:text-[#FCA5A5]";
    case "requirement": 
      return "bg-[#FFF7ED] text-[#C2410C] dark:bg-[#7C2D12] dark:text-[#FDBA74]";
    case "reflection": 
      return "bg-[#F0FDFA] text-[#0F766E] dark:bg-[#134E4A] dark:text-[#5EEAD4]";
    default: 
      return "bg-[#F3F4F6] text-[#374151] dark:bg-[#374151] dark:text-[#D1D5DB]";
  }
}

export interface CardDraft {
  type: KnowledgeTypeValue;
  title: string;
  summary: string;
  keywords: string[];
  relatedTasks: string[];
  nextActions: string[];
  importance: number;
}

export interface LinkableCard {
  id: string;
  title: string;
  keywords: string[];
}

export interface CardLink {
  relatedCardId: string;
  relatedTitle: string;
  reason: string;
  score: number;
  sharedKeywords: string[];
}

export interface Suggestion {
  id: string;
  tone: "risk" | "action" | "insight" | "deadline";
  title: string;
  content: string;
  priority: number;
}

export const interventionTriggers = [
  "DEADLINE_NEAR",
  "RISK_UNHANDLED",
  "PROJECT_STALE",
  "EXPERIMENT_GAP",
  "MATERIAL_GAP",
  "DELIVERABLE_GAP",
] as const;
export type InterventionTriggerValue = (typeof interventionTriggers)[number];

export const interventionStatuses = ["OPEN", "ACCEPTED", "SNOOZED", "DISMISSED", "RESOLVED"] as const;
export type InterventionStatusValue = (typeof interventionStatuses)[number];

export const actionStatuses = ["TODO", "DOING", "DONE", "CANCELLED"] as const;
export type ActionStatusValue = (typeof actionStatuses)[number];

export const interventionTriggerLabels: Record<InterventionTriggerValue, string> = {
  DEADLINE_NEAR: "截止日期逼近",
  RISK_UNHANDLED: "风险尚未处理",
  PROJECT_STALE: "项目出现停滞",
  EXPERIMENT_GAP: "论文与实验存在缺口",
  MATERIAL_GAP: "参赛材料存在缺口",
  DELIVERABLE_GAP: "交付物证据存在缺口",
};

export const interventionStatusLabels: Record<InterventionStatusValue, string> = {
  OPEN: "待处理",
  ACCEPTED: "已接受",
  SNOOZED: "稍后提醒",
  DISMISSED: "已忽略",
  RESOLVED: "已解决",
};

export const actionStatusLabels: Record<ActionStatusValue, string> = {
  TODO: "待开始",
  DOING: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

export interface AgentEvidence {
  rule: string;
  facts: string[];
  cardIds?: string[];
  artifactTypes?: string[];
  evaluatedAt?: string;
}

export interface ProposedAction {
  kind: "create_action" | "generate_artifact";
  label: string;
  title: string;
  description?: string;
  priority?: number;
  artifactType?: ArtifactTypeValue;
  dueAt?: string;
}

export interface InterventionData {
  id: string;
  projectId: string;
  triggerType: InterventionTriggerValue;
  dedupeKey: string;
  status: InterventionStatusValue;
  severity: number;
  title: string;
  content: string;
  evidence: AgentEvidence;
  proposedActions: ProposedAction[];
  isSimulated: boolean;
  snoozedUntil: string | null;
  dismissReason?: string | null;
  handledAt?: string | null;
  evidenceCardId?: string | null;
  createdAt: string;
  updatedAt: string;
  actions?: ActionItemData[];
}

export interface ActionItemData {
  id: string;
  projectId: string;
  sourceInterventionId?: string | null;
  sourceCardId?: string | null;
  resultCardId?: string | null;
  title: string;
  description?: string | null;
  priority: number;
  status: ActionStatusValue;
  dueAt?: string | null;
  resultText?: string | null;
  isSimulated: boolean;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunData {
  id: string;
  projectId: string;
  runType: "CAPTURE" | "EVALUATE" | "ACTION" | "ARTIFACT" | "CHAT";
  status: "SUCCESS" | "PARTIAL" | "FALLBACK" | "FAILED";
  provider: string;
  trace: Record<string, unknown>;
  fallbackReason?: string | null;
  durationMs?: number | null;
  createdAt: string;
}

export interface AgentCitation {
  cardId: string;
  title: string;
  excerpt: string;
  relevance?: number;
}

export interface AgentChatResponse {
  message: string;
  citations: AgentCitation[];
  proposedActions: ProposedAction[];
  runId: string;
  fallback: boolean;
}

export interface ProjectMetrics {
  cardCount: number;
  relationCount: number;
  associationRate: number;
  traceabilityRate: number;
  interventionCount: number;
  acceptedInterventionCount: number;
  acceptanceRate: number;
  actionCount: number;
  completedActionCount: number;
  actionCompletionRate: number;
  closedLoopCount: number;
  artifactCount: number;
  artifactCoverageRate: number;
  simulatedExcluded: number;
}


export interface AgentExecutionResult<T> {
  data: T;
  provider: string;
  status: "SUCCESS" | "PARTIAL" | "FALLBACK" | "FAILED";
  fallbackReason?: string | null;
  durationMs: number;
  rawResponse?: string | null;
}

export interface CardSearchResult {
  cardId: string;
  title: string;
  summary: string;
  type: KnowledgeTypeValue;
  score: number;
  semanticScore: number;
  keywordScore: number;
  recencyScore: number;
  importanceScore: number;
  reason: string;
  source: string;
  retrievalMode: "hybrid" | "semantic_only" | "keyword_fallback";
  createdAt: string;
}

export interface MilestoneData {
  id: string;
  projectId: string;
  title: string;
  targetDate?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  deliverables: DeliverableData[];
}

export interface DeliverableData {
  id: string;
  milestoneId: string;
  title: string;
  expectedEvidence: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  evidences?: DeliverableEvidenceData[];
}

export interface DeliverableEvidenceData {
  id: string;
  deliverableId: string;
  cardId?: string | null;
  attachmentId?: string | null;
  evidenceType: string;
  confirmed: boolean;
  createdAt: string;
}

export interface AttachmentData {
  id: string;
  projectId: string;
  type: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  extractedText?: string | null;
  extractionStatus: string;
  extractionError?: string | null;
  createdAt: string;
}
