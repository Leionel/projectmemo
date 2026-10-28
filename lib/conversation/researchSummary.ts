import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { saveArtifactInTx } from "@/lib/repositories/artifacts";
import { assertProject, lockConversation, ownedConversation, record } from "./repository";
import { validateReadSources } from "./service";
import { validateWebSource } from "./researchScope";
import { researchCoverageLabel, researchReadLevelLabel } from "./researchLabels";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";

const schema = z.object({ action: z.enum(["PREVIEW", "CONFIRM"]), expectedConversationVersion: z.number().int().positive(), previewHash: z.string().optional() }).strict();
export async function adoptResearchSummary(actor: ConversationActor, id: string, messageId: string, raw: unknown) {
  const input = schema.parse(raw);
  return db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await ownedConversation(actor, id, tx);
    const message = await tx.agentMessage.findFirst({ where: { id: messageId, conversationId: id, ownerUserId: actor.userId, role: "ASSISTANT" } });
    if (!message?.turnId) throw new AppError("MESSAGE_NOT_FOUND", "未找到原研究回答", 404);
    const blocks = record(message.blocksJson) as unknown as ConversationBlocks;
    if (!blocks.sources?.some(s => s.external?.readLevel !== "UNAVAILABLE" && s.external)) throw new AppError("RESEARCH_NOT_READ", "尚未取得可归入的研究来源", 409);
    const projectIds = [...new Set(blocks.sources.map(s => s.projectId))];
    if (projectIds.length !== 1) throw new AppError("RESEARCH_PROJECT_AMBIGUOUS", "请先明确研究总结归入的单个项目", 409);
    const projectId = projectIds[0]; const membership = await assertProject(actor, projectId, tx);
    if (membership.role !== "OWNER") throw new AppError("FORBIDDEN", "仅项目所有者可将私有研究归入项目", 403);
    for (const source of blocks.sources.filter(s => s.external)) await validateWebSource(actor, source, tx);
    const coverage = blocks.researchCoverage;
    const content = ["# 项目研究总结", "", "## 建议与判断", message.content, "", "## 适用条件与待核对事项",
      ...(coverage?.facets.map(f => `- ${f.question}：${researchCoverageLabel(f.coverage)}${f.missing.length ? "；待核对 " + f.missing.join("、") : ""}${f.conflicts.length ? "；冲突 " + f.conflicts.map(x => x.claim).join("；") : ""}`) ?? ["- 本次保留建议与实际已读片段；项目实际结果需要原记录或后续验证。"]),
      "", "## 来源与阅读范围", ...blocks.sources.filter(s => s.external).map(s => `- ${s.title} · ${researchReadLevelLabel(s.external!.readLevel)} · ${s.external!.requestedUrl}\n  抓取于 ${s.external!.fetchedAt}\n  已读片段：${s.excerpt.slice(0, 1200)}`),
    ].join("\n");
    const previewHash = jsonHash({ messageId, projectId, content, sources: blocks.sources.map(s => ({ id: s.id, revision: s.revision, excerptHash: s.excerptHash })) });
    const turn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: message.turnId } }), manifest = record(turn.readManifestJson);
    const receipts = record(manifest.researchSummaryReceipts), existing = receipts[previewHash] as { artifactId: string } | undefined;
    if (input.action === "CONFIRM" && input.previewHash !== previewHash) throw new AppError("SUMMARY_CHANGED", "研究总结已变化，请重新预览", 409);
    if (existing && input.action === "CONFIRM") return { previewHash, content, projectId, artifactId: existing.artifactId };
    await validateReadSources(actor, blocks.sources, tx);
    if (c.version !== input.expectedConversationVersion || c.activeTurnId) throw new AppError("CONVERSATION_CHANGED", "讨论正在变化，请更新后再预览研究总结", 409);
    const previews = record(manifest.researchSummaryPreviews);
    if (input.action === "PREVIEW") {
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { readManifestJson: json({ ...manifest, researchSummaryPreviews: {
        ...previews, [previewHash]: { conversationVersion: c.version, expiresAt: new Date(Date.now() + 900000).toISOString() },
      } }) } });
      return { previewHash, content, projectId };
    }
    const issued = record(previews[previewHash]);
    if (issued.conversationVersion !== c.version || typeof issued.expiresAt !== "string" || Date.parse(issued.expiresAt) <= Date.now())
      throw new AppError("SUMMARY_PREVIEW_REQUIRED", "请先读取当前研究总结预览再确认", 409);
    const artifact = await saveArtifactInTx(tx, projectId, "weekly_report", content, json({ schemaVersion: 1, kind: "CONVERSATION_RESEARCH", conversationId: id, messageId,
      sources: blocks.sources, researchCoverage: coverage ?? null, verification: "UNMAPPED_MODEL" }));
    await tx.conversationTurn.update({ where: { id: turn.id }, data: { readManifestJson: json({ ...manifest, researchSummaryReceipts: { ...receipts, [previewHash]: { artifactId: artifact.id, previewHash } } }) } });
    return { previewHash, content, projectId, artifactId: artifact.id };
  });
}
