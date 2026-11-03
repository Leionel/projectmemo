// 服务卡片与 App 的原对象定位合同。
//
// 卡片只表达“打开什么”：project/mission/question/approval/source 与当前版本、期限意图。
// 它不携带执行批准令牌、私人原话或任意跳转 URL；打开后仍由服务端重新鉴权并校验当前版本。
//
// 时间语义：observedAt 只来自 Worker 的成功观察（workState.observedAt），updatedAt 只是
// 本机把快照同步到卡片的时刻。两者分开存储、分开展示，读取/同步绝不冒充“成功观察”。

export class MissionWidgetSnapshot {
  ownerId: string = '';
  projectId: string = '';
  missionId: string = '';
  status: string = '';
  pendingCount: number = 0;
  updatedAt: string = '';
  expiresAt: number = 0;
  // 精确定位：卡片点开的是同一个原问题/提案，不是相似的新任务。
  questionId: string = '';
  approvalId: string = '';
  sourceId: string = '';
  missionVersion: number = 0;
  // 真实状态：等待谁、最后实际观察时间、下次检查时间。
  waitingFor: string = '';
  observedAt: string = '';
  nextCheckAt: string = '';
  // workState 的阶段/原因投影：用于区分停止请求在途、UNKNOWN、不可用等，不当作执行授权。
  phase: string = '';
  reasonCode: string = '';
}

/** 卡片在 TTL 内、属于当前 owner 且属于当前项目时才可展示原 mission 身份。 */
export function visibleMissionWidget(snapshot: MissionWidgetSnapshot, ownerId: string, projectId: string, now: number): boolean {
  return ownerId !== '' && projectId !== '' && snapshot.ownerId === ownerId && snapshot.projectId === projectId &&
    snapshot.missionId !== '' && snapshot.expiresAt > now;
}

/** 卡片的一句话关注点；没有重要变化时不生成“新发现”，也不把 UNKNOWN/停止在途说成成功。 */
export function widgetAttentionLabel(snapshot: MissionWidgetSnapshot, now: number): string {
  if (snapshot.expiresAt > 0 && snapshot.expiresAt <= now) return '缓存已过期，打开后重新核对';
  if (snapshot.approvalId !== '') return '有一项提案等你决定';
  if (snapshot.questionId !== '') return '有一项问题等你补充';
  if (snapshot.reasonCode === 'STOP_REQUESTED_IN_FLIGHT') return '停止请求待结算，不会继续执行';
  if (snapshot.phase === 'UNKNOWN') return '状态待核对，打开后重新核对';
  if (snapshot.phase === 'UNAVAILABLE') return '状态暂不可用，打开后重新核对';
  if (snapshot.reasonCode === 'APPROVAL_EXPIRED') return '原提案已过期，请重新核对';
  if (snapshot.reasonCode === 'DAILY_BUDGET_WAITING') return '额度已用完，等待下次检查';
  if (snapshot.status === 'FAILED') return '执行中断，保留原记录';
  if (snapshot.status === 'PAUSED') return '已暂停，保留原记录';
  if (snapshot.status === 'CANCELLED') return '已取消，历史结果保留，不能视为成功';
  if (snapshot.status === 'OBSOLETE') return '依据已变化，未执行';
  if (snapshot.status === 'SKIPPED') return '已跳过，历史记录保留';
  if (snapshot.status === 'SUCCEEDED') return '委托条件已验收，可回看结果';
  if (snapshot.waitingFor === 'USER') return '等你回应';
  if (snapshot.waitingFor === 'BUDGET') return '预算已用完，等你核对';
  if (snapshot.status === 'RUNNING') return '正在跟进原委托';
  if (snapshot.nextCheckAt !== '') return '尚未到检查时间';
  return '等待下一次检查';
}

/** 观察时间与同步时间分开显示；原始 ISO 时间由写入方先格式化为短时间。 */
export function widgetSyncLabel(snapshot: MissionWidgetSnapshot): string {
  if (snapshot.observedAt !== '') return `上次观察 ${snapshot.observedAt}`;
  if (snapshot.updatedAt !== '') return `上次同步 ${snapshot.updatedAt}`;
  return '尚未同步';
}

/** ISO/时间戳 → “M月D日 HH:mm”；无法解析的既有展示串原样返回，不伪造时间。 */
export function widgetTimeText(raw: string): string {
  const text = raw.trim();
  if (text === '') return '';
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return text;
  const value = new Date(at);
  const pad = (input: number): string => input < 10 ? `0${input}` : `${input}`;
  return `${value.getMonth() + 1}月${value.getDate()}日 ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * 卡片快照期限 = min(5 分钟同步 TTL, 会话到期时间)。
 * 会话期限无法解析时不延长缓存（返回 0，卡片视为不可用），避免无会话期限时无限期展示私有快照。
 */
export function widgetSnapshotExpiry(now: number, sessionExpiresAt: string): number {
  const ttl = now + 300000;
  const session = Date.parse(sessionExpiresAt);
  if (!Number.isFinite(session)) return 0;
  return Math.min(ttl, session);
}

/** 卡片打开原对象时携带的参数：只有定位身份，没有批准令牌或私人正文。 */
export class MissionHandoffParams {
  projectId: string = '';
  missionId: string = '';
  handoffExpiresAt: string = '';
  questionId: string = '';
  approvalId: string = '';
  sourceId: string = '';
  outputId: string = '';
  receiptId: string = '';
  missionVersion: string = '';
}

export function missionHandoffParams(snapshot: MissionWidgetSnapshot): MissionHandoffParams {
  const params = new MissionHandoffParams();
  params.projectId = snapshot.projectId;
  params.missionId = snapshot.missionId;
  params.handoffExpiresAt = String(snapshot.expiresAt);
  params.questionId = snapshot.questionId;
  params.approvalId = snapshot.approvalId;
  params.sourceId = snapshot.sourceId;
  params.missionVersion = snapshot.missionVersion > 0 ? String(snapshot.missionVersion) : '';
  return params;
}

/** 排队/冷启动时过期的定位意图不再打开旧问题，交给 App 回到当前原委托。 */
export function handoffIntentExpired(expiresAt: number, now: number): boolean {
  return !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt <= now;
}

/**
 * 把 Want/卡片意图还原成「打开原 mission 的参数」。
 * - 非过期：带 question/approval/source/output/receipt 精确定位身份；
 * - 过期：只保留 mission 身份与卡片记录的版本线索，不把旧问题/旧提案当作新对象打开。
 * missionVersion 只是历史定位线索，服务端当前版本仍以详情读回为准，不能用于自动选中或批准。
 */
export class MissionHandoffRoute {
  projectId: string = '';
  missionId: string = '';
  questionId: string = '';
  approvalId: string = '';
  sourceId: string = '';
  outputId: string = '';
  receiptId: string = '';
  missionVersion: string = '';
  expired: boolean = false;
}

export function missionHandoffRoute(projectId: string, missionId: string, questionId: string, approvalId: string,
  sourceId: string, outputId: string, receiptId: string, missionVersion: string, handoffExpiresAt: string, now: number): MissionHandoffRoute {
  const route = new MissionHandoffRoute();
  route.projectId = projectId;
  route.missionId = missionId;
  route.missionVersion = missionVersion;
  const parsed = handoffExpiresAt === '' ? 0 : Number(handoffExpiresAt);
  route.expired = handoffIntentExpired(parsed, now);
  if (!route.expired) {
    route.questionId = questionId;
    route.approvalId = approvalId;
    route.sourceId = sourceId;
    route.outputId = outputId;
    route.receiptId = receiptId;
  }
  return route;
}
