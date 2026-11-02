// 项目前材料草稿的共享合同。
//
// 这里只有“用户给了什么、Agent 读出了什么、用户接受什么、这份确认绑定到哪一版”。
// 预览不是授权：确认前不建立项目，模型建议也不会自动成为项目目标。

export class IntakeMaterialSync {
  state: string = 'PENDING';
  captureId: string = '';
  attachmentId: string = '';
  error: string = '';
}

export class IntakeMaterialView {
  id: string = '';
  label: string = '';
  kind: string = '';
  type: string = '';
  fileName: string = '';
  size: number = 0;
  sha256: string = '';
  extractionStatus: string = '';
  extractionError: string = '';
  revision: number = 0;
  contentHash: string = '';
  sync: IntakeMaterialSync = new IntakeMaterialSync();
}

export class IntakeStatement {
  materialId: string = '';
  materialLabel: string = '';
  quote: string = '';
  meaning: string = '';
}

export class IntakeSuggested {
  title: string = '';
  description: string = '';
  goal: string = '';
  scenario: string = '';
  deadline: string = '';
}

/** 用户接受的字段是建议字段的同一结构；它才是真正写进项目的那一份。 */
export class IntakeAcceptedFields extends IntakeSuggested {
}

export class IntakeConstraint {
  text: string = '';
  basis: string = 'STATED';
  materialId: string = '';
}

export class IntakeUnknown {
  text: string = '';
  whyItMatters: string = '';
}

export class IntakeCriterion {
  text: string = '';
  basis: string = 'STATED';
}

export class IntakeNextQuestion {
  text: string = '';
  why: string = '';
}

export class IntakeCandidate {
  quote: string = '';
  interpretation: string = '';
  reason: string = '';
}

export class IntakeClarify {
  question: string = '';
  reason: string = '';
}

export class IntakeCorrection {
  appliedObjective: string = '';
  constraints: string[] = [];
  until: string = '';
  candidates: IntakeCandidate[] = [];
  clarify: IntakeClarify | null = null;
  admittedAt: string = '';
}

export class IntakeModelState {
  used: boolean = false;
  provider: string = '';
  reason: string = '';
  usageUnknown: boolean = true;
}

export class IntakeCoverageItem {
  materialId: string = '';
  label: string = '';
  kind: string = '';
  type: string = '';
  extractionStatus: string = '';
  availableChars: number = 0;
  plannedChars: number = 0;
  /** -1 表示从未派发过；0 表示派发过但这轮没有送入 */
  lastSentChars: number = -1;
  lastSentTruncated: boolean = false;
  reason: string = '';
}

export class IntakeCoverageLastSent {
  computedAt: string = '';
  revision: number = 0;
  materialsHash: string = '';
  understandingPublished: boolean = false;
  totalAvailableChars: number = 0;
  totalSentChars: number = 0;
}

export class IntakeCoverageCurrent {
  materialsHash: string = '';
  stale: boolean = false;
  totalAvailableChars: number = 0;
  totalSentChars: number = 0;
  items: IntakeCoverageItem[] = [];
}

export class IntakeCoverage {
  schemaVersion: number = 1;
  perMaterialLimit: number = 20000;
  totalLimit: number = 24000;
  consentGranted: boolean = false;
  lastSent: IntakeCoverageLastSent | null = null;
  current: IntakeCoverageCurrent = new IntakeCoverageCurrent();
  note: string = '';
}

export class IntakeMaterialTextReply {
  materialId: string = '';
  label: string = '';
  totalChars: number = 0;
  offset: number = 0;
  limit: number = 4000;
  text: string = '';
  hasMore: boolean = false;
}

export class IntakePreview {
  schemaVersion: number = 1;
  draftId: string = '';
  revision: number = 0;
  status: string = 'DRAFT';
  materialsHash: string = '';
  understandingState: string = 'NONE';
  model: IntakeModelState = new IntakeModelState();
  summary: string = '';
  statements: IntakeStatement[] = [];
  suggested: IntakeSuggested | null = null;
  constraints: IntakeConstraint[] = [];
  unknowns: IntakeUnknown[] = [];
  successCriteria: IntakeCriterion[] = [];
  nextQuestion: IntakeNextQuestion | null = null;
  correction: IntakeCorrection = new IntakeCorrection();
  accepted: IntakeAcceptedFields | null = null;
  coverage: IntakeCoverage = new IntakeCoverage();
  materials: IntakeMaterialView[] = [];
  expiresAt: string = '';
  previewHash: string = '';
}

export class IntakeReadReply {
  preview: IntakePreview = new IntakePreview();
  confirmedProjectId: string = '';
  expiresAt: string = '';
  canConfirm: boolean = false;
}

export class IntakeDraftCreated {
  draftId: string = '';
  replayed: boolean = false;
  status: string = 'DRAFT';
}

export class IntakeMaterialAdded {
  materialId: string = '';
  revision: number = 0;
  replayed: boolean = false;
  extractionStatus: string = '';
}

export class IntakeReviseReply {
  clarify: IntakeClarify | null = null;
  appliedObjective: string = '';
  constraints: string[] = [];
  until: string = '';
  revision: number = 0;
  preview: IntakePreview = new IntakePreview();
}


export class IntakeConfirmReply {
  projectId: string = '';
  replayed: boolean = false;
}

export class IntakeSyncMaterialResult {
  materialId: string = '';
  state: string = 'PENDING';
  error: string = '';
}

export class IntakeSyncReply {
  projectId: string = '';
  materials: IntakeSyncMaterialResult[] = [];
  pending: number = 0;
}

/** 理解状态 → 用户可读标签；不把“未运行”写成“已完成”。 */
export function intakeUnderstandingLabel(state: string): string {
  if (state === 'READY') return '已读懂，请核对';
  if (state === 'FAILED') return '这次没能形成理解';
  if (state === 'MATERIAL_ONLY') return '文件暂无可读文本';
  return '材料已保存';
}

/** 只有理解或材料已就绪、并且未到期时才允许确认；服务端仍会重新校验。 */
export function intakeCanConfirm(status: string, expiresAt: string, now: number): boolean {
  if (!['DRAFT', 'PREVIEW_READY', 'FAILED'].includes(status)) return false;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return false;
  return expiry > now;
}

/** 同步状态汇总：逐份计数，失败不会被显示成“已完成”。 */
export function intakeSyncSummary(materials: IntakeMaterialView[]): string {
  if (materials.length === 0) return '还没有材料';
  let synced = 0;
  let failed = 0;
  for (const item of materials) {
    if (item.sync.state === 'SYNCED') synced++;
    else if (item.sync.state === 'FAILED') failed++;
  }
  if (synced === materials.length) return `材料已全部进入项目（${synced}/${materials.length}）`;
  if (failed > 0) return `已进入项目 ${synced}/${materials.length} 份，${failed} 份需要重试`;
  return `已进入项目 ${synced}/${materials.length} 份`;
}

/** 预览里只有“用户接受”的字段可以写进项目；没有接受字段时用建议值作为编辑起点。 */
export function intakeEditableFields(preview: IntakePreview): IntakeAcceptedFields {
  const fields = new IntakeAcceptedFields();
  fields.scenario = 'COURSE_DESIGN';
  const source: IntakeSuggested | null = preview.accepted !== null ? preview.accepted : preview.suggested;
  if (source === null) return fields;
  fields.title = source.title;
  fields.description = source.description;
  fields.goal = source.goal;
  fields.scenario = source.scenario;
  fields.deadline = source.deadline;
  if (preview.correction.appliedObjective !== '') fields.goal = source.goal;
  return fields;
}

export class IntakeConsentReply {
  consent: boolean = false;
}

export class IntakeConfirmPayload {
  requestId: string = '';
  expectedRevision: number = 0;
  previewHash: string = '';
  accepted: IntakeAcceptedFields = new IntakeAcceptedFields();
}



// 手机端提交载荷：显式类而不是匿名对象字面量（ArkTS 合同）。
export class IntakeCreatePayload {
  requestId: string = '';
}

export class IntakeTextPayload {
  requestId: string = '';
  text: string = '';
}

export class IntakeUnderstandPayload {
  requestId: string = '';
  processingConsent: boolean = true;
}

export class IntakeRevisePayload {
  requestId: string = '';
  text: string = '';
  expectedRevision: number = 0;
}




/**
 * 覆盖提示的用户可读文案：区分“已送入/截取/未送入/没有可读文本/之后新增”。
 * lastSentChars = -1 表示从未派发；0 表示派发过但这一份没有被送入。
 */
export function intakeCoverageItemLabel(item: IntakeCoverageItem): string {
  if (item.reason === 'NO_READABLE_TEXT') return '没有可读文本';
  if (item.reason === 'ADDED_AFTER_UNDERSTANDING') return `之后新增，还没送入（计划 ${item.plannedChars} 字）`;
  if (item.reason === 'OVER_BUDGET') return `超出本轮总量，未送入（共 ${item.availableChars} 字）`;
  if (item.lastSentChars < 0) return `待送入 ${item.plannedChars} 字 / 共 ${item.availableChars} 字`;
  if (item.lastSentChars === 0) return `未送入（共 ${item.availableChars} 字）`;
  if (item.lastSentTruncated) return `送入 ${item.lastSentChars} 字 / 共 ${item.availableChars} 字（截取）`;
  return `已送入 ${item.lastSentChars} 字`;
}

/** 汇总行：上一版实际送入 vs 当前材料规模。 */
export function intakeCoverageSummary(coverage: IntakeCoverage): string {
  if (coverage.lastSent !== null) {
    const prefix = coverage.lastSent.understandingPublished ? '上一版送入' : '上一版送过但未形成理解';
    return `${prefix} ${coverage.lastSent.totalSentChars} 字 / 材料共 ${coverage.lastSent.totalAvailableChars} 字`;
  }
  return `尚未送入 · 下次会送入 ${coverage.current.totalSentChars} 字 / 共 ${coverage.current.totalAvailableChars} 字`;
}
