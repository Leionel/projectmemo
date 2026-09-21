// ---- 项目体检契约（与 lib/types/health.ts 保持一致） ----
//
// 只读、确定性：服务端聚合已有事实并逐条列出问题，不做主观打分，
// 也不生成「健康度 87 分」这类缺乏定义的综合评分。

export class HealthSuggestedTarget {
  /** episode | action | state | attachment | card | deliverable | reminder | meeting | memory */
  kind: string = '';
  id: string | null = null;
  fallback: string | null = null;
}

export class HealthFinding {
  findingCode: string = '';
  /** ACTION_REQUIRED | ATTENTION | INFO */
  severity: string = 'INFO';
  objectType: string = '';
  objectId: string = '';
  title: string = '';
  explanation: string = '';
  observedAt: string = '';
  suggestedAction: string = '';
  suggestedTarget: HealthSuggestedTarget = new HealthSuggestedTarget();
}

export class HealthUnavailableSection {
  section: string = '';
  errorCode: string = '';
  message: string = '';
}

export class HealthGroup {
  severity: string = '';
  count: number = 0;
  findingCodes: string[] = [];
}

export class HealthSeverityCounts {
  actionRequired: number = 0;
  attention: number = 0;
  info: number = 0;
}

export class ProjectHealthReport {
  schemaVersion: number = 1;
  projectId: string = '';
  generatedAt: string = '';
  findings: HealthFinding[] = [];
  groups: HealthGroup[] = [];
  primaryAction: HealthFinding | null = null;
  primaryMessage: string = '';
  unavailable: HealthUnavailableSection[] = [];
  readOnly: boolean = true;
}

export class ProjectHealthResponse {
  report: ProjectHealthReport = new ProjectHealthReport();
}

/** 严重度 → 面向用户的中文标签；界面不直接显示工程枚举 */
export class HealthSeverityCopy {
  static label(severity: string): string {
    if (severity === 'ACTION_REQUIRED') return '需要马上处理';
    if (severity === 'ATTENTION') return '需要留意';
    return '供参考';
  }

  /** 唯一主操作跳转目标：不新增一级导航，按对象类型落到既有页面 */
  static targetLabel(kind: string): string {
    if (kind === 'episode') return '阶段进展';
    if (kind === 'action' || kind === 'reminder') return '待办';
    if (kind === 'meeting') return '主动提醒';
    if (kind === 'deliverable') return '参赛准备';
    if (kind === 'state') return '记录进展';
    if (kind === 'attachment' || kind === 'card' || kind === 'memory') return '知识资产';
    return '项目首页';
  }
}
