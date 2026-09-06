import { z } from "zod";
import { AppError } from "@/lib/api";
import { chatJsonWithMeta } from "@/lib/agent/llmAgent";
import { buildCopilotPrompt } from "@/lib/agent/prompts";
import { isFeatureEnabled } from "@/lib/config/features";
import { evaluateTrustReceipt, guardedAnswerMessage, type ClaimDraft } from "@/lib/evidence/trustReceipt";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { createAction, listAgentMessages, listInterventions, listActions, saveAgentMessage, saveAgentRun } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import { generateArtifact } from "@/lib/services/artifactService";
import { getDecisionTimeline } from "@/lib/services/temporalLedgerService";
import { actionCreateSchema, artifactCreateSchema } from "@/lib/validation/schemas";
import type { AgentChatResponse, AgentCitation, CardSearchResult, EvidenceTrustReceipt, ProposedAction } from "@/lib/types";

const responseSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  citations: z.array(z.object({ cardId: z.string(), title: z.string(), excerpt: z.string().max(500) })).max(8).default([]),
  claims: z.array(z.object({
    text: z.string().trim().min(1).max(1000),
    cardIds: z.array(z.string()).max(8).default([]),
  })).max(12).default([]),
  proposedActions: z.array(z.object({
    kind: z.enum(["create_action", "generate_artifact"]),
    label: z.string().min(1).max(60),
    title: z.string().min(2).max(160),
    description: z.string().max(500).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    artifactType: z.enum(["weekly_report", "competition_outline", "defense_ppt", "readme", "resume_description", "next_week_plan"]).optional(),
  })).max(4).default([]),
});

async function getCopilotEvidence(projectId: string, question: string, fallbackCards: Array<{ id: string; title: string; summary: string }>): Promise<{
  citations: AgentCitation[];
  searchResults: CardSearchResult[];
  retrievalMode: EvidenceTrustReceipt["retrievalMode"];
}> {
  const strictTrust = isFeatureEnabled("EVIDENCE_TRUST_RECEIPT_ENABLED", true);
  try {
    const searchResults = await searchProjectCards({ projectId, query: question, limit: 5 });
    const relevantResults = strictTrust
      ? searchResults.filter((result) => result.keywordScore > 0 || result.semanticScore >= 0.45)
      : searchResults;
    if (relevantResults.length > 0) {
      return {
        citations: relevantResults.map((r) => ({
          cardId: r.cardId,
          title: r.title,
          excerpt: r.summary.slice(0, 180),
          relevance: r.score,
          current: r.current,
          supportState: r.supportState,
          supersededBy: r.supersededBy,
          temporalReason: r.temporalReason,
        })),
        searchResults: relevantResults,
        retrievalMode: relevantResults[0].retrievalMode,
      };
    }
    return { citations: [], searchResults: [], retrievalMode: searchResults[0]?.retrievalMode ?? "none" };
  } catch {
    if (!strictTrust) {
      const citations = fallbackCards.slice(0, 5).map((card) => ({ cardId: card.id, title: card.title, excerpt: card.summary.slice(0, 180) }));
      return { citations, searchResults: [], retrievalMode: citations.length > 0 ? "keyword_fallback" : "none" };
    }
    return { citations: [], searchResults: [], retrievalMode: "none" };
  }
}

function mockAnswer(input: {
  question: string;
  citations: AgentCitation[];
  cards: Array<{ id: string; title: string; summary: string; type: string; keywords: unknown }>;
  interventions: Array<{ id: string; title: string; content: string; status: string; evidenceCardId: string | null }>;
  actions: Array<{ id: string; title: string; status: string }>;
}) {
  const question = input.question.toLowerCase();
  const citations = input.citations;
  const proposedActions: ProposedAction[] = [];
  if (/创建|安排|任务|下一步|做什么/.test(question)) {
    proposedActions.push({ kind: "create_action", label: "创建行动项", title: "把这个下一步拆成可执行行动", description: "确认后写入项目行动板，完成时会生成复盘卡片。", priority: 3 });
  }
  if (/周报|ppt|答辩|readme|材料|作品说明/.test(question)) {
    const artifactType = /ppt|答辩/.test(question) ? "defense_ppt" : /readme/.test(question) ? "readme" : /周报/.test(question) ? "weekly_report" : "competition_outline";
    proposedActions.push({ kind: "generate_artifact", label: "生成成果草稿", title: "基于当前记忆生成一版成果草稿", description: "确认后生成并保存版本，内容可继续编辑。", artifactType });
  }
  if (/提醒|为什么|介入|风险/.test(question) && input.interventions.length) {
    const intervention = input.interventions.find((item) => item.status === "OPEN") ?? input.interventions[0];
    return {
      message: `我找到一条${intervention.title}。${intervention.content} 这条判断来自规则引擎的项目上下文，不是凭空提醒。`,
      citations,
      claims: [{ text: `${intervention.title}：${intervention.content}`, cardIds: citations.map((item) => item.cardId) }],
      proposedActions,
    };
  }
  if (/进展|总结|现在|完成/.test(question)) {
    const primary = citations[0];
    return {
      message: primary ? `当前能从项目记忆直接核验的进展是：${primary.excerpt}` : "当前没有检索到能直接支持进展结论的项目记忆。",
      citations,
      claims: primary ? [{ text: primary.excerpt, cardIds: [primary.cardId] }] : [],
      proposedActions,
    };
  }
  return {
    message: citations.length ? `我从项目记忆中找到了 ${citations.length} 条相关记录，最相关的是“${citations[0].title}”。你可以继续追问进展、提醒依据或下一步。` : "项目里还没有足够的知识卡片，先输入一条项目碎片，我再帮你建立可引用的记忆。",
    citations,
    claims: citations.length > 0 ? [{ text: `项目记忆中存在与问题相关的记录，最相关的是“${citations[0].title}”。`, cardIds: citations.map((item) => item.cardId) }] : [],
    proposedActions,
  };
}

export async function answerProjectQuestion(projectId: string, question: string): Promise<AgentChatResponse> {
  const startedAt = Date.now();
  const project = await requireProject(projectId);
  const [cards, interventions, actions] = await Promise.all([
    db.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, summary: true, type: true, keywords: true } }),
    listInterventions(projectId, false),
    listActions(projectId, false),
  ]);
  await saveAgentMessage({ projectId, role: "USER", content: question, citations: [], proposedActions: [] });
  const evidenceSearch = await getCopilotEvidence(projectId, question, cards);
  let answer = mockAnswer({ question, citations: evidenceSearch.citations, cards, interventions, actions });
  let fallback = true;
  let fallbackReason: string | null = "mock_mode";
  let provider = "mock";
  if (process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY) {
    try {
      const execution = await chatJsonWithMeta(
        buildCopilotPrompt({
          project,
          question,
          cards: cards.filter((card) => evidenceSearch.citations.some((citation) => citation.cardId === card.id)).map((card) => ({ id: card.id, title: card.title, summary: card.summary, type: String(card.type) })),
          interventions: interventions.map((item) => ({ id: item.id, title: item.title, content: item.content, status: String(item.status) })),
          actions: actions.map((item) => ({ id: item.id, title: item.title, status: String(item.status) })),
        }),
        (value) => responseSchema.parse(value),
      );
      answer = execution.data;
      fallback = false;
      fallbackReason = null;
      provider = execution.provider;
    } catch (error) {
      console.warn("LLM copilot failed; using deterministic mock", error);
      fallbackReason = error instanceof Error ? error.message.slice(0, 180) : "llm_error";
      provider = "mock-fallback";
    }
  }
  const knownCardIds = new Set(cards.map((card) => card.id));
  const retrievedCardIds = new Set(evidenceSearch.citations.map((citation) => citation.cardId));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const timeline = await getDecisionTimeline(projectId);
  const temporalById = new Map(timeline.items.map((item) => [item.card.id, item]));
  const answerCitationById = new Map(answer.citations.map((citation) => [citation.cardId, citation]));
  const retrievedCitationById = new Map(evidenceSearch.citations.map((citation) => [citation.cardId, citation]));
  const requestedCitationIds = [...new Set([
    ...answer.citations.map((citation) => citation.cardId),
    ...answer.claims.flatMap((claim) => claim.cardIds),
  ])];
  answer = {
    ...answer,
    citations: requestedCitationIds.filter((cardId) => knownCardIds.has(cardId) && retrievedCardIds.has(cardId)).map((cardId) => {
      const citation = answerCitationById.get(cardId) ?? retrievedCitationById.get(cardId) as AgentCitation;
      const temporal = temporalById.get(cardId);
      const card = cardById.get(cardId);
      return {
        ...citation,
        title: card?.title ?? citation.title,
        excerpt: (card?.summary ?? citation.excerpt).slice(0, 180),
        current: temporal?.current ?? true,
        supportState: temporal?.supportState ?? "INSUFFICIENT",
        supersededBy: temporal?.supersededBy ?? null,
        temporalReason: temporal?.temporalReason ?? null,
      };
    }),
    proposedActions: answer.proposedActions.map((proposal) => proposal.kind === "generate_artifact" && !proposal.artifactType
      ? { ...proposal, artifactType: "competition_outline" as const }
      : proposal),
  };
  const trustEnabled = isFeatureEnabled("EVIDENCE_TRUST_RECEIPT_ENABLED", true);
  let trustReceipt: EvidenceTrustReceipt | undefined;
  let rejectedCardIds: string[] = [];
  if (trustEnabled) {
    const evaluated = evaluateTrustReceipt({
      claims: answer.claims as ClaimDraft[],
      fallbackClaimText: answer.message,
      fallbackCardIds: answer.citations.map((citation) => citation.cardId),
      evidence: [
        ...cards.filter((card) => retrievedCardIds.has(card.id)).map((card) => {
          const temporal = temporalById.get(card.id);
          return {
            cardId: card.id,
            belongsToProject: true,
            current: temporal?.current ?? true,
            supportState: temporal?.supportState ?? "INSUFFICIENT" as const,
            supersededBy: temporal?.supersededBy ?? null,
          };
        }),
        ...answer.claims.flatMap((claim) => claim.cardIds).filter((cardId) => !knownCardIds.has(cardId)).map((cardId) => ({
          cardId,
          belongsToProject: false,
          current: false,
          supportState: "INSUFFICIENT" as const,
          supersededBy: null,
        })),
      ],
      retrievalMode: evidenceSearch.retrievalMode,
    });
    trustReceipt = evaluated.receipt;
    rejectedCardIds = evaluated.rejectedCardIds;
    answer = {
      ...answer,
      message: guardedAnswerMessage(trustReceipt, answer.message),
      proposedActions: trustReceipt.supportState === "SUPPORTED" ? answer.proposedActions : [],
    };
  }
  const run = await saveAgentRun({
    projectId,
    runType: AgentRunType.CHAT,
    status: fallback ? AgentRunStatus.FALLBACK : trustReceipt?.abstained ? AgentRunStatus.PARTIAL : AgentRunStatus.SUCCESS,
    provider,
    fallbackReason,
    trace: {
      intent: /提醒|为什么|介入/.test(question) ? "explain_intervention" : /进展|总结/.test(question) ? "summarize_progress" : "search_memory",
      citedCardIds: answer.citations.map((citation) => citation.cardId),
      rejectedCardIds,
      proposedToolCount: answer.proposedActions.length,
      modelMode: process.env.LLM_MODE ?? "mock",
      ...(trustReceipt ? {
        supportState: trustReceipt.supportState,
        abstained: trustReceipt.abstained,
        claims: trustReceipt.claims,
        retrievalMode: trustReceipt.retrievalMode,
        refusalReason: trustReceipt.refusalReason,
        trustReceipt,
      } : {}),
    },
    resultJson: { proposedActions: answer.proposedActions, trustReceipt: trustReceipt ?? null },
    durationMs: Date.now() - startedAt,
  });
  await saveAgentMessage({
    projectId,
    role: "ASSISTANT",
    content: answer.message,
    citations: answer.citations,
    proposedActions: answer.proposedActions,
    runId: run.id,
  });
  return { message: answer.message, citations: answer.citations, proposedActions: answer.proposedActions, runId: run.id, fallback, ...(trustReceipt ? { trustReceipt } : {}) };
}

export async function getProjectChat(projectId: string) {
  await requireProject(projectId);
  const messages = await listAgentMessages(projectId);
  if (!isFeatureEnabled("EVIDENCE_TRUST_RECEIPT_ENABLED", true)) return messages;
  return messages.map((message) => message.role === "ASSISTANT" && !message.trustReceipt
    ? { ...message, proposedActions: [] }
    : message);
}

export async function executeCopilotTool(projectId: string, input: { tool: "create_action" | "generate_artifact"; confirmed: boolean; payload: Record<string, unknown>; sourceRunId?: string }) {
  if (!input.confirmed) throw new AppError("CONFIRMATION_REQUIRED", "写操作需要你确认后才能执行", 400);
  await requireProject(projectId);
  if (isFeatureEnabled("EVIDENCE_TRUST_RECEIPT_ENABLED", true)) {
    if (!input.sourceRunId) throw new AppError("TRUST_RECEIPT_REQUIRED", "缺少证据回执，不能执行写操作", 409);
    const sourceRun = await db.agentRun.findFirst({ where: { id: input.sourceRunId, projectId, runType: AgentRunType.CHAT } });
    if (!sourceRun) throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有找到这次回答的证据回执", 404);
    const trace = sourceRun.trace && typeof sourceRun.trace === "object" && !Array.isArray(sourceRun.trace)
      ? sourceRun.trace as Record<string, unknown>
      : {};
    if (trace.supportState !== "SUPPORTED") {
      throw new AppError("EVIDENCE_NOT_SUPPORTED", "证据存在冲突或不足，已阻止写操作", 409);
    }
    const result = sourceRun.resultJson && typeof sourceRun.resultJson === "object" && !Array.isArray(sourceRun.resultJson)
      ? sourceRun.resultJson as Record<string, unknown>
      : {};
    const allowed = Array.isArray(result.proposedActions) ? result.proposedActions as Array<Record<string, unknown>> : [];
    const matchesProposal = allowed.some((proposal) => proposal.kind === input.tool && (
      input.tool === "create_action"
        ? proposal.title === input.payload.title
        : proposal.artifactType === input.payload.artifactType
    ));
    if (!matchesProposal) throw new AppError("UNAPPROVED_TOOL_PROPOSAL", "这个操作不属于该证据回执中的建议", 409);
  }
  if (input.tool === "create_action") {
    const parsed = actionCreateSchema.parse(input.payload);
    return { tool: input.tool, result: await createAction(projectId, parsed) };
  }
  const parsed = artifactCreateSchema.parse(input.payload);
  return { tool: input.tool, result: await generateArtifact(projectId, parsed.artifactType) };
}
