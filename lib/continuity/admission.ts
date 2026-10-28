import { jsonHash } from "@/lib/mission/contracts";
import type { Admission, DirectiveCommand } from "@/lib/types/continuity";

export function candidateHash(command: DirectiveCommand) {
  return jsonHash({ scope: command.scope, operation: command.operation, quote: command.quote, kind: command.kind,
    directiveId: command.directiveId, targetProjectId: command.targetProjectId, sourceIds: command.sourceIds,
    validFrom: command.validFrom, validUntil: command.validUntil, timezone: command.timezone, candidateId: command.candidateId, expectedSeq: command.expectedSeq });
}
function periodEnd(quote: string, now: Date, timezone: string) {
  // Freeze local calendar boundaries at admission; never reinterpret a relative date on a later read.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
  const days = /本周|这周/.test(quote) ? 7 - ((local.getUTCDay() + 6) % 7) : 1;
  const target = +local + days * 86400000;
  let instant = target;
  // Resolve the offset at the boundary, including DST changes between admission and expiry.
  for (let i = 0; i < 3; i++) {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(new Date(instant))
      .find(p => p.type === "timeZoneName")?.value.match(/GMT([+-])(\d{2}):(\d{2})/);
    const ms = offset ? (offset[1] === "+" ? 1 : -1) * (+offset[2] * 60 + +offset[3]) * 60000 : 0;
    instant = target - ms;
  }
  return new Date(instant).toISOString();
}
/** Restricted, versioned literal grammar. A model's confidence is deliberately not an input. */
export function admitDirective(command: DirectiveCommand, now = new Date()): Admission {
  if (command.admission === "CONFIRMED") {
    if (!command.confirmed || command.candidateHash !== candidateHash(command)) return { status: "REJECTED", reason: "CONFIRMATION_BINDING_CHANGED" };
    if (command.operation === "SET" && (!command.kind || !command.quote || !command.validUntil))
      return { status: "NEEDS_CLARIFICATION", reason: "MISSING_BOUND", question: "这条工作指引有效到什么时候？" };
    return { status: "CONFIRMED_APPLIED", kind: command.kind, reason: "EXACT_USER_CONTROL", until: command.validUntil };
  }
  if (command.operation === "WITHDRAW") return { status: "DIRECT_APPLIED", reason: "EXPLICIT_WITHDRAWAL" };
  if (command.operation === "TRANSFER") return { status: "NEEDS_CLARIFICATION", reason: "TRANSFER_REQUIRES_EXACT_CONFIRMATION", question: "是否将这条指引移到指定项目？来源和工具权限不会随之迁移。" };
  if (command.operation === "SUPPRESS_USE" && command.sourceIds?.length)
    return { status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION", reason: "EXPLICIT_SUPPRESSION" };
  const q = command.quote ?? "";
  if (/不要(?:不|禁止|停止)|别(?:不|禁止|停止)/.test(q)) return { status: "INTERPRETATION_CANDIDATE", reason: "AMBIGUOUS_POLARITY" };
  if (/这个|那个|原来|第一项/.test(q) && !command.scope.missionId)
    return { status: "NEEDS_CLARIFICATION", reason: "AMBIGUOUS_REFERENT", question: "这次指的是哪一项工作？" };
  if (/[“”「」『』"<>]|(?:他说|她说|网页上写|论文指出|日志说|据说|如果|假如|并非|不是|不要理解|别理解|能否|是否|[?？])/.test(q))
    return { status: "INTERPRETATION_CANDIDATE", reason: "QUOTED_CONDITIONAL_OR_AMBIGUOUS" };
  if (/^(?:请)?(?:停止|暂停)(?:本轮|当前|这次)?(?:调查|任务|执行|推进)[。！!]?$/u.test(q))
    return { status: "DIRECT_APPLIED", kind: "STOP", reason: "LITERAL_STOP_UNTIL_WITHDRAWN" };
  if (/^(?:请)?(?:只读(?:不联网)?|不联网|不创建行动|(?:不要|禁止|不得|不允许)(?:联网|调用外部工具|调用模型|付费调用|创建行动|新增行动|外部写入|写入业务))[。！!]?$/u.test(q))
    return { status: "DIRECT_APPLIED", kind: "CONSTRAINT", constraints: [q], reason: "LITERAL_VETO_UNTIL_WITHDRAWN" };
  if (/永久|永远|以后都|所有项目|全局|验收标准|修改项目目标|授权|付费|自动确认|(?:直接|自动|替我|帮我)部署|(?:允许|执行|直接)写入/.test(q))
    return { status: "NEEDS_CLARIFICATION", reason: "PERSISTENT_OR_AUTHORITY_CHANGE", question: "这次具体要调整哪个项目的哪项工作，以及有效期？业务操作仍需原确认。" };
  if (/^(?:今天|本周|这周)(?:先|暂时|优先|重点|暂缓|只|不要|别|以|把)/u.test(q)) {
    const restrictionOnly = /^(?:今天|本周|这周)(?:先|暂时)?(?:不要|别|禁止|只读|不联网|只|暂缓)/u.test(q);
    const constraints = q.split(/[，,。；;]/).filter(clause => /(?:不要|别|禁止|不得|只读|不联网)/.test(clause));
    return { status: "DIRECT_APPLIED", kind: restrictionOnly ? "CONSTRAINT" : "WORKING_OBJECTIVE", constraints,
      until: command.validUntil && Date.parse(command.validUntil) < Date.parse(periodEnd(q, now, command.timezone)) ? command.validUntil : periodEnd(q, now, command.timezone), reason: "LITERAL_BOUNDED_WORK_GUIDANCE_V1" };
  }
  if (/^(?:当前|这阶段|接下来)(?:先|暂时|只)/u.test(q))
    return { status: "NEEDS_CLARIFICATION", reason: "MISSING_BOUND", question: "这条阶段指引先持续到哪一天？" };
  return { status: "INTERPRETATION_CANDIDATE", reason: "NO_LITERAL_OPERATION" };
}
