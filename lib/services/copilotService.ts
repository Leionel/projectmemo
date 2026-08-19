import { z } from "zod";
import { AppError } from "@/lib/api";
import { chatJson } from "@/lib/agent/llmAgent";
import { buildCopilotPrompt } from "@/lib/agent/prompts";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { createAction, listAgentMessages, listInterventions, listActions, saveAgentMessage, saveAgentRun } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import { generateArtifact } from "@/lib/services/artifactService";
import { actionCreateSchema, artifactCreateSchema } from "@/lib/validation/schemas";
import type { AgentChatResponse, AgentCitation, ProposedAction } from "@/lib/types";

const responseSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  citations: z.array(z.object({ cardId: z.string(), title: z.string(), excerpt: z.string().max(500) })).max(8).default([]),
  proposedActions: z.array(z.object({
    kind: z.enum(["create_action", "generate_artifact"]),
    label: z.string().min(1).max(60),
    title: z.string().min(2).max(160),
    description: z.string().max(500).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    artifactType: z.enum(["weekly_report", "competition_outline", "defense_ppt", "readme", "resume_description", "next_week_plan"]).optional(),
  })).max(4).default([]),
});

function searchCards(cards: Array<{ id: string; title: string; summary: string; type: string; keywords: unknown }>, question: string) {
  const tokens = question.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return cards.map((card) => {
    const haystack = `${card.title} ${card.summary} ${String(card.type)} ${Array.isArray(card.keywords) ? card.keywords.join(" ") : ""}`.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
    return { card, score };
  }).sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
}

function citationsFrom(cards: Array<{ id: string; title: string; summary: string }>): AgentCitation[] {
  return cards.slice(0, 5).map((card) => ({ cardId: card.id, title: card.title, excerpt: card.summary.slice(0, 180) }));
}

function mockAnswer(input: {
  question: string;
  cards: Array<{ id: string; title: string; summary: string; type: string; keywords: unknown }>;
  interventions: Array<{ id: string; title: string; content: string; status: string; evidenceCardId: string | null }>;
  actions: Array<{ id: string; title: string; status: string }>;
}) {
  const question = input.question.toLowerCase();
  const ranked = searchCards(input.cards, input.question);
  const topCards = ranked.filter((item) => item.score > 0).map((item) => item.card);
  const citations = citationsFrom(topCards.length ? topCards : input.cards);
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
      proposedActions,
    };
  }
  if (/进展|总结|现在|完成/.test(question)) {
    const done = input.actions.filter((item) => item.status === "DONE").length;
    return {
      message: `当前项目有 ${input.cards.length} 张知识卡片、${input.actions.length} 条行动项，其中 ${done} 条已完成。最近沉淀的记忆是：${citations[0]?.excerpt ?? "暂时还没有可引用的卡片"}`,
      citations,
      proposedActions,
    };
  }
  return {
    message: citations.length ? `我从项目记忆中找到了 ${citations.length} 条相关记录，最相关的是“${citations[0].title}”。你可以继续追问进展、提醒依据或下一步。` : "项目里还没有足够的知识卡片，先输入一条项目碎片，我再帮你建立可引用的记忆。",
    citations,
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
  let answer = mockAnswer({ question, cards, interventions, actions });
  let fallback = true;
  let fallbackReason: string | null = "mock_mode";
  if (process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY) {
    try {
      answer = await chatJson(
        buildCopilotPrompt({
          project,
          question,
          cards: cards.map((card) => ({ id: card.id, title: card.title, summary: card.summary, type: String(card.type) })),
          interventions: interventions.map((item) => ({ id: item.id, title: item.title, content: item.content, status: String(item.status) })),
          actions: actions.map((item) => ({ id: item.id, title: item.title, status: String(item.status) })),
        }),
        (value) => responseSchema.parse(value),
      );
      fallback = false;
      fallbackReason = null;
    } catch (error) {
      console.warn("LLM copilot failed; using deterministic mock", error);
      fallbackReason = error instanceof Error ? error.message.slice(0, 180) : "llm_error";
    }
  }
  const knownCardIds = new Set(cards.map((card) => card.id));
  answer = {
    ...answer,
    citations: answer.citations.filter((citation) => knownCardIds.has(citation.cardId)),
    proposedActions: answer.proposedActions.map((proposal) => proposal.kind === "generate_artifact" && !proposal.artifactType
      ? { ...proposal, artifactType: "competition_outline" as const }
      : proposal),
  };
  const run = await saveAgentRun({
    projectId,
    runType: AgentRunType.CHAT,
    status: fallback ? AgentRunStatus.FALLBACK : AgentRunStatus.SUCCESS,
    provider: fallback ? "mock" : "openai-compatible",
    fallbackReason,
    trace: {
      intent: /提醒|为什么|介入/.test(question) ? "explain_intervention" : /进展|总结/.test(question) ? "summarize_progress" : "search_memory",
      citedCardIds: answer.citations.map((citation) => citation.cardId),
      proposedToolCount: answer.proposedActions.length,
      modelMode: process.env.LLM_MODE ?? "mock",
    },
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
  return { ...answer, runId: run.id, fallback };
}

export async function getProjectChat(projectId: string) {
  await requireProject(projectId);
  return listAgentMessages(projectId);
}

export async function executeCopilotTool(projectId: string, input: { tool: "create_action" | "generate_artifact"; confirmed: boolean; payload: Record<string, unknown> }) {
  if (!input.confirmed) throw new AppError("CONFIRMATION_REQUIRED", "写操作需要你确认后才能执行", 400);
  await requireProject(projectId);
  if (input.tool === "create_action") {
    const parsed = actionCreateSchema.parse(input.payload);
    return { tool: input.tool, result: await createAction(projectId, parsed) };
  }
  const parsed = artifactCreateSchema.parse(input.payload);
  return { tool: input.tool, result: await generateArtifact(projectId, parsed.artifactType) };
}
