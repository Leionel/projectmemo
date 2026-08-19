export type WorkspaceArea = "actions" | "cards" | "interventions" | "artifacts" | "metrics" | "projects";

export type WorkspaceChangeDetail = {
  projectId: string;
  areas: WorkspaceArea[];
};

export type DeadlineState = {
  kind: "none" | "steady" | "upcoming" | "urgent" | "overdue";
  label: string;
  daysRemaining: number | null;
  rank: number;
};

export type ReadinessItem = {
  key: "requirement" | "experiment" | "closed_loop" | "competition_outline" | "defense_ppt" | "readme";
  label: string;
  complete: boolean;
  href: string;
  actionLabel: string;
};

export type CompetitionReadiness = {
  completed: number;
  total: number;
  percentage: number;
  blockingRiskCount: number;
  items: ReadinessItem[];
};

export type ProjectDashboard = {
  activeReminderCount: number;
  highestReminderSeverity: number;
  activeActionCount: number;
  deadline: DeadlineState;
  readiness: CompetitionReadiness;
  nextAction: { label: string; detail: string; href: string; tone: "critical" | "attention" | "steady" };
  attentionScore: number;
};

type InterventionLike = {
  status: string;
  severity: number;
  snoozedUntil?: Date | string | null;
  isSimulated?: boolean;
  triggerType?: string;
};

type ActionLike = {
  status: string;
  priority?: number;
  dueAt?: Date | string | null;
  createdAt?: Date | string;
  completedAt?: Date | string | null;
  resultCardId?: string | null;
  isSimulated?: boolean;
};

export function isInterventionActive(intervention: Pick<InterventionLike, "status" | "snoozedUntil">, now = new Date()) {
  if (intervention.status === "OPEN") return true;
  if (intervention.status !== "SNOOZED" || !intervention.snoozedUntil) return false;
  return new Date(intervention.snoozedUntil).getTime() <= now.getTime();
}

export function getDeadlineState(deadline: Date | string | null | undefined, now = new Date()): DeadlineState {
  if (!deadline) return { kind: "none", label: "未设置截止", daysRemaining: null, rank: 0 };
  const difference = new Date(deadline).getTime() - now.getTime();
  if (difference < 0) {
    const overdueDays = Math.max(1, Math.ceil(Math.abs(difference) / 86_400_000));
    return { kind: "overdue", label: `已逾期 ${overdueDays} 天`, daysRemaining: -overdueDays, rank: 4 };
  }
  const daysRemaining = Math.ceil(difference / 86_400_000);
  if (daysRemaining <= 3) return { kind: "urgent", label: daysRemaining === 0 ? "今天截止" : `${daysRemaining} 天后截止`, daysRemaining, rank: 3 };
  if (daysRemaining <= 14) return { kind: "upcoming", label: `${daysRemaining} 天后截止`, daysRemaining, rank: daysRemaining <= 7 ? 2 : 1 };
  return { kind: "steady", label: `${daysRemaining} 天后截止`, daysRemaining, rank: 0 };
}

export function buildCompetitionReadiness(input: {
  projectId: string;
  cards: Array<{ type: string }>;
  artifacts: Array<{ artifactType: string }>;
  actions: ActionLike[];
  interventions: InterventionLike[];
}, now = new Date()): CompetitionReadiness {
  const projectPath = `/projects/${input.projectId}`;
  const cardTypes = new Set(input.cards.map((card) => String(card.type)));
  const artifactTypes = new Set(input.artifacts.map((artifact) => String(artifact.artifactType)));
  const realActions = input.actions.filter((action) => !action.isSimulated);
  const activeInterventions = input.interventions.filter((item) => !item.isSimulated && isInterventionActive(item, now));
  const items: ReadinessItem[] = [
    { key: "requirement", label: "参赛要求已沉淀", complete: cardTypes.has("requirement"), href: `${projectPath}#capture-box`, actionLabel: "记录参赛要求" },
    { key: "experiment", label: "实验记录已沉淀", complete: cardTypes.has("experiment_log"), href: `${projectPath}?cardType=experiment_log#knowledge-assets`, actionLabel: "补充实验记录" },
    { key: "closed_loop", label: "已有行动复盘闭环", complete: realActions.some((action) => action.status === "DONE" && Boolean(action.resultCardId)), href: `${projectPath}#action-board`, actionLabel: "完成一项行动" },
    { key: "competition_outline", label: "作品说明大纲", complete: artifactTypes.has("competition_outline"), href: `${projectPath}/generate?type=competition_outline`, actionLabel: "生成作品说明" },
    { key: "defense_ppt", label: "答辩 PPT 大纲", complete: artifactTypes.has("defense_ppt"), href: `${projectPath}/generate?type=defense_ppt`, actionLabel: "生成 PPT 大纲" },
    { key: "readme", label: "README 草稿", complete: artifactTypes.has("readme"), href: `${projectPath}/generate?type=readme`, actionLabel: "生成 README" },
  ];
  const completed = items.filter((item) => item.complete).length;
  return {
    completed,
    total: items.length,
    percentage: Math.round((completed / items.length) * 100),
    blockingRiskCount: activeInterventions.filter((item) => item.triggerType === "RISK_UNHANDLED" && item.severity >= 4).length,
    items,
  };
}

export function buildProjectDashboard(input: {
  projectId: string;
  deadline?: Date | string | null;
  cards: Array<{ type: string }>;
  artifacts: Array<{ artifactType: string }>;
  actions: ActionLike[];
  interventions: InterventionLike[];
}, now = new Date()): ProjectDashboard {
  const activeInterventions = input.interventions.filter((item) => !item.isSimulated && isInterventionActive(item, now));
  const activeActions = input.actions.filter((item) => !item.isSimulated && ["TODO", "DOING"].includes(item.status));
  const highestReminderSeverity = activeInterventions.reduce((highest, item) => Math.max(highest, item.severity), 0);
  const deadline = getDeadlineState(input.deadline, now);
  const readiness = buildCompetitionReadiness(input, now);
  const projectPath = `/projects/${input.projectId}`;

  let nextAction: ProjectDashboard["nextAction"];
  if (deadline.rank >= 3) {
    const href = activeInterventions.length ? `${projectPath}#interventions` : activeActions.length ? `${projectPath}#action-board` : `${projectPath}#capture-box`;
    nextAction = { label: "先处理截止风险", detail: deadline.label, href, tone: "critical" };
  } else if (highestReminderSeverity >= 4) {
    nextAction = { label: "处理高优先提醒", detail: `${activeInterventions.length} 条提醒等待确认`, href: `${projectPath}#interventions`, tone: "critical" };
  } else if (activeActions.length) {
    const top = sortActions(activeActions, "smart", now)[0];
    nextAction = { label: "继续最重要待办", detail: top?.dueAt ? `${new Date(top.dueAt).toLocaleDateString("zh-CN")} 截止` : `优先级 ${top?.priority ?? 3}/5`, href: `${projectPath}#action-board`, tone: "attention" };
  } else if (!input.cards.length) {
    nextAction = { label: "记录第一条项目进展", detail: "让 Agent 建立第一张知识卡片", href: `${projectPath}#capture-box`, tone: "attention" };
  } else {
    const gap = readiness.items.find((item) => !item.complete);
    nextAction = gap
      ? { label: gap.actionLabel, detail: `参赛准备度 ${readiness.percentage}%`, href: gap.href, tone: "attention" }
      : { label: "记录最新进展", detail: "保持项目记忆持续更新", href: `${projectPath}#capture-box`, tone: "steady" };
  }

  return {
    activeReminderCount: activeInterventions.length,
    highestReminderSeverity,
    activeActionCount: activeActions.length,
    deadline,
    readiness,
    nextAction,
    attentionScore: deadline.rank * 1000 + highestReminderSeverity * 100 + Math.min(activeActions.length, 9) * 10 + (100 - readiness.percentage),
  };
}

export type ActionSortMode = "smart" | "priority" | "due" | "newest";

export function sortActions<T extends ActionLike>(actions: T[], mode: ActionSortMode, now = new Date()): T[] {
  const time = (value: Date | string | null | undefined, fallback: number) => value ? new Date(value).getTime() : fallback;
  const activeRank = (status: string) => ["TODO", "DOING"].includes(status) ? 0 : status === "DONE" ? 1 : 2;
  return [...actions].sort((left, right) => {
    const statusDifference = activeRank(left.status) - activeRank(right.status);
    if (statusDifference) return statusDifference;
    if (left.status === "DONE" && right.status === "DONE") return time(right.completedAt, 0) - time(left.completedAt, 0);
    if (mode === "priority") return (right.priority ?? 3) - (left.priority ?? 3) || time(right.createdAt, 0) - time(left.createdAt, 0);
    if (mode === "newest") return time(right.createdAt, 0) - time(left.createdAt, 0);
    if (mode === "due") return time(left.dueAt, Number.MAX_SAFE_INTEGER) - time(right.dueAt, Number.MAX_SAFE_INTEGER) || (right.priority ?? 3) - (left.priority ?? 3);
    const leftOverdue = left.dueAt && time(left.dueAt, 0) < now.getTime() ? 1 : 0;
    const rightOverdue = right.dueAt && time(right.dueAt, 0) < now.getTime() ? 1 : 0;
    return rightOverdue - leftOverdue
      || time(left.dueAt, Number.MAX_SAFE_INTEGER) - time(right.dueAt, Number.MAX_SAFE_INTEGER)
      || (right.priority ?? 3) - (left.priority ?? 3)
      || time(right.createdAt, 0) - time(left.createdAt, 0);
  });
}
