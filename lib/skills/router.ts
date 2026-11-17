import { createHash } from "node:crypto";
import type { BuiltinSkillId } from "./registry";

/**
 * Deterministic V2 request router.
 *
 * It answers three separate questions, in this order:
 *   1. who is this request for (deny / clarify), and is it an instruction about
 *      data rather than a request from the user (answer / control);
 *   2. which method(s) this request needs (the four shipped Skills only);
 *   3. which permissions and evidence gates the chosen methods may use.
 *
 * The router never creates tools, sources, cloud consent or business effects.
 * It only narrows what the existing Mission/Runner/ToolSet already allows.
 */

export type SkillRouteMode = "RUN" | "ANSWER" | "CONTROL" | "CLARIFY" | "DENY";

export type EvidenceState = "NONE" | "PARTIAL" | "VALID" | "REQUIREMENTS";

export type RoutingRestrictions = {
  /** External read/search/network must not be dispatched without a new explicit grant. */
  noExternalRead: boolean;
  /** Deliverable outputs must not be revised or replaced for this request. */
  noOutputRevision: boolean;
  /** Research method is excluded for this request. */
  noResearch: boolean;
  /** Only the selected Skill may run; no automatic follow-on method. */
  onlySelectedSkill: boolean;
  /** Attention preference only; it is not an execution permission. */
  attentionOnly: boolean;
  /** Pause the current responsibility. */
  pause: boolean;
  /** Resume requested by an explicit user control. */
  resume: boolean;
  /** Stop using selected sources. */
  sourceSuppression: boolean;
  /** External send needs exact content and recipient approval. */
  externalApprovalRequired: boolean;
  /** Request targets data outside the current owner scope. */
  crossScope: boolean;
  /** Planning must not be turned into automatic execution. */
  planNotExecution: boolean;
  /** Adopted artifacts must not be overwritten even when a new draft is requested. */
  preserveAdoptedArtifacts: boolean;
};

export type RoutingMission = {
  id: string;
  projectId: string;
  goal: string;
  status: string;
  runtimeProtocolVersion: number;
  /** Effective working objective (a current user directive) when present. */
  workingObjective: string | null;
  evidence: EvidenceState;
  outputId: string | null;
  outputCount: number;
  sourceCount: number;
  skillStage: BuiltinSkillId | null;
};

export type RoutingPermission = {
  ownerMatches: boolean;
  projectAccessible: boolean;
  hasReadableMaterial: boolean;
  publicResearch: boolean;
  publicTerms: string[];
  connectedSourceIds: string[];
  /** Tools the current bounded delegation allows; the router can only intersect. */
  allowedToolNames: string[];
  /** True when an external share/business write would need a new user approval. */
  externalApprovalRequired: boolean;
};

export type SkillRoutingInput = {
  message: string;
  event?: "USER_MESSAGE" | "SOURCE_REVISED" | "SOURCE_ADDED" | "DEADLINE_DUE";
  mission: RoutingMission | null;
  /** Other active missions that could be the referent of "那个/这份报告". */
  candidateMissions: Array<{ id: string; projectId: string; goal: string; status: string }>;
  project: { id: string; title: string; sourceCount: number; readableSources: number } | null;
  permission: RoutingPermission;
  activity: { evidence: EvidenceState; latestOutputId: string | null; outputCount: number; newSourceEvents: number; changedSinceLastRun?: boolean };
};

export type SkillHandoff = { from: BuiltinSkillId; at: string; next: BuiltinSkillId };

export type SkillRouteDecision = {
  schemaVersion: 1;
  mode: SkillRouteMode;
  primary: BuiltinSkillId | null;
  sequence: BuiltinSkillId[];
  reasonCode: string;
  reuseMissionId: string | null;
  restrictions: RoutingRestrictions;
  /** How the current material may be used by a deliverable method. */
  evidenceGate: "NOT_REQUIRED" | "READY" | "PARTIAL_WITH_MARKERS" | "NEEDS_EVIDENCE";
  handoffOn: SkillHandoff[];
  intentHash: string;
  contextHash: string;
  /** The router only narrows; it never returns a tool set. */
  toolAuthority: "UNCHANGED";
};

const PLANNING: BuiltinSkillId = "project-planning";
const RESEARCH: BuiltinSkillId = "evidence-research";
const CREATION: BuiltinSkillId = "deliverable-creation";
const REVIEW: BuiltinSkillId = "project-review";

function hash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex");
}

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some(pattern => pattern.test(text));
}

const EMPTY_RESTRICTIONS = (): RoutingRestrictions => ({
  noExternalRead: false, noOutputRevision: false, noResearch: false, onlySelectedSkill: false,
  attentionOnly: false, pause: false, resume: false, sourceSuppression: false,
  externalApprovalRequired: false, crossScope: false, planNotExecution: false, preserveAdoptedArtifacts: false,
});

/** Negative user controls are persistence, not conversation: extract them before any method runs. */
export function extractRestrictions(message: string): RoutingRestrictions {
  const flags = EMPTY_RESTRICTIONS();
  const external = /(?:不要|不用|别|禁止|暂时不|先不|不再|无需|不允许)(?:再|去|继续)?(?:联网|上网|查网|搜索|查新|查外部|外部检索|调外部工具|公开检索|联网查)/.test(message)
    || /(?:只用|只根据|只按|仅用|仅根据|只看|只读)(?:已经)?(?:上传|现有|已有|已读|本项目|本地)(?:的)?(?:资料|材料|记录|来源|提交记录|截图|SQL)/i.test(message)
    || /(?:暂时|先)(?:不|别)(?:查|看|补)(?:新|外部|公开)?(?:资料|材料|数据)/.test(message)
    || /不补新资料/.test(message);
  flags.noExternalRead = external;
  flags.noOutputRevision = /不(?:开始|再)?(?:写|改|动)(?:新)?(?:的)?报告/.test(message)
    || /(?:报告|稿件|成果|草稿|文档).{0,4}(?:不要|别|先别).{0,3}(?:动|改|写)/.test(message)
    || /(?:不要|别|先别|不再|不要)(?:再|去|继续)?(?:改稿|改报告|动报告|改这份|修改稿件|写新报告)/.test(message);
  flags.preserveAdoptedArtifacts = /(?:不要|别|不得)覆盖已采纳|保留已采纳|不覆盖已采纳/.test(message);
  if (/不要覆盖已采纳/.test(message)) flags.noOutputRevision = false;
  flags.noResearch = /(?:不要|别|不用|不必|先别|暂时不|不必|不)(?:再|去|开始)?(?:研究|调查|开始研究|继续调查|查新)/.test(message);
  flags.onlySelectedSkill = /只(?:做|要|给)?(?:复盘|回顾)|只要复盘|只复盘/.test(message)
    || /只(?:做|要)?计划|只要计划|就只做计划/.test(message)
    || /(?:这次)?只写结构/.test(message);
  flags.attentionOnly = /(?:今天|这周|最近|这几天)?(?:不要|别|不用|暂时别).{0,4}提醒(?:我|我们)?|(?:关闭|暂停|关掉).{0,4}提醒/.test(message);
  flags.sourceSuppression = /(?:停止|停用|不要|别|不再).{0,4}(?:使用|用|引用).{0,12}(?:旧|刚才|原来|之前|选中).{0,6}(?:资料|来源|文件|记录)/.test(message);
  flags.pause = /^(?:请|先)?(?:暂停|停下|先停)/.test(message.trim()) || /^(?:请|先)?停止(?!使用|引用|用)/.test(message.trim());
  flags.resume = /^(?:可以继续|继续吧|接着做|恢复工作)/.test(message.trim()) && !flags.noExternalRead && !flags.attentionOnly && !flags.sourceSuppression;
  flags.externalApprovalRequired = /(?:把|将)(?:这|那)?(?:份)?(?:草稿|稿件|报告|成果|文件|内容|清单|版本|说明).{0,8}(?:发给|发送给|转发给|交给|传给|分享给)/.test(message)
    || /(?:发给|发送给|转发给|交给|传给|分享给).{0,12}(?:老师|客户|同学|同事|对方|领导|群|邮箱|邮件|负责人)/.test(message)
    || /(?:直接|立即)?(?:发送|转发|外发)(?:这份|该|那)?(?:草稿|报告|成果|文件|版本)/.test(message);
  flags.crossScope = /(?:另一位|别的|其他|别人的|他人的|另一个|其他用户).{0,6}(?:用户|账号|人)?.{0,6}(?:项目|报告|资料|文件|委托)/.test(message)
    || /(?:读取|打开|查看|读取).{0,8}(?:他人|别人|其他用户).{0,6}(?:项目|报告|资料)/.test(message);
  flags.planNotExecution = true;
  return flags;
}

/**
 * Split a Chinese compound request into ordered clauses. Only connectors that
 * introduce another action split a clause; nouns such as "之后/内部" do not.
 */
export function splitRequestClauses(message: string): string[] {
  let text = message.replace(/\s+/g, "").trim();
  // Past-tense evidence is context, not a new research action.
  text = text.replace(/已(?:经)?(?:核对|检查|验证|确认|读过?|整理|审阅)(?:的)?/g, "");
  text = text.replace(/(?:然后|接着|随后|之后)/g, "｜");
  text = text.replace(/再(?=(?:整理|更新|写|检查|核查|核实|修改|修订|列|生成|看|调整|安排|补|做|给|输出|改|标|排|压缩|导出|回答|确认|交付|说明))/g, "｜");
  text = text.replace(/并(?=(?:更新|整理|写|检查|核查|核实|修改|修订|列|生成|改|压缩|输出|排|调整|补|做|回答|确认|交付|说明|修订))/g, "｜");
  text = text.replace(/后(?=(?:更新|整理|写|检查|核查|修改|修订|生成|输出|改|压缩|排|调整|补|做|列|交付|说明|回答|确认))/g, "｜");
  text = text.replace(/(?:，|,)?(?:但|但是|可|不过)(?=不|别|暂)/g, "｜");
  return text.split(/[，,。；;！!？?、｜]+/).map(part => part.trim()).filter(Boolean);
}

const PLANNING_STRONG = [
  /(?:制定|做|排|列|整理|给|拆|重新排|调整|安排|规划|拟)(?:一下|出|个|一份|一个)?(?:计划|步骤|顺序|排期|安排|方案)/,
  /(?:计划|步骤|顺序|排期|方案)(?:是|先|要|就|吧|呢|$)/,
  /拆(?:一下|解)?步骤/,
  /(?:列出|列三步|列出来|提取)(?:[^，。]{0,12})(?:要求|清单|缺项|依赖|哪些东西|三步)/,
  /(?:要补|该交|要交|缺哪些|哪些东西)/,
  /重新安排/,
  /(?:没有要求|手里没有要求|缺少要求)/,
  /^先(?:做|列|给|调整|拆|排|整理)/,
  /发布前的检查排个顺序/,
];
const PLANNING_WEAK = [/任务顺序/, /最小.{0,4}方案/, /验收清单/, /(?:依赖|缺项).{0,4}(?:列出|列出来)/, /排个顺序/];

const RESEARCH_STRONG = [
  /(?:核对|核查|复查|补查|查清|检查|查看|查阅|比较|对比|核实|分析|验证|证明|评估|确认|排查|研究|调研|调查)/,
  /(?:是否|能否|能不能|足以|支持(?:它|什么|这|该)?|真的支持|漏了|缺少|缺失)/,
  /(?:新观察|新数据|新记录|新实验|CI失败|CI过了|SHA|DOI|PDF|前两页|指标口径)/,
];
const RESEARCH_WEAK = [/指标下降/, /测试集不同/, /引用/, /单位/, /公开评估方法/, /补查/];
const MATERIAL_ORGANIZING = /整理(?:一下)?(?:现有|已有|上传的?|项目中?的?)?(?:资料|材料|来源)/;

const CREATION_VERBS = /(?:整理|生成|写|改成|压缩|导出|排成|起草|更新|修改|修订|缩到|改写|润色|拟|输出|整理出)/;
const CREATION_TARGETS = /(?:稿|草稿|报告|清单|摘要|说明|成果|段落|版本|三段|两节|Markdown|汇报|交付物|文案|结构|小节|章节|文档|进展|阶段总结)/i;
const CREATION_STRONG = [
  /(?:整理|生成|写|改成|压缩|导出|排成|起草|更新|修改|修订|缩到|改写|拟|输出)[^，。]{0,14}(?:稿|草稿|报告|清单|摘要|说明|成果|段落|版本|三段|两节|Markdown|汇报|交付|结构|文案|章节)/i,
  /(?:稿|草稿|报告|清单|摘要|说明|成果|段落|版本|三段|两节|Markdown|汇报|交付)[^，。]{0,10}(?:缩到|压缩|排成|整理|生成|导出|改|更新)/,
  /^(?:修订|修改|改写|重写|更新)$/,
  /写(?:一版|一份|个)?(?:摘要|说明|草稿|报告|清单|结构)/,
  /(?:改|修改|修订|更新)(?:这|该|那|本)(?:段|段话|一节|一处)/,
];

const REVIEW_STRONG = [
  /复盘|回顾|总结经验|经验总结/,
  /(?:哪里|什么|哪儿)(?:变)?(?:了|变)/,
  /(?:几天|好几?天|两三天|\d+天)没看/,
  /(?:变化|差异|区别)/,
  /为什么[^，。]{0,12}(?:上次|以前|之前|现在|改|写)/,
  /(?:还缺|缺哪项|缺什么|完成了什么|哪些完成|已经完成|做完了)/,
  /(?:必须由我决定|由我决定|需要我决定)/,
  /(?:回执|实际完成|我说的)/,
  /(?:准备到什么程度|进度如何|到什么程度)/,
  /(?:归档|无效吗|失效吗|因此无效)/,
  /没变化|告诉我没变化/,
  /(?:就算|算不算|是不是就算)[^，。]{0,10}(?:上线|完成)|上线了吗|完成了吗/,
  /严格导师|导师.{0,6}(?:发现|指出|质疑)/,
  /看看[^，。]{0,6}(?:报告|成果|进度|准备)/,
  /先查[^，。]{0,8}(?:新数据|有没有新|是否.{0,2}新)/,
  /查[^，。]{0,4}(?:新数据|有没有新)/,
];

const REVIEW_WEAK = [/(?:上次|当前|现在).{0,6}(?:结论|决定|状态)/, /(?:报告|成果|项目).{0,4}(?:怎么样|如何)/];

function clauseSkill(clause: string): BuiltinSkillId | null {
  if (!clause) return null;
  // A clause that tells the agent NOT to do an action is a restriction, not a request for that method.
  if (/(?:不|别|不要|先别|暂时不|不再|停止|避免)(?:再|去|开始|继续)?(?:写|生成|整理|修改|改|研究|调研|调查|查|做|创建|执行|联网|补)/.test(clause)
    && !/只(?:做|复盘|写|要)/.test(clause)) return null;
  // A clause whose only content is a negative instruction is a control, not a method request.
  const positive = clause.replace(/(?:不要|别|不用|不必|暂时不|先不|先别|不再|无需|不允许|不能)/g, "");
  if (!positive.replace(/[的了呢吧啊]/g, "").trim()) return null;
  if (REVIEW_STRONG.some(pattern => pattern.test(clause))) return REVIEW;
  if (matches(PLANNING_STRONG, clause)) return PLANNING;
  if (CREATION_STRONG.some(pattern => pattern.test(clause))) return CREATION;
  if (CREATION_VERBS.test(clause) && CREATION_TARGETS.test(clause) && /(?:整理|生成|写|改成|压缩|导出|排成|起草|更新|修改|修订|缩到|改写|拟|输出)/.test(positive)) return CREATION;
  if (MATERIAL_ORGANIZING.test(clause)) return RESEARCH;
  if (matches(RESEARCH_STRONG, clause) && !/(?:排个顺序|排个|顺序)/.test(clause)) return RESEARCH;
  if (matches(RESEARCH_WEAK, clause)) return RESEARCH;
  if (matches(PLANNING_WEAK, clause)) return PLANNING;
  if (matches(REVIEW_WEAK, clause)) return REVIEW;
  return null;
}

export function planSkillSequence(message: string, restrictions = extractRestrictions(message)): BuiltinSkillId[] {
  // A completion/completion-boundary judgment is a review of what happened; observation
  // clauses in the same sentence are context for that judgment, not new research actions.
  if (/(?:就算|算不算|是不是就算)[^，。]{0,10}(?:上线|完成)|上线了吗|完成了吗/.test(message)) return [REVIEW];
  const clauses = splitRequestClauses(message);
  let sequence: BuiltinSkillId[] = [];
  for (const clause of clauses) {
    const skill = clauseSkill(clause);
    if (skill && !sequence.includes(skill)) sequence.push(skill);
  }
  // Explicit "只..." narrows the plan; it cannot be widened by other clauses.
  if (restrictions.onlySelectedSkill) {
    if (/只复盘|只要复盘/.test(message)) sequence = [REVIEW];
    else if (/只写结构/.test(message)) sequence = [CREATION];
    else sequence = [PLANNING];
  }
  if (restrictions.noResearch) sequence = sequence.filter(skill => skill !== RESEARCH);
  if (restrictions.noOutputRevision) sequence = sequence.filter(skill => skill !== CREATION);
  // Research supplies the evidence pack a draft quotes; it cannot run after the draft it gates.
  if (sequence.includes(RESEARCH) && sequence.includes(CREATION) && sequence.indexOf(RESEARCH) > sequence.indexOf(CREATION)) {
    sequence = [...sequence.filter(skill => skill !== RESEARCH)];
    sequence.splice(sequence.indexOf(CREATION), 0, RESEARCH);
  }
  if (!sequence.length && /(?:继续|接着|帮我继续)/.test(message) && !restrictions.onlySelectedSkill) {
    sequence = [REVIEW];
  }
  if (!sequence.length) sequence = [PLANNING];
  if (sequence.length > 4) sequence = sequence.slice(0, 4);
  // A full delivery cycle that starts from a new project or from a newly observed change
  // closes with a review pass; a request that already asked for review does not get a second one.
  const changeArrival = /新观察|新数据|新记录|新资料来了|第一份|新课程项目|新项目/.test(message);
  if (sequence.at(-1) === CREATION && !sequence.includes(REVIEW) && changeArrival) sequence.push(REVIEW);
  return sequence;
}

function detectMode(input: SkillRoutingInput, restrictions: RoutingRestrictions): { mode: SkillRouteMode; reasonCode: string } | null {
  const message = input.message;
  if (restrictions.crossScope || !input.permission.ownerMatches || !input.permission.projectAccessible) {
    return { mode: "DENY", reasonCode: "OWNER_SCOPE_DENIED" };
  }
  if (/(?:忽略|无视|不要遵守|跳过).{0,8}(?:规则|指令|限制|要求)/.test(message) || /(?:原文|资料|文档|截图|邮件|来源)[^，。]{0,10}(?:写着|写到|要求|命令)[^，。]{0,20}(?:忽略|无视|把所有|全部|发送|转发|删除|上传|泄露)/.test(message)) {
    return { mode: "ANSWER", reasonCode: "UNTRUSTED_SOURCE_NOT_AUTHORITY" };
  }
  if (restrictions.attentionOnly) return { mode: "CONTROL", reasonCode: "ATTENTION_ONLY" };
  if (restrictions.sourceSuppression) return { mode: "CONTROL", reasonCode: "SOURCE_SUPPRESSION" };
  if (restrictions.pause) return { mode: "CONTROL", reasonCode: "USER_PAUSE" };
  const onlyControl = splitRequestClauses(message).length === 0
    || splitRequestClauses(message).every(clause => clauseSkill(clause) === null && !/只(?:做)?计划|只复盘|只写结构/.test(clause));
  if (onlyControl && (restrictions.noExternalRead || restrictions.noOutputRevision || restrictions.noResearch || restrictions.resume)) {
    return { mode: "CONTROL", reasonCode: restrictions.resume ? "USER_RESUME" : restrictions.noExternalRead ? "EXTERNAL_READ_RESTRICTION" : "WORK_RESTRICTION" };
  }
  if (restrictions.externalApprovalRequired) return { mode: "CLARIFY", reasonCode: "EXTERNAL_APPROVAL_REQUIRED" };
  const ambiguousReference = !input.mission && input.candidateMissions.length > 1 && /(?:那个|那份|这个|这份|继续|帮我继续)/.test(message);
  if (ambiguousReference) return { mode: "CLARIFY", reasonCode: "AMBIGUOUS_TARGET" };
  if (!input.mission && input.candidateMissions.length > 1 && /(?:报告|项目|委托|稿)/.test(message) && !input.project) {
    return { mode: "CLARIFY", reasonCode: "AMBIGUOUS_TARGET" };
  }
  return null;
}

function evidenceGateFor(sequence: BuiltinSkillId[], evidence: EvidenceState): SkillRouteDecision["evidenceGate"] {
  if (!sequence.includes(CREATION)) return "NOT_REQUIRED";
  if (evidence === "VALID" || evidence === "REQUIREMENTS") return "READY";
  if (evidence === "PARTIAL") return "PARTIAL_WITH_MARKERS";
  return "NEEDS_EVIDENCE";
}

export function routeSkillRequest(input: SkillRoutingInput): SkillRouteDecision {
  const message = input.message.trim();
  const restrictions = extractRestrictions(message);
  const detected = detectMode(input, restrictions);
  const intentHash = hash({ policy: "v2-skill-router-v1", message, mission: input.mission?.id ?? null, event: input.event ?? "USER_MESSAGE" });
  const contextHash = hash({
    mission: input.mission ? { id: input.mission.id, status: input.mission.status, evidence: input.mission.evidence, outputId: input.mission.outputId, stage: input.mission.skillStage } : null,
    project: input.project?.id ?? null,
    candidates: input.candidateMissions.map(candidate => candidate.id).sort(),
    evidence: input.activity.evidence,
    permission: { publicResearch: input.permission.publicResearch, externalApprovalRequired: input.permission.externalApprovalRequired },
  });
  const base: SkillRouteDecision = {
    schemaVersion: 1, mode: "RUN", primary: null, sequence: [], reasonCode: "",
    reuseMissionId: input.mission?.id ?? null, restrictions,
    evidenceGate: "NOT_REQUIRED", handoffOn: [], intentHash, contextHash, toolAuthority: "UNCHANGED",
  };
  if (detected && detected.mode !== "RUN") {
    return { ...base, mode: detected.mode, reasonCode: detected.reasonCode };
  }
  let sequence = planSkillSequence(message, restrictions);
  const evidence = input.activity.evidence;
  // New material must be re-read before a draft is revised; the old version stays untouched.
  if (sequence.includes(CREATION) && input.activity.changedSinceLastRun && !restrictions.noResearch) {
    const index = sequence.indexOf(CREATION);
    if (!sequence.includes(RESEARCH)) sequence = [...sequence.slice(0, index), RESEARCH, ...sequence.slice(index)];
  }
  // Creation may not run ahead of evidence. With no usable material the research method
  // is planned first; with partial material the draft must keep its unknown markers.
  if (sequence.includes(CREATION) && evidence === "NONE" && !restrictions.noResearch) {
    const index = sequence.indexOf(CREATION);
    if (index === 0) sequence = [RESEARCH, ...sequence];
    else sequence = [...sequence.slice(0, index), RESEARCH, ...sequence.slice(index)];
  }
  if (sequence.at(-1) === CREATION && !sequence.includes(REVIEW) && !input.activity.outputCount && /(?:第一份|第一次|新课程项目|新项目)/.test(message)) {
    sequence.push(REVIEW);
  }
  const handoffOn: SkillHandoff[] = [];
  for (let index = 0; index < sequence.length - 1; index++) {
    handoffOn.push({ from: sequence[index], at: `${sequence[index]}_OUTPUT_CHECK`, next: sequence[index + 1] });
  }
  const primary = sequence[0] ?? null;
  const reasonCode = sequence.length > 1 ? "COMPOUND_REQUEST"
    : primary === PLANNING ? "PLANNING_REQUEST"
    : primary === RESEARCH ? "EVIDENCE_REQUEST"
    : primary === CREATION ? "DELIVERABLE_REQUEST"
    : primary === REVIEW ? "REVIEW_REQUEST"
    : "NO_ACTIONABLE_SKILL";
  return {
    ...base, mode: "RUN", primary, sequence, reasonCode,
    evidenceGate: evidenceGateFor(sequence, evidence),
    handoffOn,
  };
}

/** Deterministic gate text used by tests and receipts; it never contains frozen expectations. */
export function describeRoute(decision: SkillRouteDecision): string {
  const labels: Record<BuiltinSkillId, string> = {
    "project-planning": "规划", "evidence-research": "研究", "deliverable-creation": "创作", "project-review": "复盘",
  };
  if (decision.mode !== "RUN") return `${decision.mode}:${decision.reasonCode}`;
  return decision.sequence.map(skill => labels[skill]).join("→") + ":" + decision.reasonCode;
}
