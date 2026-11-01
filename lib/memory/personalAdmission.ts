/**
 * 个人记忆准入：服务端规则核对，不用模型分类作为永久改写依据。
 * 与原 Directive Admission 同设计原则，但个人偏好不进项目工作指令。
 * 三类不同语义：改变协作默认 / 只影响本次 / 项目工作限制——分流，不混写。
 */
export type PersonalAdmissionStatus =
  | "DIRECT_APPLIED"          // 明确范围的可保存表达或表单主动添加
  | "SESSION_ONLY"            // "这次/本次…"——只影响本轮，不建条目
  | "PROJECT_GUIDANCE"        // 项目工作限制——走原项目指令/约束合同
  | "NEEDS_CLARIFICATION"     // 指代或范围模糊——只问一个必要问题
  | "NOT_USER_MEMORY_COMMAND" // 引文/网页/他人转述里的"永久记住"——不是用户授权
  | "REJECTED_FOR_MEMORY";    // 凭据或首批不开放的敏感画像——拒绝保存

export type PersonalAdmission = {
  status: PersonalAdmissionStatus;
  reason: string;
  question?: string;
  suggestedKind?: "PREFERENCE" | "BACKGROUND" | "FOCUS";
  suggestedTopics?: string[];
};

const CREDENTIAL_PATTERNS = /(密码|口令|password|api[_ -]?key|secret|token|私钥|private[_ -]?key|验证码|银行卡|信用卡|支付密码)/i;
const SENSITIVE_PATTERNS = /(病历|诊断|确诊|收入|工资|存款|负债|身份证|护照|社保号|性取向|犯罪记录)/i;
const COMMAND_VERBS = /(永久记住|永远记住|记住这个|帮我记住|保存到你的记忆|记到记忆里)/;
const QUOTED_OR_SECONDHAND = /(他说|她说|他们说|据说|据报道|论文里|论文中|网页上|网页里|文档里|文档中|聊天记录|报道中|书里|“[^”]{0,60}(记住|保存)|"[^"]{0,60}(记住|保存))/;
const SESSION_ONLY_PREFIX = /^(这次|本次|这一轮|这轮|这一局|现在这场|这一题)/;
const PROJECT_SCOPE_HINT = /(这个项目|本项目|此项目|该项目的|项目里都|项目内)/;
const EXPLICIT_SCOPE_PREFIX = /^(以后|今后|往后|从现在起|以后都|以后所有|以后每次|以后的技术|以后讨论|以后做|以后的实验|以后写|以后回答)/;
const FUZZY_ALL = /^(以后都这样|以后都按这个来|以后都照这样|都按这个来|以后就按这个|记住这个|帮我记住这个)[。！!．\s]*$/;

/** 准入只做服务端可保真核对的判定；模型归纳候选一律不在这里激活。 */
export function admitPersonalMemory(raw: string): PersonalAdmission {
  const text = raw.trim();
  if (!text) return { status: "NEEDS_CLARIFICATION", reason: "没有可保存的内容", question: "想让我记住什么？" };
  if (CREDENTIAL_PATTERNS.test(text))
    return { status: "REJECTED_FOR_MEMORY", reason: "凭据类内容不进入个人记忆；请使用专用凭据保管方式。" };
  if (SENSITIVE_PATTERNS.test(text))
    return { status: "REJECTED_FOR_MEMORY", reason: "健康、财务、身份等敏感内容首批不保存为个人记忆。" };
  if (QUOTED_OR_SECONDHAND.test(text))
    return { status: "NOT_USER_MEMORY_COMMAND", reason: "这段话出自引用或他人内容，不构成你的记忆授权；按资料处理。" };
  if (FUZZY_ALL.test(text))
    return { status: "NEEDS_CLARIFICATION", reason: "指代不清，无法保真解析范围", question: "想记住的具体内容是什么？比如：以后技术讨论先给结论。" };
  if (SESSION_ONLY_PREFIX.test(text))
    return { status: "SESSION_ONLY", reason: "这是对本次的临时要求，只影响当前会话，不会保存为长期偏好。" };
  if (PROJECT_SCOPE_HINT.test(text))
    return { status: "PROJECT_GUIDANCE", reason: "这是项目内的工作限制，应进入原项目约束，而不是账户个人偏好。" };
  if (COMMAND_VERBS.test(text) && !EXPLICIT_SCOPE_PREFIX.test(text))
    return { status: "NEEDS_CLARIFICATION", reason: "范围不明确，不默认永久保存", question: "仅这个项目，还是今后的通用协作方式？" };
  if (EXPLICIT_SCOPE_PREFIX.test(text)) {
    const suggestedKind = /以后的技术|以后讨论|以后回答|先给结论|简短|详细/.test(text) ? "PREFERENCE"
      : /以后的实验|先验证|先做小规模|先核对/.test(text) ? "PREFERENCE" : "BACKGROUND";
    return { status: "DIRECT_APPLIED", reason: "用户本轮直接表达且范围明确", suggestedKind, suggestedTopics: [/技术|代码|程序/.test(text) ? ["TECHNICAL_DISCUSSION"] : [], /实验|研究|数据/.test(text) ? ["RESEARCH"] : []].flat() };
  }
  // 表单主动添加由调用方携带显式类别直接进入 DIRECT_APPLIED；自然语言裸句默认澄清一次。
  return { status: "NEEDS_CLARIFICATION", reason: "缺少明确的长期范围表达", question: "想保存成以后的通用习惯，还是只针对某类讨论？" };
}
