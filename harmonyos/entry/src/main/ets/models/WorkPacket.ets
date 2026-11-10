/**
 * final-a-workpacket-v1 的 ArkTS 只读适配层。
 *
 * 服务端（4b69614 源码 lib/types/workPacket.ts）的 JSON 是唯一事实来源：
 * - 新服务端总是显式输出 null 的可空字段（如 observations.lastSuccessfulAt）；
 * - 旧服务端可能整个缺 workPacket，或缺少 4b69614 之后新增的增量字段；
 * - 未来服务端可能给出未知枚举或更高 schemaVersion。
 *
 * 本文件只做“读真实 JSON → 带 known 标记的展示模型”，不用 new 类的默认值
 * 冒充后端事实：缺字段、显式 null、未知枚举三者分开保留。UI 只能消费这里
 * 的派生文本与 isKnown 标记，不重新推断 phase、优先级或授权。
 *
 * 注意：读取本包不会核销 UNKNOWN、不推进成功观察时间、不授予写入资格；
 * primaryAction.requires 只是服务端提交时重查的版本要求，不是客户端凭据。
 */

import { KnowledgeCard } from './Memory';

export const WORK_PACKET_CONTRACT_VERSION: string = 'final-a-workpacket-v1';
export const WORK_PACKET_SCHEMA_VERSION: number = 1;

// ---------- 原始 JSON 安全读取（不假设字段存在，不把缺字段变成空串/0） ----------

function asRecord(value: Object | null | undefined): Record<string, Object> | null {
  if (value === null || value === undefined) { return null; }
  if (typeof value !== 'object') { return null; }
  return value as Record<string, Object>;
}

function asArray(value: Object | null | undefined): Object[] {
  if (value === null || value === undefined) { return []; }
  if (Array.isArray(value)) { return value as Object[]; }
  return [];
}

function has(rec: Record<string, Object> | null, key: string): boolean {
  if (rec === null) { return false; }
  return rec[key] !== undefined;
}

function rawValue(rec: Record<string, Object> | null, key: string): Object | null | undefined {
  if (rec === null) { return undefined; }
  return rec[key];
}

function textOf(rec: Record<string, Object> | null, key: string): string {
  const value = rawValue(rec, key);
  if (typeof value === 'string') { return value as string; }
  return '';
}

function textOrNull(rec: Record<string, Object> | null, key: string): string | null {
  const value = rawValue(rec, key);
  if (typeof value === 'string') { return value as string; }
  return null;
}

function numberOrNull(rec: Record<string, Object> | null, key: string): number | null {
  const value = rawValue(rec, key);
  if (typeof value === 'number') { return value as number; }
  return null;
}

function boolOf(rec: Record<string, Object> | null, key: string): boolean {
  const value = rawValue(rec, key);
  return value === true;
}

function boolOrNull(rec: Record<string, Object> | null, key: string): boolean | null {
  const value = rawValue(rec, key);
  if (value === true) { return true; }
  if (value === false) { return false; }
  return null;
}

// ---------- 展示模型 ----------

/** 主动作种类；未知枚举保留原文并标记 kindKnown=false，不映射成 NONE 或成功。 */
export class WorkPacketActionView {
  present: boolean = false;
  kind: string = '';
  rawKind: string = '';
  kindKnown: boolean = false;
  label: string = '';
  labelKnown: boolean = false;
  targetKind: string = '';
  targetId: string = '';
  targetVersion: number | null = null;
  targetPresent: boolean = false;
  requiresKnown: boolean = false;
  /** 服务端回传的版本要求；只做展示/重查提示，不直接作为客户端凭据提交。 */
  requiresMissionVersion: number | null = null;
  requiresPlanRevision: number | null = null;
  requiresContextVersion: number | null = null;
  requiresConstraintsVersion: number | null = null;
  requiresResearchScopeVersion: number | null = null;
  requiresControlVersion: string | null = null;
  requiresQuestionId: string | null = null;
  requiresApprovalId: string | null = null;
  requiresProposalHash: string | null = null;
  requiresBoundaryAt: string | null = null;
  submissionGuardKnown: boolean = false;
  submissionGuard: string = '';
  readOnlyKnown: boolean = false;
  readOnly: boolean = false;
}

export class WorkPacketBlockerView {
  kind: string = '';
  rawKind: string = '';
  kindKnown: boolean = false;
  code: string = '';
  text: string = '';
  at: string | null = null;
  atKnown: boolean = false;
  blocksActions: boolean = false;
  refKind: string = '';
  refId: string = '';
  refPresent: boolean = false;
}

export class WorkPacketObservationView {
  /** 整个 observation(s) 块是否存在；旧服务缺失时为 false，不能当作 NOT_OBSERVED。 */
  present: boolean = false;
  readAt: string = '';
  readAtKnown: boolean = false;
  state: string = '';
  rawState: string = '';
  stateKnown: boolean = false;
  lastSuccessfulAt: string | null = null;
  lastSuccessfulAtKnown: boolean = false;
  lastFailedAt: string | null = null;
  lastFailedAtKnown: boolean = false;
  lastNoNewInformationAt: string | null = null;
  lastNoNewInformationKnown: boolean = false;
  nextCheckAt: string | null = null;
  nextCheckAtKnown: boolean = false;
  authority: string = '';
  authorityKnown: boolean = false;
}

export class WorkPacketCurrentUseView {
  /** 字段存在（含显式 null）：false 表示旧服务未提供，不是允许。 */
  known: boolean = false;
  /** 显式 null：调用方未提供用户上下文，不能当作允许。 */
  explicitNull: boolean = false;
  state: string = '';
  rawState: string = '';
  stateKnown: boolean = false;
  independentEvidence: boolean = false;
  reason: string = '';
  policy: string = '';
  checkedAt: string = '';
}

export class WorkPacketMaterialFactView {
  kind: string = '';
  refId: string = '';
  revision: number | null = null;
  artifactId: string | null = null;
}

export class WorkPacketMaterialView {
  sourceId: string = '';
  sourceHash: string = '';
  title: string = '';
  availability: string = '';
  availabilityKnown: boolean = false;
  /** 原修订匹配事实；与“当前是否允许使用”不同，旧服务缺失时为 unknown。 */
  revisionAvailability: string = '';
  revisionAvailabilityKnown: boolean = false;
  availabilityMeaning: string = '';
  availabilityMeaningKnown: boolean = false;
  currentUse: WorkPacketCurrentUseView = new WorkPacketCurrentUseView();
  facts: WorkPacketMaterialFactView[] = [];
  excerpt: string | null = null;
  excerptKnown: boolean = false;
  coverageTruncated: boolean = false;
  coverageKnown: boolean = false;
  bodyCoverage: string = '';
  bodyCoverageKnown: boolean = false;
}

export class WorkPacketMaterialUsesView {
  present: boolean = false;
  questionId: string | null = null;
  items: WorkPacketMaterialView[] = [];
  truncated: boolean = false;
  /** 有界窗口说明；“未找到记录”不等于“从未使用”。 */
  coverageKnown: boolean = false;
}

export class WorkPacketStepView {
  id: string = '';
  ordinal: number | null = null;
  toolName: string = '';
  status: string = '';
  rawStatus: string = '';
  statusKnown: boolean = false;
  at: string | null = null;
  atKnown: boolean = false;
  note: string = '';
}

export class WorkPacketOutputView {
  id: string = '';
  revision: number | null = null;
  createdAt: string | null = null;
}

export class WorkPacketActionReceiptView {
  actionId: string = '';
  title: string = '';
  status: string = '';
  rawStatus: string = '';
  statusKnown: boolean = false;
  resultCardId: string | null = null;
  completedAt: string | null = null;
  isSimulated: boolean = false;
}

export class WorkPacketDoneView {
  present: boolean = false;
  steps: WorkPacketStepView[] = [];
  latestOutput: WorkPacketOutputView | null = null;
  receipts: WorkPacketActionReceiptView[] = [];
  coverageLimit: number | null = null;
  coverageTruncated: boolean = false;
  coverageKnown: boolean = false;
  note: string = '';
}

export class WorkPacketStoppedView {
  present: boolean = false;
  phase: string = '';
  rawPhase: string = '';
  phaseKnown: boolean = false;
  nextActor: string = '';
  reasonCode: string = '';
  reasonText: string = '';
  actionLabel: string = '';
  observedAt: string | null = null;
  observedAtKnown: boolean = false;
  nextCheckAt: string | null = null;
  nextBoundary: string | null = null;
  freshness: string = '';
  freshnessKnown: boolean = false;
  terminalPresent: boolean = false;
  terminalStatus: string = '';
  terminalAt: string | null = null;
  terminalReasonCode: string = '';
  unsettledPresent: boolean = false;
  unsettledCode: string | null = null;
  unsettledSource: string = '';
  unsettledText: string | null = null;
  stopRequestKnown: boolean = false;
  stopState: string = '';
  stopRawState: string = '';
  stopStateKnown: boolean = false;
  stopRequestedAt: string | null = null;
  stopSettled: boolean | null = null;
  stopNote: string | null = null;
  missionStatus: string = '';
}

export class WorkPacketNextView {
  present: boolean = false;
  nextActor: string = '';
  waitingOn: string = '';
  rawWaitingOn: string = '';
  waitingOnKnown: boolean = false;
  nextCheckAt: string | null = null;
  nextBoundary: string | null = null;
  primaryAction: WorkPacketActionView = new WorkPacketActionView();
  note: string = '';
}

export class WorkPacketIdentityView {
  present: boolean = false;
  missionId: string = '';
  projectId: string = '';
  missionVersion: number | null = null;
  missionStatus: string = '';
  planRevision: number | null = null;
  contextVersion: number | null = null;
  constraintsVersion: number | null = null;
  researchScopeVersion: number | null = null;
  controlVersion: string | null = null;
  originalVersion: number | null = null;
}

export class WorkPacketAuthorityView {
  present: boolean = false;
  controlVersion: string | null = null;
  permissionState: string = '';
  rawPermissionState: string = '';
  permissionStateKnown: boolean = false;
  permissionExpiresAt: string | null = null;
  deadline: string | null = null;
  nextBoundary: string | null = null;
  effectiveNextCheckAt: string | null = null;
  workerPresence: string = '';
  workerPresenceKnown: boolean = false;
  /** 累计用量只展示原计数；null 表示该计数未知，不补 0。 */
  cumulativeModels: number | null = null;
  cumulativeTools: number | null = null;
  cumulativeUnknownCalls: number | null = null;
  limitsKnown: boolean = false;
}

export class WorkPacketCoverageWindowView {
  name: string = '';
  limit: number | null = null;
  returned: number | null = null;
  truncated: boolean = false;
  note: string = '';
}

export class WorkPacketView {
  present: boolean = false;
  contractVersion: string = '';
  schemaVersion: number | null = null;
  /** 合同版本与 schemaVersion 都可识别时才为 true；未知版本只展示“不可解释”提示。 */
  contractCompatible: boolean = false;
  readAt: string = '';
  readAtKnown: boolean = false;
  identity: WorkPacketIdentityView = new WorkPacketIdentityView();
  snapshotConsistency: string = '';
  rawSnapshotConsistency: string = '';
  snapshotConsistencyKnown: boolean = false;
  snapshotRetries: number | null = null;
  snapshotCheckedAt: string = '';
  snapshotCheckedAtKnown: boolean = false;
  authority: WorkPacketAuthorityView = new WorkPacketAuthorityView();
  observations: WorkPacketObservationView = new WorkPacketObservationView();
  done: WorkPacketDoneView = new WorkPacketDoneView();
  materials: WorkPacketMaterialUsesView = new WorkPacketMaterialUsesView();
  basisPresent: boolean = false;
  basisQuestionId: string | null = null;
  currentUsePolicy: string = '';
  currentUsePolicyKnown: boolean = false;
  stopped: WorkPacketStoppedView = new WorkPacketStoppedView();
  next: WorkPacketNextView = new WorkPacketNextView();
  blockers: WorkPacketBlockerView[] = [];
  blockersPresent: boolean = false;
  coverageWindows: WorkPacketCoverageWindowView[] = [];
  coveragePolicy: string = '';
  coverageKnown: boolean = false;
  realityOutcome: string = '';
  realityOutcomeKnown: boolean = false;
}

/** 读回根对象的增量：旧服务没有 workPacket 时 workPacket=null，但原详情仍可用。 */
export class ReadbackDeltaView {
  readAt: string = '';
  readAtKnown: boolean = false;
  observation: WorkPacketObservationView = new WorkPacketObservationView();
  workPacket: WorkPacketView | null = null;
  /** 顶层 materialUses；新服务与旧服务都有该块，但旧服务无 currentUse/revisionAvailability。 */
  materialsPresent: boolean = false;
  materials: WorkPacketMaterialView[] = [];
  materialsTruncated: boolean = false;
  materialsCoverageKnown: boolean = false;
  /** workPacket 缺失：旧后端，退回原详情而不是伪造摘要。 */
  legacyServer: boolean = false;
}

// ---------- 已知枚举与展示辅助 ----------

const ACTION_KINDS: string[] = ['ANSWER_QUESTION', 'REVIEW_APPROVAL', 'RESUME_DELEGATION', 'RECHECK_AUTHORITY',
  'CHECK_UNKNOWN_EFFECT', 'CHECK_STOP_SETTLEMENT', 'WAIT_FOR_OBSERVATION', 'REVIEW_FAILURE', 'VIEW_RESULT', 'NONE'];
const BLOCKER_KINDS: string[] = ['AUTHORITY', 'WORK_STATE', 'STOP_REQUEST', 'BUDGET', 'SOURCE', 'APPROVAL',
  'QUESTION', 'LEASE', 'UNKNOWN_EFFECT', 'FAILURE', 'DELEGATION', 'TIME_BOUNDARY'];
const WAITING_ON: string[] = ['USER_INPUT', 'USER_APPROVAL', 'USER_RECHECK', 'SYSTEM_WORKER', 'SYSTEM_SETTLEMENT',
  'SYSTEM_OBSERVATION', 'SYSTEM_LEASE', 'SYSTEM_RECHECK', 'BUDGET_RESET', 'NONE'];
const TARGET_KINDS: string[] = ['MISSION', 'QUESTION', 'APPROVAL', 'OUTPUT', 'ACTION', 'SOURCE'];
const OBSERVATION_STATES: string[] = ['OBSERVED', 'NOT_OBSERVED', 'FAILED_LAST'];
const STOP_STATES: string[] = ['NONE', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED', 'PAUSE_SETTLED', 'CANCEL_SETTLED'];
const PHASES: string[] = ['QUEUED', 'RUNNING', 'WAITING_OBSERVATION', 'WAITING_USER', 'WAITING_APPROVAL',
  'PAUSED', 'FAILED', 'UNKNOWN', 'COMPLETED', 'UNAVAILABLE'];
const CURRENT_USE_STATES: string[] = ['ALLOWED', 'SUPPRESSED', 'UNKNOWN'];
const AVAILABILITY_STATES: string[] = ['CURRENT', 'CHANGED', 'UNAVAILABLE'];
const AUTH_STATES: string[] = ['WITHIN_TIME_BOUNDARY', 'EXPIRED', 'STOPPED', 'UNKNOWN'];

function known(raw: string, allowed: string[]): boolean {
  return raw !== '' && allowed.includes(raw);
}

// ---------- 解析 ----------

function parseAction(value: Object | null | undefined): WorkPacketActionView {
  const view = new WorkPacketActionView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  const rawKind = textOf(rec, 'kind');
  view.rawKind = rawKind;
  view.kindKnown = known(rawKind, ACTION_KINDS);
  view.kind = view.kindKnown ? rawKind : 'UNKNOWN_ACTION';
  view.label = textOf(rec, 'label');
  view.labelKnown = has(rec, 'label') && typeof rawValue(rec, 'label') === 'string';
  const target = asRecord(rawValue(rec, 'target'));
  if (target !== null) {
    view.targetPresent = true;
    const rawTargetKind = textOf(target, 'kind');
    view.targetKind = known(rawTargetKind, TARGET_KINDS) ? rawTargetKind : 'UNKNOWN';
    view.targetId = textOf(target, 'id');
    view.targetVersion = numberOrNull(target, 'version');
  }
  const requires = asRecord(rawValue(rec, 'requires'));
  if (requires !== null) {
    view.requiresKnown = true;
    view.requiresMissionVersion = numberOrNull(requires, 'missionVersion');
    view.requiresPlanRevision = numberOrNull(requires, 'planRevision');
    view.requiresContextVersion = numberOrNull(requires, 'contextVersion');
    view.requiresConstraintsVersion = numberOrNull(requires, 'constraintsVersion');
    view.requiresResearchScopeVersion = numberOrNull(requires, 'researchScopeVersion');
    view.requiresControlVersion = textOrNull(requires, 'controlVersion');
    view.requiresQuestionId = textOrNull(requires, 'questionId');
    view.requiresApprovalId = textOrNull(requires, 'approvalId');
    view.requiresProposalHash = textOrNull(requires, 'proposalHash');
    view.requiresBoundaryAt = textOrNull(requires, 'boundaryAt');
  }
  view.submissionGuardKnown = has(rec, 'submissionGuard') && typeof rawValue(rec, 'submissionGuard') === 'string';
  view.submissionGuard = textOf(rec, 'submissionGuard');
  const readOnly = boolOrNull(rec, 'readOnly');
  view.readOnlyKnown = readOnly !== null;
  view.readOnly = readOnly === true;
  return view;
}

function parseBlocker(value: Object | null | undefined): WorkPacketBlockerView {
  const view = new WorkPacketBlockerView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  const rawKind = textOf(rec, 'kind');
  view.rawKind = rawKind;
  view.kindKnown = known(rawKind, BLOCKER_KINDS);
  view.kind = view.kindKnown ? rawKind : 'UNKNOWN_BLOCKER';
  view.code = textOf(rec, 'code');
  view.text = textOf(rec, 'text');
  view.at = textOrNull(rec, 'at');
  view.atKnown = has(rec, 'at');
  view.blocksActions = boolOf(rec, 'blocksActions');
  const ref = asRecord(rawValue(rec, 'originalRef'));
  if (ref !== null) {
    view.refPresent = true;
    const rawRefKind = textOf(ref, 'kind');
    view.refKind = known(rawRefKind, TARGET_KINDS) ? rawRefKind : 'UNKNOWN';
    view.refId = textOf(ref, 'id');
  }
  return view;
}

function parseObservations(value: Object | null | undefined): WorkPacketObservationView {
  const view = new WorkPacketObservationView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  view.readAt = textOf(rec, 'readAt');
  view.readAtKnown = has(rec, 'readAt') && typeof rawValue(rec, 'readAt') === 'string';
  const rawState = textOf(rec, 'state');
  view.rawState = rawState;
  view.stateKnown = known(rawState, OBSERVATION_STATES);
  view.state = view.stateKnown ? rawState : 'UNKNOWN';
  view.lastSuccessfulAt = textOrNull(rec, 'lastSuccessfulAt');
  view.lastSuccessfulAtKnown = has(rec, 'lastSuccessfulAt');
  view.lastFailedAt = textOrNull(rec, 'lastFailedAt');
  view.lastFailedAtKnown = has(rec, 'lastFailedAt');
  view.lastNoNewInformationAt = textOrNull(rec, 'lastNoNewInformationAt');
  view.lastNoNewInformationKnown = has(rec, 'lastNoNewInformationAt');
  view.nextCheckAt = textOrNull(rec, 'nextCheckAt');
  view.nextCheckAtKnown = has(rec, 'nextCheckAt');
  view.authority = textOf(rec, 'authority');
  view.authorityKnown = has(rec, 'authority') && typeof rawValue(rec, 'authority') === 'string';
  return view;
}

function parseCurrentUse(value: Object | null | undefined): WorkPacketCurrentUseView {
  const view = new WorkPacketCurrentUseView();
  const rec = asRecord(value);
  if (rec === null) {
    // 字段存在但为 null（调用方未提供用户上下文）与旧服务缺字段要区分。
    view.known = true;
    view.explicitNull = true;
    view.state = 'UNKNOWN';
    return view;
  }
  view.known = true;
  const rawState = textOf(rec, 'state');
  view.rawState = rawState;
  view.stateKnown = known(rawState, CURRENT_USE_STATES);
  view.state = view.stateKnown ? rawState : 'UNKNOWN';
  view.independentEvidence = boolOf(rec, 'independentEvidence');
  view.reason = textOf(rec, 'reason');
  view.policy = textOf(rec, 'policy');
  view.checkedAt = textOf(rec, 'checkedAt');
  return view;
}

function parseMaterial(value: Object | null | undefined): WorkPacketMaterialView {
  const view = new WorkPacketMaterialView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  const pointer = asRecord(rawValue(rec, 'sourcePointer'));
  if (pointer !== null) {
    view.sourceId = textOf(pointer, 'id');
    view.sourceHash = textOf(pointer, 'hash');
  }
  view.title = textOf(rec, 'title');
  const availability = textOf(rec, 'availability');
  view.availability = availability;
  view.availabilityKnown = has(rec, 'availability') && known(availability, AVAILABILITY_STATES);
  const revisionAvailability = textOf(rec, 'revisionAvailability');
  view.revisionAvailability = revisionAvailability;
  view.revisionAvailabilityKnown = has(rec, 'revisionAvailability') && known(revisionAvailability, AVAILABILITY_STATES);
  view.availabilityMeaning = textOf(rec, 'availabilityMeaning');
  view.availabilityMeaningKnown = has(rec, 'availabilityMeaning') && view.availabilityMeaning !== '';
  if (has(rec, 'currentUse')) {
    view.currentUse = parseCurrentUse(rawValue(rec, 'currentUse'));
  }
  const facts = asArray(rawValue(rec, 'facts'));
  for (const factValue of facts) {
    const fact = asRecord(factValue);
    if (fact === null) { continue; }
    const item = new WorkPacketMaterialFactView();
    item.kind = textOf(fact, 'kind');
    item.refId = textOf(fact, 'refId');
    item.revision = numberOrNull(fact, 'revision');
    item.artifactId = textOrNull(fact, 'artifactId');
    view.facts.push(item);
  }
  if (has(rec, 'excerpt')) {
    view.excerpt = textOrNull(rec, 'excerpt');
    view.excerptKnown = true;
  }
  const coverage = asRecord(rawValue(rec, 'coverage'));
  if (coverage !== null) {
    view.coverageKnown = true;
    view.coverageTruncated = boolOf(coverage, 'truncated');
  }
  view.bodyCoverage = textOf(rec, 'bodyCoverage');
  view.bodyCoverageKnown = has(rec, 'bodyCoverage') && view.bodyCoverage !== '';
  return view;
}

function parseMaterials(value: Object | null | undefined): WorkPacketMaterialUsesView {
  const view = new WorkPacketMaterialUsesView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  view.questionId = textOrNull(rec, 'questionId');
  const items = asArray(rawValue(rec, 'items'));
  for (const itemValue of items) {
    const item = parseMaterial(itemValue);
    if (item.sourceId !== '' || item.title !== '') { view.items.push(item); }
  }
  const coverage = asRecord(rawValue(rec, 'coverage'));
  if (coverage !== null) {
    view.coverageKnown = true;
    view.truncated = boolOf(coverage, 'eventsTruncated') || boolOf(coverage, 'stepsTruncated') ||
      boolOf(coverage, 'outputsTruncated') || boolOf(coverage, 'runsTruncated') || boolOf(coverage, 'sourceLimitReached');
  }
  return view;
}

function parseDone(value: Object | null | undefined): WorkPacketDoneView {
  const view = new WorkPacketDoneView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  const steps = asArray(rawValue(rec, 'recentSteps'));
  for (const stepValue of steps) {
    const step = asRecord(stepValue);
    if (step === null) { continue; }
    const item = new WorkPacketStepView();
    item.id = textOf(step, 'id');
    item.ordinal = numberOrNull(step, 'ordinal');
    item.toolName = textOf(step, 'toolName');
    const status = textOf(step, 'status');
    item.rawStatus = status;
    item.statusKnown = status !== '';
    item.status = status;
    item.at = textOrNull(step, 'at');
    item.atKnown = has(step, 'at');
    item.note = textOf(step, 'note');
    view.steps.push(item);
  }
  const output = asRecord(rawValue(rec, 'latestOutput'));
  if (output !== null) {
    const item = new WorkPacketOutputView();
    item.id = textOf(output, 'id');
    item.revision = numberOrNull(output, 'revision');
    item.createdAt = textOrNull(output, 'createdAt');
    view.latestOutput = item;
  }
  const receipts = asArray(rawValue(rec, 'actionReceipts'));
  for (const receiptValue of receipts) {
    const receipt = asRecord(receiptValue);
    if (receipt === null) { continue; }
    const item = new WorkPacketActionReceiptView();
    item.actionId = textOf(receipt, 'actionId');
    item.title = textOf(receipt, 'title');
    item.rawStatus = textOf(receipt, 'status');
    item.statusKnown = item.rawStatus !== '';
    item.status = item.rawStatus;
    item.resultCardId = textOrNull(receipt, 'resultCardId');
    item.completedAt = textOrNull(receipt, 'completedAt');
    item.isSimulated = boolOf(receipt, 'isSimulated');
    view.receipts.push(item);
  }
  const coverage = asRecord(rawValue(rec, 'coverage'));
  if (coverage !== null) {
    view.coverageKnown = true;
    view.coverageLimit = numberOrNull(coverage, 'limit');
    view.coverageTruncated = boolOf(coverage, 'truncated');
  }
  view.note = textOf(rec, 'note');
  return view;
}

function parseStopped(value: Object | null | undefined): WorkPacketStoppedView {
  const view = new WorkPacketStoppedView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  view.missionStatus = textOf(rec, 'missionStatus');
  const workState = asRecord(rawValue(rec, 'workState'));
  if (workState !== null) {
    const rawPhase = textOf(workState, 'phase');
    view.rawPhase = rawPhase;
    view.phaseKnown = known(rawPhase, PHASES);
    view.phase = view.phaseKnown ? rawPhase : 'UNKNOWN';
    view.nextActor = textOf(workState, 'nextActor');
    view.reasonCode = textOf(workState, 'reasonCode');
    view.reasonText = textOf(workState, 'reasonText');
    view.actionLabel = textOf(workState, 'actionLabel');
    view.observedAt = textOrNull(workState, 'observedAt');
    view.observedAtKnown = has(workState, 'observedAt');
    view.nextCheckAt = textOrNull(workState, 'nextCheckAt');
    view.nextBoundary = textOrNull(workState, 'nextBoundary');
    view.freshness = textOf(workState, 'freshness');
    view.freshnessKnown = view.freshness !== '';
    const terminal = asRecord(rawValue(workState, 'terminal'));
    if (terminal !== null) {
      view.terminalPresent = true;
      view.terminalStatus = textOf(terminal, 'status');
      view.terminalAt = textOrNull(terminal, 'at');
      view.terminalReasonCode = textOf(terminal, 'reasonCode');
    }
    const unsettled = asRecord(rawValue(workState, 'unsettledEffect'));
    if (unsettled !== null) {
      view.unsettledPresent = boolOf(unsettled, 'present');
      view.unsettledCode = textOrNull(unsettled, 'code');
      view.unsettledSource = textOf(unsettled, 'source');
      view.unsettledText = textOrNull(unsettled, 'reasonText');
    }
    if (has(workState, 'stopRequest')) {
      const stop = asRecord(rawValue(workState, 'stopRequest'));
      view.stopRequestKnown = stop !== null;
      if (stop !== null) {
        const rawState = textOf(stop, 'state');
        view.stopRawState = rawState;
        view.stopStateKnown = known(rawState, STOP_STATES);
        view.stopState = view.stopStateKnown ? rawState : 'UNKNOWN';
        view.stopRequestedAt = textOrNull(stop, 'requestedAt');
        view.stopSettled = boolOrNull(stop, 'settled');
        view.stopNote = textOrNull(stop, 'note');
      }
    }
  }
  return view;
}

function parseNext(value: Object | null | undefined): WorkPacketNextView {
  const view = new WorkPacketNextView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  view.nextActor = textOf(rec, 'nextActor');
  const rawWaitingOn = textOf(rec, 'waitingOn');
  view.rawWaitingOn = rawWaitingOn;
  view.waitingOnKnown = known(rawWaitingOn, WAITING_ON);
  view.waitingOn = view.waitingOnKnown ? rawWaitingOn : 'UNKNOWN';
  view.nextCheckAt = textOrNull(rec, 'nextCheckAt');
  view.nextBoundary = textOrNull(rec, 'nextBoundary');
  view.note = textOf(rec, 'note');
  if (has(rec, 'primaryAction')) {
    view.primaryAction = parseAction(rawValue(rec, 'primaryAction'));
  }
  return view;
}

function parseIdentity(value: Object | null | undefined): WorkPacketIdentityView {
  const view = new WorkPacketIdentityView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  view.missionId = textOf(rec, 'missionId');
  view.projectId = textOf(rec, 'projectId');
  view.missionVersion = numberOrNull(rec, 'missionVersion');
  view.missionStatus = textOf(rec, 'missionStatus');
  view.planRevision = numberOrNull(rec, 'planRevision');
  view.contextVersion = numberOrNull(rec, 'contextVersion');
  view.constraintsVersion = numberOrNull(rec, 'constraintsVersion');
  view.researchScopeVersion = numberOrNull(rec, 'researchScopeVersion');
  view.controlVersion = textOrNull(rec, 'controlVersion');
  const original = asRecord(rawValue(rec, 'originalRef'));
  if (original !== null) { view.originalVersion = numberOrNull(original, 'version'); }
  return view;
}

function parseAuthority(value: Object | null | undefined): WorkPacketAuthorityView {
  const view = new WorkPacketAuthorityView();
  const rec = asRecord(value);
  if (rec === null) { return view; }
  view.present = true;
  view.controlVersion = textOrNull(rec, 'controlVersion');
  const rawPermission = textOf(rec, 'permissionState');
  view.rawPermissionState = rawPermission;
  view.permissionStateKnown = known(rawPermission, AUTH_STATES);
  view.permissionState = view.permissionStateKnown ? rawPermission : 'UNKNOWN';
  view.permissionExpiresAt = textOrNull(rec, 'permissionExpiresAt');
  view.deadline = textOrNull(rec, 'deadline');
  view.nextBoundary = textOrNull(rec, 'nextBoundary');
  view.effectiveNextCheckAt = textOrNull(rec, 'effectiveNextCheckAt');
  view.workerPresence = textOf(rec, 'workerPresence');
  view.workerPresenceKnown = view.workerPresence !== '';
  const budget = asRecord(rawValue(rec, 'budget'));
  if (budget !== null) {
    view.limitsKnown = true;
    const used = asRecord(rawValue(budget, 'cumulativeUsed'));
    if (used !== null) {
      view.cumulativeModels = numberOrNull(used, 'models');
      view.cumulativeTools = numberOrNull(used, 'tools');
      view.cumulativeUnknownCalls = numberOrNull(used, 'unknownCalls');
    }
  }
  return view;
}

function parseCoverage(value: Object | null | undefined): WorkPacketCoverageWindowView[] {
  const windows = asArray(asRecord(value) !== null ? rawValue(asRecord(value), 'windows') : null);
  const result: WorkPacketCoverageWindowView[] = [];
  for (const windowValue of windows) {
    const rec = asRecord(windowValue);
    if (rec === null) { continue; }
    const item = new WorkPacketCoverageWindowView();
    item.name = textOf(rec, 'name');
    item.limit = numberOrNull(rec, 'limit');
    item.returned = numberOrNull(rec, 'returned');
    item.truncated = boolOf(rec, 'truncated');
    item.note = textOf(rec, 'note');
    if (item.name !== '') { result.push(item); }
  }
  return result;
}

export function parseWorkPacket(value: Object | null | undefined): WorkPacketView | null {
  const rec = asRecord(value);
  if (rec === null) { return null; }
  const view = new WorkPacketView();
  view.present = true;
  view.contractVersion = textOf(rec, 'contractVersion');
  view.schemaVersion = numberOrNull(rec, 'schemaVersion');
  view.contractCompatible = view.contractVersion === WORK_PACKET_CONTRACT_VERSION &&
    view.schemaVersion === WORK_PACKET_SCHEMA_VERSION;
  view.readAt = textOf(rec, 'readAt');
  view.readAtKnown = has(rec, 'readAt') && typeof rawValue(rec, 'readAt') === 'string';
  view.identity = parseIdentity(rawValue(rec, 'identity'));
  const snapshot = asRecord(rawValue(rec, 'snapshot'));
  if (snapshot !== null) {
    const rawConsistency = textOf(snapshot, 'consistency');
    view.rawSnapshotConsistency = rawConsistency;
    view.snapshotConsistencyKnown = rawConsistency !== '';
    view.snapshotConsistency = rawConsistency;
    view.snapshotRetries = numberOrNull(snapshot, 'retries');
    view.snapshotCheckedAt = textOf(snapshot, 'checkedAt');
    view.snapshotCheckedAtKnown = view.snapshotCheckedAt !== '';
  }
  view.authority = parseAuthority(rawValue(rec, 'authority'));
  view.observations = parseObservations(rawValue(rec, 'observations'));
  view.done = parseDone(rawValue(rec, 'done'));
  const basis = asRecord(rawValue(rec, 'basis'));
  if (basis !== null) {
    view.basisPresent = true;
    view.basisQuestionId = textOrNull(basis, 'questionId');
    view.materials = parseMaterials(rawValue(basis, 'materialUses'));
    view.currentUsePolicy = textOf(basis, 'currentUsePolicy');
    view.currentUsePolicyKnown = view.currentUsePolicy !== '';
  }
  view.stopped = parseStopped(rawValue(rec, 'stopped'));
  view.next = parseNext(rawValue(rec, 'next'));
  view.blockersPresent = has(rec, 'blockers');
  const blockers = asArray(rawValue(rec, 'blockers'));
  for (const blockerValue of blockers) {
    const blocker = parseBlocker(blockerValue);
    if (blocker.code !== '' || blocker.text !== '') { view.blockers.push(blocker); }
  }
  const coverage = asRecord(rawValue(rec, 'coverage'));
  if (coverage !== null) {
    view.coverageKnown = true;
    view.coverageWindows = parseCoverage(coverage);
    view.coveragePolicy = textOf(coverage, 'policy');
  }
  view.realityOutcome = textOf(rec, 'realityOutcome');
  view.realityOutcomeKnown = view.realityOutcome !== '';
  return view;
}

/** 从 GET /readback 的根 JSON 解析工作包、观察与资料当前许可增量。 */
export function readbackDelta(value: Object | null | undefined): ReadbackDeltaView {
  const delta = new ReadbackDeltaView();
  const rec = asRecord(value);
  if (rec === null) { return delta; }
  delta.readAt = textOf(rec, 'readAt');
  delta.readAtKnown = has(rec, 'readAt') && typeof rawValue(rec, 'readAt') === 'string';
  if (has(rec, 'observation')) {
    delta.observation = parseObservations(rawValue(rec, 'observation'));
  }
  if (has(rec, 'workPacket')) {
    delta.workPacket = parseWorkPacket(rawValue(rec, 'workPacket'));
  }
  delta.legacyServer = delta.workPacket === null;
  if (has(rec, 'materialUses')) {
    const uses = parseMaterials(rawValue(rec, 'materialUses'));
    delta.materialsPresent = uses.present;
    delta.materials = uses.items;
    delta.materialsTruncated = uses.truncated;
    delta.materialsCoverageKnown = uses.coverageKnown;
  }
  // workPacket 若存在，以同一快照内 basis.materialUses 为准（读取同一事务）。
  if (delta.workPacket !== null && delta.workPacket.materials.present) {
    delta.materialsPresent = true;
    delta.materials = delta.workPacket.materials.items;
    delta.materialsTruncated = delta.workPacket.materials.truncated;
    delta.materialsCoverageKnown = delta.workPacket.materials.coverageKnown;
  }
  // observation 优先用同一工作包内的 observations 块。
  if (delta.workPacket !== null && delta.workPacket.observations.present) {
    delta.observation = delta.workPacket.observations;
  }
  return delta;
}

// ---------- 展示派生（纯函数，可在本地单测中断言） ----------

export function shortPacketTime(at: string): string {
  if (at === '') { return ''; }
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) { return at; }
  const date = new Date(parsed);
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

/** 读取时间与观察结果分开：读取只推进 readAt，不推进成功观察时间。 */
export function observationLine(view: WorkPacketObservationView): string {
  if (!view.present) { return '观察：旧服务未提供观察时间（未知）'; }
  if (!view.stateKnown) { return `观察：新的观察状态（${view.rawState}），请刷新客户端后核对`; }
  if (view.state === 'OBSERVED') {
    if (view.lastSuccessfulAtKnown && view.lastSuccessfulAt !== null) {
      const extra = view.lastNoNewInformationKnown && view.lastNoNewInformationAt !== null ? ' · 最近结论：无新变化' : '';
      return `最近成功观察 ${shortPacketTime(view.lastSuccessfulAt)}${extra}`;
    }
    return '观察成功但服务端未提供最近成功观察时间（未知）';
  }
  if (view.state === 'FAILED_LAST') {
    const lastSuccess = view.lastSuccessfulAtKnown && view.lastSuccessfulAt !== null
      ? ` · 上次成功 ${shortPacketTime(view.lastSuccessfulAt)}` : ' · 无成功观察记录';
    return `最近观察失败${view.lastFailedAtKnown && view.lastFailedAt !== null ? ' ' + shortPacketTime(view.lastFailedAt) : ''}${lastSuccess}`;
  }
  // NOT_OBSERVED
  if (view.lastSuccessfulAtKnown && view.lastSuccessfulAt !== null) {
    return `尚未再次观察成功 · 上次成功 ${shortPacketTime(view.lastSuccessfulAt)}`;
  }
  if (view.lastSuccessfulAtKnown) { return '尚未成功观察（读取或刷新不算观察成功）'; }
  return '尚未成功观察 · 旧服务未提供观察时间（未知）';
}

/** 停止维度：停止请求在途、未结算效果、终态必须并列，不能统一显示成功。 */
export function stopSummary(view: WorkPacketStoppedView): string {
  const parts: string[] = [];
  if (view.stopRequestKnown) {
    if (!view.stopStateKnown) {
      parts.push(`停止请求状态未知（${view.stopRawState}）`);
    } else if (view.stopState === 'PAUSE_REQUESTED' || view.stopState === 'CANCEL_REQUESTED') {
      const label = view.stopState === 'PAUSE_REQUESTED' ? '暂停' : '取消';
      parts.push(`已收到${label}请求，尚未结算${view.stopSettled === false ? '；不会继续派发新步骤' : ''}`);
    } else if (view.stopState === 'PAUSE_SETTLED') {
      parts.push('暂停请求已结算');
    } else if (view.stopState === 'CANCEL_SETTLED') {
      parts.push('取消请求已结算');
    }
  }
  if (view.unsettledPresent) {
    const code = view.unsettledCode !== null ? view.unsettledCode : '未记录代码';
    parts.push(`存在未结算效果（${code}），读取不会自动核销`);
  }
  if (view.terminalPresent) {
    if (view.terminalStatus === 'CANCELLED' || view.terminalReasonCode === 'CANCELLED') {
      parts.push('原委托已取消（不是成功）');
    } else if (view.terminalStatus === 'SUCCEEDED') {
      parts.push('原验收条件已通过；现实效果仍待回执核实');
    }
  }
  if (!view.phaseKnown && view.rawPhase !== '') {
    parts.push(`未知生命周期阶段（${view.rawPhase}）`);
  } else if (view.phase === 'UNKNOWN') {
    parts.push('原状态待核对');
  }
  if (parts.length === 0) {
    parts.push(view.reasonText !== '' ? view.reasonText : '当前没有已知阻断');
  }
  return parts.join('；');
}

/** 做到哪：有界窗口 + 覆盖说明，不把“未找到”写成“从未发生”。 */
export function doneSummary(view: WorkPacketDoneView): string {
  if (!view.present) { return '最近工作：旧服务未提供（未知）'; }
  const parts: string[] = [];
  if (view.steps.length > 0) {
    parts.push(`最近 ${view.steps.length} 项执行记录`);
  } else {
    parts.push('有界窗口内没有执行记录（不等于从未执行）');
  }
  if (view.latestOutput !== null && view.latestOutput.revision !== null) {
    parts.push(`最新草稿修订 ${view.latestOutput.revision}`);
  }
  if (view.receipts.length > 0) { parts.push(`${view.receipts.length} 条行动回执`); }
  if (view.coverageKnown && view.coverageTruncated) { parts.push('窗口已截断'); }
  return parts.join(' · ');
}

/** 依据：当前可用 / 已停用 / 未知 / 历史留痕分开，不把版本匹配当独立支持。 */
export function basisSummary(materials: WorkPacketMaterialUsesView, legacyServer: boolean): string {
  if (!materials.present) { return '依据：旧服务未提供资料使用摘要（未知）'; }
  if (materials.items.length === 0) {
    return finishedCoverageHint(materials) ? '依据：有界窗口未返回资料使用记录（不等于从未使用）' : '依据：有界窗口内没有资料使用记录（不等于从未使用）';
  }
  let allowed = 0;
  let suppressed = 0;
  let unknown = 0;
  let independent = 0;
  for (const item of materials.items) {
    if (item.currentUse.known && !item.currentUse.explicitNull && item.currentUse.stateKnown) {
      if (item.currentUse.state === 'ALLOWED') { allowed += 1; } else if (item.currentUse.state === 'SUPPRESSED') { suppressed += 1; } else { unknown += 1; }
      if (item.currentUse.state === 'ALLOWED' && item.currentUse.independentEvidence) { independent += 1; }
    } else {
      unknown += 1;
    }
  }
  const parts: string[] = [];
  parts.push(`${materials.items.length} 份原资料`);
  if (allowed > 0) { parts.push(`当前可用 ${allowed}`); }
  if (suppressed > 0) { parts.push(`当前停用 ${suppressed}`); }
  if (unknown > 0) { parts.push(`当前许可未知 ${unknown}`); }
  if (independent > 0) { parts.push(`原始来源 ${independent}（结论仍需核验）`); }
  if (legacyServer) { parts.push('旧服务未提供当前许可，只能按历史留痕展示'); }
  return '依据：' + parts.join(' · ');
}

function finishedCoverageHint(materials: WorkPacketMaterialUsesView): boolean {
  return materials.coverageKnown && !materials.truncated;
}

export function currentUseLabel(item: WorkPacketMaterialView): string {
  const use = item.currentUse;
  if (!use.known) { return '当前许可未知（旧服务未提供）'; }
  if (use.explicitNull) { return '当前许可未知（未提供用户上下文）'; }
  if (!use.stateKnown) { return `当前许可未知（${use.rawState}）`; }
  if (use.state === 'ALLOWED') {
    return use.independentEvidence ? '当前可作为依据 · 原始来源，结论仍需核验' : '当前可作为依据 · 结论仍需核验';
  }
  if (use.state === 'SUPPRESSED') { return '当前不可作为依据（来源许可已抑制）'; }
  return '当前许可未知（来源策略未判定）';
}

/** 正文不可读但历史关联仍保留：不能显示“记录已删除”。 */
export function materialBodyNote(item: WorkPacketMaterialView): string {
  if (item.excerptKnown && item.excerpt !== null && item.excerpt !== '') { return ''; }
  if (item.facts.length > 0) {
    return '正文当前不可读，历史关联与来源身份仍保留（不是记录被删除）';
  }
  if (item.availabilityKnown && item.availability === 'UNAVAILABLE') {
    return '正文暂不可访问；有界窗口未返回历史关联，不能据此认为从未使用';
  }
  return '正文未提供；不能据此认为记录不存在';
}

/** 项目原记录沿现有记忆卡的 captureId 定位，不送往只接受 ExternalSource 的读取器。 */
export class CaptureSourceTarget {
  projectId: string = '';
  tab: string = 'memory';
  captureId: string = '';
}

export function captureSourceTarget(projectId: string, sourceId: string): CaptureSourceTarget | null {
  if (projectId === '' || !sourceId.startsWith('capture:') || sourceId.length <= 8) { return null; }
  const target = new CaptureSourceTarget();
  target.projectId = projectId;
  target.captureId = sourceId.substring(8);
  return target;
}

/** 仅从已通过原项目接口鉴权的卡片中精确匹配，不将 Capture ID 当作 KnowledgeCard ID。 */
export function captureSourceCardId(captureId: string, cards: KnowledgeCard[]): string {
  if (captureId === '') { return ''; }
  const card = cards.find((item: KnowledgeCard) => item.captureId === captureId);
  return card !== undefined ? card.id : '';
}

export function nextSummary(view: WorkPacketNextView): string {
  if (!view.present) { return '下一步：旧服务未提供（未知）'; }
  const parts: string[] = [];
  if (view.waitingOnKnown) {
    const labels: Record<string, string> = {
      'USER_INPUT': '等你补充资料', 'USER_APPROVAL': '等你审阅提案', 'USER_RECHECK': '等你重新核对',
      'SYSTEM_WORKER': '等待原委托执行', 'SYSTEM_SETTLEMENT': '等待在途结算', 'SYSTEM_OBSERVATION': '等待观察',
      'SYSTEM_LEASE': '等待执行', 'SYSTEM_RECHECK': '等待重新核对', 'BUDGET_RESET': '等待额度恢复', 'NONE': '当前没有下一步'
    };
    parts.push(labels[view.waitingOn] ?? view.waitingOn);
  } else {
    parts.push(`下一步归属未知（${view.rawWaitingOn}）`);
  }
  if (view.primaryAction.present && view.primaryAction.kindKnown && view.primaryAction.kind !== 'NONE') {
    parts.push(view.primaryAction.label !== '' ? view.primaryAction.label : primaryActionKindLabel(view.primaryAction.kind));
  } else if (view.primaryAction.present && !view.primaryAction.kindKnown) {
    parts.push(`新的主动作类型（${view.primaryAction.rawKind}），请更新客户端`);
  }
  return '下一步：' + parts.join(' · ');
}

export function primaryActionKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    'ANSWER_QUESTION': '补充原问题', 'REVIEW_APPROVAL': '审阅原提案', 'RESUME_DELEGATION': '继续原委托',
    'RECHECK_AUTHORITY': '重新核对当前状态', 'CHECK_UNKNOWN_EFFECT': '核对未结算效果',
    'CHECK_STOP_SETTLEMENT': '核对停止结算', 'WAIT_FOR_OBSERVATION': '查看委托进展',
    'REVIEW_FAILURE': '查看失败原因', 'VIEW_RESULT': '查看原结果', 'NONE': '当前无操作'
  };
  return labels[kind] ?? '按服务端状态核对';
}

export function waitingOnLabel(raw: string): string {
  const labels: Record<string, string> = {
    'USER_INPUT': '等你补充资料', 'USER_APPROVAL': '等你决定', 'USER_RECHECK': '等你核对',
    'SYSTEM_WORKER': '后台处理中', 'SYSTEM_SETTLEMENT': '等待结算', 'SYSTEM_OBSERVATION': '等待观察',
    'SYSTEM_LEASE': '等待执行', 'SYSTEM_RECHECK': '等待重新核对', 'BUDGET_RESET': '等待额度恢复', 'NONE': '没有待处理动作'
  };
  return labels[raw] ?? '待核对';
}

export function blockerLabel(kind: string): string {
  const labels: Record<string, string> = {
    'AUTHORITY': '权限', 'WORK_STATE': '工作状态', 'STOP_REQUEST': '停止请求', 'BUDGET': '预算', 'SOURCE': '来源',
    'APPROVAL': '提案', 'QUESTION': '原问题', 'LEASE': '执行中', 'UNKNOWN_EFFECT': '未结算效果',
    'FAILURE': '失败', 'DELEGATION': '委托责任', 'TIME_BOUNDARY': '有效边界'
  };
  return labels[kind] ?? '其他阻断';
}

/** 快照一致性：VERSION_ADVANCED 时不能沿用旧 requires 直接提交。 */
export function snapshotLine(view: WorkPacketView): string {
  if (!view.snapshotConsistencyKnown) { return '快照：旧服务未提供版本一致性（未知）'; }
  if (view.snapshotConsistency === 'VERSION_ADVANCED') {
    return '快照：读取期间版本已推进；请重新读取后再操作，不要沿用旧版本要求';
  }
  if (view.snapshotConsistency === 'RETRIED') {
    return `快照：版本变化后已重读 ${view.snapshotRetries !== null ? view.snapshotRetries : 0} 次`;
  }
  return '快照：同一只读事务内读取';
}

export function authorityLine(view: WorkPacketAuthorityView): string {
  if (!view.present) { return '责任边界：旧服务未提供（未知）'; }
  const parts: string[] = [];
  if (view.permissionStateKnown) {
    const labels: Record<string, string> = {
      'WITHIN_TIME_BOUNDARY': '在有效边界内（只读展示，不是执行授权）',
      'EXPIRED': '已越过有效边界，需要重新核对',
      'STOPPED': '责任已停止',
      'UNKNOWN': '许可状态未知'
    };
    parts.push(labels[view.permissionState] ?? view.permissionState);
  } else {
    parts.push(`许可状态未知（${view.rawPermissionState}）`);
  }
  if (view.nextBoundary !== null) { parts.push(`最早有效边界 ${shortPacketTime(view.nextBoundary)}`); }
  if (view.workerPresenceKnown) { parts.push(`Worker 心跳 ${view.workerPresence}（心跳不等于成功观察）`); }
  return '责任边界：' + parts.join(' · ');
}

/** 旧服务/旧缓存没有 workPacket 时的统一说明。 */
export function legacyPacketNotice(): string {
  return '服务端未提供工作摘要（旧版本）。以下保留原委托读回，不推断成功或下一步。';
}
