// ---- 阶段检查点 → 待办（与 lib/services/episodeActionService.ts 契约一致） ----
//
// 检查点只提供建议：只有用户确认（confirm=true）才创建待办。
// 幂等键由服务端用 revisionId + claimId 生成，重复点击只会得到同一条待办。

export class EpisodeActionBody {
  claimId: string = '';
  confirm: boolean = true;
  /** SUGGESTION | UNBLOCK */
  mode: string = 'SUGGESTION';
  unblockTargetActionId?: string;
}

export class SuggestionEntry {
  /** ADD_REQUIREMENT | ADD_INFORMATION | CREATE_UNBLOCK_ACTION */
  kind: string = '';
  label: string = '';
  targetActionId: string = '';
}

export class SuggestionAvailability {
  /** READY | BLOCKED | UNKNOWN */
  status: string = 'READY';
  summary: string = '';
  canArrangeReminder: boolean = false;
  blockedReason: string | null = null;
  /** 受阻时的解阻入口：不让用户停在死路上 */
  entries: SuggestionEntry[] = [];
}

export class EpisodeActionSource {
  episodeId: string = '';
  revisionId: string = '';
  revision: number = 1;
  claimId: string = '';
}

export class EpisodeActionOutcome {
  actionId: string = '';
  /** true 表示复用了已存在的待办，没有重复创建 */
  reused: boolean = false;
  title: string = '';
  status: string = 'TODO';
  source: EpisodeActionSource = new EpisodeActionSource();
  availability: SuggestionAvailability = new SuggestionAvailability();
}

export class EpisodeActionResponse {
  outcome: EpisodeActionOutcome = new EpisodeActionOutcome();
}
