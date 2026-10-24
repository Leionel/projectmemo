import { reserveCloudCall } from "@/lib/auth/cloudQuota";
import {AppError} from "@/lib/api";
import type {Prisma} from "@/lib/generated/prisma/client";
import {continuationSuggestion,freezeContinuation} from "@/lib/copilot/continuation";
import {assertActor,type SourceManifest} from "@/lib/copilot/confirmation";
import {getProjectAgentContext} from "./projectAgentContextService";
import type {CopilotContinuationSuggestion} from "@/lib/types/copilotContinuation";
import { configuredClaimJudge } from "@/lib/mission/claimJudgeAdapter";
import { assessCopilotSemantics } from "@/lib/evidence/copilotSemantic";
import { evidenceAssessment } from "@/lib/evidence/assessment";
import { jsonHash } from "@/lib/mission/contracts";
import { z } from "zod";
import { chatJsonWithMeta } from "@/lib/agent/llmAgent";
import { buildCopilotPrompt } from "@/lib/agent/prompts";
import { isFeatureEnabled } from "@/lib/config/features";
import { evaluateTrustReceipt, guardedAnswerMessage, type ClaimDraft } from "@/lib/evidence/trustReceipt";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { listAgentMessages, saveAgentMessage, saveAgentRun } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import { getDecisionTimeline } from "@/lib/services/temporalLedgerService";
import { assertCopilotSources, confirmCopilotTool, freezeCopilotProposals, readCopilotContext, type CopilotActor } from "@/lib/copilot/confirmation";
import type { AgentChatResponse, AgentCitation, CardSearchResult, EvidenceTrustReceipt, ProjectEvidenceRef, ProposedAction } from "@/lib/types";

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
          topLevelState: r.topLevelState,
          reasonCode: r.reasonCode,
          displayReason: r.displayReason,
          evidenceRefs: r.evidenceRefs,
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
      message: primary ? `目前找到的项目记录写道：${primary.excerpt}` : "当前没有检索到能直接支持进展结论的项目记忆。",
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

type ChatTurn={requestId:string;userMessageId:string};
async function persistAnswer(tx:Prisma.TransactionClient,runId:string,projectId:string,answer:{message:string;citations:AgentCitation[];proposedActions:ProposedAction[]},suggestion:CopilotContinuationSuggestion|undefined,manifest:SourceManifest,actor?:CopilotActor,turn?:ChatTurn){
  const continuation=suggestion?{...suggestion,sourceRunId:runId}:undefined;
  if(continuation){
    const run=await tx.agentRun.findUniqueOrThrow({where:{id:runId}});
    await tx.agentRun.update({where:{id:runId},data:{resultJson:{...run.resultJson as object,continuationSuggestion:continuation}}});
    await freezeContinuation(tx,runId,continuation,manifest);
  }
  await saveAgentMessage({projectId,role:"ASSISTANT",content:answer.message,citations:answer.citations,proposedActions:answer.proposedActions,runId,ownerUserId:actor?.userId,requestId:turn?.requestId,requestState:"ANSWERED"},tx);
  if(turn)await tx.agentMessage.update({where:{id:turn.userMessageId},data:{requestState:"ANSWERED"}});
  return continuation;
}
export async function answerProjectQuestion(projectId:string,question:string,actor?:CopilotActor,requestId?:string):Promise<AgentChatResponse>{
  if(!actor||!requestId)return answerQuestion(projectId,question,actor);
  await db.$transaction(tx=>assertActor(tx,projectId,actor));
  async function replay(){
    const user=await db.agentMessage.findFirst({where:{projectId,ownerUserId:actor!.userId,requestId,role:"USER"}});
    if(!user)return null;if(user.content!==question)throw new AppError("REQUEST_ID_REUSED","请求编号已用于另一条问题",409);
    const message=await db.agentMessage.findFirst({where:{projectId,ownerUserId:actor!.userId,requestId,role:"ASSISTANT"},include:{run:true}});
    if(!message?.run&&user.requestState==="PENDING"&&user.createdAt.getTime()<Date.now()-10*60*1000){
      await db.agentMessage.updateMany({where:{id:user.id,requestState:"PENDING"},data:{requestState:"FAILED"}});
      user.requestState="FAILED";
    }
    if(!message?.run)throw new AppError(user.requestState==="FAILED"?"COPILOT_TURN_FAILED":"COPILOT_TURN_PENDING",user.requestState==="FAILED"?"原问题未完成，请重新提问；没有自动创建业务任务":"原问题仍在处理中，请稍后重试读取同一回答",409);
    const result=message.run.resultJson as {continuationSuggestion?:CopilotContinuationSuggestion;trustReceipt?:EvidenceTrustReceipt};
    return {message:message.content,citations:message.citations as unknown as AgentCitation[],proposedActions:message.proposedActions as unknown as ProposedAction[],runId:message.run.id,fallback:message.run.status==="FALLBACK",trustReceipt:result?.trustReceipt??undefined,continuationSuggestion:result?.continuationSuggestion};
  }
  const old=await replay();if(old)return old;
  let user;
  try{user=await saveAgentMessage({projectId,role:"USER",content:question,citations:[],proposedActions:[],ownerUserId:actor.userId,requestId,requestState:"PENDING"});}
  catch(error){if((error as {code?:string}).code==="P2002"){const existing=await replay();if(existing)return existing;}throw error;}
  try{return await answerQuestion(projectId,question,actor,{requestId,userMessageId:user.id});}
  catch(error){await db.agentMessage.updateMany({where:{id:user.id,requestState:"PENDING"},data:{requestState:"FAILED"}});throw error;}
}
async function answerQuestion(projectId: string, question: string, actor?: CopilotActor,turn?:ChatTurn): Promise<AgentChatResponse> {
  const startedAt = Date.now();
  const { project, cards, interventions, actions, sourceManifest } = await db.$transaction(tx => readCopilotContext(tx, projectId, actor));
  const history=actor?await db.agentMessage.findMany({where:{projectId,ownerUserId:actor.userId,requestState:"ANSWERED"},orderBy:[{createdAt:"desc"},{id:"desc"}],take:12,select:{id:true,role:true,content:true}}):[];
  const dialogue=history.slice(0,6).reverse().map(m=>({role:m.role,text:m.content.slice(0,1000)}));
  const explicitConstraints=history.filter(m=>m.role==="USER"&&/不要|禁止|不允许|只读|不得|不创建|不使用/.test(m.content)).slice(0,6).map(m=>m.content.slice(0,1000));
  const missionContext=actor?await getProjectAgentContext(actor.userId,projectId):null;
  if(!turn)await saveAgentMessage({ projectId, role: "USER", content: question, citations: [], proposedActions: [],ownerUserId:actor?.userId,requestState:"ANSWERED" });
  const suggested=await continuationSuggestion(projectId,question,actor);
  // 当前提醒数和提醒原文是本项目的持久化事实，可以直接核对；不必强迫它们
  // 再匹配到一张知识卡片。这里只回答已有状态，不推断未记录的触发原因。
  const asksCurrentReminders = /(提醒|主动介入)/.test(question)
    && /(当前|现在|目前|正在|会触发|有哪些|有.*提醒|提醒.*吗)/.test(question)
    && !/(曾经|之前|过去|历史|上次|那次|当时|创建|新增|设置|安排|发送|关闭|取消)/.test(question);
  if (asksCurrentReminders) {
    const observedAt = new Date().toISOString();
    const openReminders = interventions.filter((item) => item.status === "OPEN" && !item.isSimulated);
    const simulatedCount = interventions.filter((item) => item.status === "OPEN" && item.isSimulated).length;
    const topReminder = openReminders[0];
    const projectRef: ProjectEvidenceRef = {
      kind: "project_status", entityId: projectId, label: "当前开放提醒",
      detail: `真实 ${openReminders.length} 条，演示 ${simulatedCount} 条`, observedAt,
    };
    const projectRefs: ProjectEvidenceRef[] = [projectRef];
    if (topReminder) {
      projectRefs.push({
        kind: "intervention", entityId: topReminder.id, label: "提醒记录",
        detail: `${topReminder.title}：${topReminder.content}`, observedAt,
      });
    }
    const message = topReminder
      ? `当前项目有 ${openReminders.length} 条开放中的真实主动提醒。最优先的是「${topReminder.title}」。提醒记录写明：${topReminder.content}。具体来源请在这条提醒的详情中核对。`
      : `当前项目没有开放中的真实主动提醒${simulatedCount > 0 ? `，另有 ${simulatedCount} 条演示情境提醒` : ""}。现在没有正在触发的真实提醒可供解释；如果你指过去的提醒，请到主动提醒列表查看那条记录。`;
    const trustReceipt: EvidenceTrustReceipt = {
      supportState: "SUPPORTED", abstained: false,
      claims: [{
        text: topReminder
          ? `当前项目有 ${openReminders.length} 条开放中的真实主动提醒，首条记录为「${topReminder.title}」：${topReminder.content}`
          : `当前项目有 0 条开放中的真实主动提醒。`,
        support: "SUPPORTED", cardIds: [], supersededCardIds: [], projectRefs,
      }],
      retrievalMode: "project_state", refusalReason: null, evaluatedAt: observedAt,
    };
    const run = await db.$transaction(async tx=>{
      await assertCopilotSources(tx,projectId,sourceManifest,actor);
      const saved = await saveAgentRun({
      projectId, runType: AgentRunType.CHAT, status: AgentRunStatus.SUCCESS,
      provider: "project_state", fallbackReason: null,
      trace: {
        actorUserId:actor?.userId,copilotSources:sourceManifest,
        intent: "inspect_current_reminders", retrievalMode: "project_state",
        supportState: "SUPPORTED", abstained: false, trustReceipt,
      },
      resultJson: { proposedActions: [], trustReceipt }, durationMs: Date.now() - startedAt,
    },tx);
      const continuation=await persistAnswer(tx,saved.id,projectId,{message,citations:[],proposedActions:[]},suggested,sourceManifest,actor,turn);
      return {...saved,continuationSuggestion:continuation};
    });
    return {message,citations:[],proposedActions:[],runId:run.id,fallback:false,trustReceipt,continuationSuggestion:run.continuationSuggestion};
  }

  const timeline = await getDecisionTimeline(projectId);
  const temporalById = new Map(timeline.items.map(item => [item.card.id, item]));
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
          dialogue:{messages:dialogue,explicitConstraints},missionContext,
          cards: cards.filter((card) => evidenceSearch.citations.some((citation) => citation.cardId === card.id)).map((card) => ({ id: card.id, title: card.title, summary: card.summary, type: String(card.type), temporalState: temporalById.get(card.id)?.topLevelState ?? "UNKNOWN", sourceRevision: sourceManifest.cardHashes.find(item => item.id === card.id)?.hash ?? "", observedAt: sourceManifest.observedAt })),
          interventions: interventions.map((item) => ({ id: item.id, title: item.title, content: item.content, status: String(item.status) })),
          actions: actions.map((item) => ({ id: item.id, title: item.title, status: String(item.status) })),
        }),
        (value) => responseSchema.parse(value),
        projectId,
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
        assessment: evidenceAssessment({ sourceId: `card:${cardId}`, sourceRevision: sourceManifest.cardHashes.find(item => item.id === cardId)?.hash ?? "",
          observedAt: timeline.asOf, sourceTime: temporal?.card.createdAt ?? null, citationAdmissibility: "ADMITTED",
          temporalState: temporal?.topLevelState ?? "UNKNOWN", textRange: { start: 0, end: card?.summary.length ?? 0 } }),
        title: card?.title ?? citation.title,
        excerpt: (card?.summary ?? citation.excerpt).slice(0, 180),
        current: temporal?.current ?? true,
        supportState: temporal?.supportState ?? "INSUFFICIENT",
        topLevelState: temporal?.topLevelState ?? "UNKNOWN",
        reasonCode: temporal?.reasonCode ?? "NO_SUPPORTING_EVIDENCE",
        displayReason: temporal?.displayReason ?? "尚无足够的时态关系证据，当前结论保持未知。",
        evidenceRefs: temporal?.evidenceRefs ?? [],
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
    const judge = isFeatureEnabled("COPILOT_CLAIM_JUDGE_ENABLED", false) && process.env.LLM_MODE === "openai-compatible" ? async (request: Parameters<typeof configuredClaimJudge>[0]) => {
      await reserveCloudCall(projectId);
      try {
        const result = await configuredClaimJudge(request);
        await saveAgentRun({ projectId, runType: AgentRunType.CHAT, status: AgentRunStatus.SUCCESS, provider: result.provider,
          trace: { purpose: "COPILOT_CLAIM_JUDGE", claimHash: jsonHash(request.text), model: result.model, usage: result.usage }, resultJson: { verdict: result.verdict } });
        return result;
      } catch (error) {
        await saveAgentRun({ projectId, runType: AgentRunType.CHAT, status: AgentRunStatus.FAILED, provider: "copilot-claim-judge",
          fallbackReason: "JUDGE_UNAVAILABLE", trace: { purpose: "COPILOT_CLAIM_JUDGE", claimHash: jsonHash(request.text), usageUnknown: true } });
        throw error;
      }
    } : undefined;
    const semanticChecks = await assessCopilotSemantics(answer.claims, cards.filter(card => retrievedCardIds.has(card.id)), judge);
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
            text: card.summary, revision: sourceManifest.cardHashes.find(item => item.id === card.id)?.hash,
            sourceTime: temporal?.card.createdAt, semanticChecks: semanticChecks.get(card.id),
            current: temporal?.current ?? true,
            supportState: temporal?.supportState ?? "INSUFFICIENT" as const,
            topLevelState: temporal?.topLevelState ?? "UNKNOWN" as const,
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
    const unverified = trustReceipt.claims.some(claim => !claim.assessments?.length || claim.assessments.some(a => a.semanticVerdict !== "ENTAILS"));
    const boundedMessage = unverified && trustReceipt.supportState === "SUPPORTED"
      ? `找到以下项目记录，回答中的推断尚未完成语义核对：\n${answer.citations.slice(0, 3).map(c => `「${c.title}」记录：${c.excerpt}`).join("\n")}` : answer.message;
    answer = {
      ...answer,
      message: guardedAnswerMessage(trustReceipt, boundedMessage),
      proposedActions: trustReceipt.supportState === "SUPPORTED" ? answer.proposedActions : [],
    };
  }
  const run = await db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Project" SET "id" = "id" WHERE "id" = ${projectId}`;
    await assertCopilotSources(tx, projectId, sourceManifest, actor);
    const saved = await saveAgentRun({
    projectId,
    runType: AgentRunType.CHAT,
    status: fallback ? AgentRunStatus.FALLBACK : trustReceipt?.abstained ? AgentRunStatus.PARTIAL : AgentRunStatus.SUCCESS,
    provider,
    fallbackReason,
    trace: {
      ...(actor ? { actorUserId: actor.userId } : {}),
      copilotSources: sourceManifest,
      dialogueManifest:{schemaVersion:1,messageIds:history.map(m=>m.id),hash:jsonHash({dialogue,explicitConstraints}),missionObservationHash:missionContext?.observationHash??null},
      evidenceManifest: { schemaVersion: 1, promptVersion: "copilot-evidence-v1", questionHash: jsonHash(question),
        includedCardIds: answer.citations.map(c => c.cardId), sourceHashes: sourceManifest.cardHashes.filter(item => retrievedCardIds.has(item.id)),
        temporalAsOf: timeline.asOf, semanticJudgeEnabled: isFeatureEnabled("COPILOT_CLAIM_JUDGE_ENABLED", false) },
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
    }, tx);
    await freezeCopilotProposals(tx, saved.id, answer.proposedActions, sourceManifest);
    const continuation=await persistAnswer(tx,saved.id,projectId,answer,suggested,sourceManifest,actor,turn);
    return {...saved,continuationSuggestion:continuation};
  });
  return { message: answer.message, citations: answer.citations, proposedActions: answer.proposedActions, runId: run.id, fallback,continuationSuggestion:run.continuationSuggestion, ...(trustReceipt ? { trustReceipt } : {}) };
}

export async function getProjectChat(projectId: string,ownerUserId?:string,sourceRunId?:string) {
  await requireProject(projectId);
  const messages = await listAgentMessages(projectId,20,ownerUserId,sourceRunId);
  if (!isFeatureEnabled("EVIDENCE_TRUST_RECEIPT_ENABLED", true)) return messages;
  return messages.map((message) => message.role === "ASSISTANT" && !message.trustReceipt
    ? { ...message, proposedActions: [] }
    : message);
}

export async function executeCopilotTool(projectId: string, input: { tool: "create_action" | "generate_artifact"; confirmed: boolean; payload: Record<string, unknown>; sourceRunId?: string }, actor?: CopilotActor) {
  return confirmCopilotTool(projectId, input, actor);
}
