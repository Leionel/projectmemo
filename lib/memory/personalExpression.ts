import { db } from "@/lib/db";
import { json, jsonHash } from "@/lib/mission/contracts";
import { admitPersonalMemory } from "./personalAdmission";
import { ACCOUNT_SCOPE_KEY } from "./scope";
import { policyInTx } from "./userMemoryPolicy";

/**
 * 从用户日常输入里发现个人记忆候选。
 *
 * 用服务端规则识别用户第一人称的稳定表达，不调用模型、不外发、不计额度。结果只是待确认候选：
 * 确认前不进入任何上下文，拒绝后同一句话不再提议。只看用户亲手写的短文本，不看附件、网页和模型输出。
 */
export type PersonalExpressionKind = "PREFERENCE" | "BACKGROUND" | "FOCUS";
export type PersonalExpression = { statement: string; kind: PersonalExpressionKind };

const MAX_INPUT_CHARS = 500;
const MIN_SENTENCE = 6;
const MAX_SENTENCE = 80;
const MAX_PER_INPUT = 2;
const MAX_PENDING = 12;

const PATTERNS: Array<[RegExp, PersonalExpressionKind]> = [
  [/^(以后|今后|往后|从现在起|之后都|每次都)/, "PREFERENCE"],
  [/^(我|我们)?(一般|通常|习惯|一直习惯|总是|更喜欢|更倾向|比较喜欢|偏好|不喜欢|不太喜欢|讨厌)/, "PREFERENCE"],
  [/^(请|麻烦)?(总是|始终|一律|永远不要|不要总是)/, "PREFERENCE"],
  [/^我(的专业是|专业是|是[^，,。]{0,16}(专业|学生|本科|大一|大二|大三|大四|研一|研二|研三|博士|研究生)|读[^，,。]{0,12}(专业|本科|研究生|博士)|主修|常用|主要用|平时用|擅长)/, "BACKGROUND"],
  [/^我(长期|一直在|最近一直在|这学期都在|这段时间都在)(关注|研究|准备|学习)/, "FOCUS"],
];
const NOT_STABLE = /[?？吗呢]$|^(如果|假如|要是|也许|可能)|(这次|本次|今天|明天|昨天|刚才|这周|本周|这一轮|这个项目|本项目)/;

export function detectPersonalExpressions(raw: string): PersonalExpression[] {
  const text = raw.trim();
  if (!text || text.length > MAX_INPUT_CHARS) return [];
  const found: PersonalExpression[] = [];
  for (const piece of text.split(/[。！!；;\n]+/)) {
    const statement = piece.trim();
    if (statement.length < MIN_SENTENCE || statement.length > MAX_SENTENCE || NOT_STABLE.test(statement)) continue;
    const kind = PATTERNS.find(([pattern]) => pattern.test(statement))?.[1];
    if (!kind) continue;
    const status = admitPersonalMemory(statement).status;
    if (status === "REJECTED_FOR_MEMORY" || status === "NOT_USER_MEMORY_COMMAND" || status === "SESSION_ONLY" || status === "PROJECT_GUIDANCE") continue;
    if (found.some(item => item.statement === statement)) continue;
    found.push({ statement, kind });
    if (found.length >= MAX_PER_INPUT) break;
  }
  return found;
}

const BASIS: Record<"CONVERSATION" | "CAPTURE", string> = {
  CONVERSATION: "你在和忆程讨论时说过这句话",
  CAPTURE: "你在记录项目进展时写过这句话",
};

/** 记录失败不影响原对话和原记录：调用方在业务提交之后调用，这里吞掉异常。 */
export async function suggestFromExpression(userId: string, text: string, origin: { via: "CONVERSATION" | "CAPTURE"; projectId?: string | null; conversationId?: string }): Promise<number> {
  try {
    const expressions = detectPersonalExpressions(text);
    if (!expressions.length) return 0;
    return await db.$transaction(async tx => {
      const policy = await policyInTx(tx, userId);
      if (!policy.expressionSuggestEnabled) return 0;
      let pending = await tx.agentClaim.count({ where: { ownerUserId: userId, scopeType: "ACCOUNT", statusProjection: "CANDIDATE" } });
      let created = 0;
      for (const { statement, kind } of expressions) {
        if (pending >= MAX_PENDING) break;
        const originKey = jsonHash({ kind: "USER_EXPRESSION", statement });
        const existing = await tx.agentClaim.findFirst({ where: { ownerUserId: userId, scopeKey: ACCOUNT_SCOPE_KEY, OR: [{ originKey }, { canonicalStatement: statement }] }, select: { id: true } });
        if (existing) continue;
        const conditions = { topics: [], useScope: { mode: "ALL" } };
        const claim = await tx.agentClaim.create({ data: { ownerUserId: userId, scopeType: "ACCOUNT", projectId: null,
          scopeKey: ACCOUNT_SCOPE_KEY, conversationId: null, missionId: null, originKey,
          originJson: json({ kind: "USER_EXPRESSION", basis: BASIS[origin.via], via: origin.via, projectId: origin.projectId ?? null, conversationId: origin.conversationId ?? null }),
          kind, canonicalStatement: statement, conditionsJson: json(conditions), statusProjection: "CANDIDATE" } });
        await tx.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: userId, revision: 1, requestId: `expression-${claim.id}`,
          payloadHash: jsonHash({ statement, kind }), eventKind: "PERSONAL_CANDIDATE", actorKind: "USER", userQuote: statement,
          targetHash: jsonHash({ statement, conditions }), evidenceManifestJson: json([]), assessmentJson: json({ basis: BASIS[origin.via] }) } });
        created++; pending++;
      }
      return created;
    });
  } catch (error) {
    console.warn("[personal-expression] 候选记录失败，不影响原操作", error instanceof Error ? error.message : "unknown");
    return 0;
  }
}
