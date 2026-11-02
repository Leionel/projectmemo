// 服务卡片与 App 的原对象定位合同。
//
// 卡片只表达“打开什么”：project/mission/question/approval/source 与当前版本、期限意图。
// 它不携带执行批准令牌、私人原话或任意跳转 URL；打开后仍由服务端重新鉴权并校验当前版本。

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
}

export function visibleMissionWidget(snapshot: MissionWidgetSnapshot, ownerId: string, projectId: string, now: number): boolean {
  return ownerId !== '' && projectId !== '' && snapshot.ownerId === ownerId && snapshot.projectId === projectId &&
    snapshot.missionId !== '' && snapshot.expiresAt > now;
}

/** 卡片的一句话关注点；没有重要变化时不生成“新发现”。 */
export function widgetAttentionLabel(snapshot: MissionWidgetSnapshot, now: number): string {
  if (snapshot.expiresAt > 0 && snapshot.expiresAt <= now) return '缓存已过期，打开后重新核对';
  if (snapshot.approvalId !== '') return '有一项提案等你决定';
  if (snapshot.questionId !== '') return '有一项问题等你补充';
  if (snapshot.waitingFor === 'USER') return '等你回应';
  if (snapshot.waitingFor === 'BUDGET') return '预算已用完，等你核对';
  if (snapshot.status === 'PAUSED' || snapshot.status === 'FAILED') return '已暂停，保留原记录';
  if (snapshot.status === 'SUCCEEDED') return '已完成，可回看结果';
  if (snapshot.status === 'RUNNING') return '正在跟进原委托';
  if (snapshot.nextCheckAt !== '') return '尚未到检查时间';
  return '等待下一次检查';
}

/** 卡片只显示真实的同步/观察时间；两者不能互相冒充。 */
export function widgetSyncLabel(snapshot: MissionWidgetSnapshot): string {
  if (snapshot.observedAt !== '') return `上次观察 ${snapshot.observedAt}`;
  if (snapshot.updatedAt !== '') return `上次同步 ${snapshot.updatedAt}`;
  return '尚未同步';
}

/** 卡片打开原对象时携带的参数：只有定位身份，没有批准令牌或私人正文。 */
export class MissionHandoffParams {
  projectId: string = '';
  missionId: string = '';
  handoffExpiresAt: string = '';
  questionId: string = '';
  approvalId: string = '';
  sourceId: string = '';
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
  return expiresAt <= 0 || expiresAt <= now;
}
