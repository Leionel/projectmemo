import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertProject, ownedConversation, record } from "@/lib/conversation/repository";
import type { ConversationActor } from "@/lib/types/conversation";
import { effectiveContinuity } from "./directiveService";
import { sourceUse } from "./sourcePolicy";
import { z } from "zod";
import { lockConversation } from "@/lib/conversation/repository";
import { bindRefs } from "@/lib/conversation/service";

/** A read of original Missions and Action receipts. Reading a handoff dispatches nothing. */
export async function readContinuity(actor: ConversationActor, conversationId: string, projectId?: string) {
  const c = await ownedConversation(actor, conversationId), focus = record(c.focusJson).projectId;
  const target = projectId ?? c.homeProjectId ?? (typeof focus === "string" ? focus : null);
  if (!target) return null;
  if (c.scope === "PROJECT" && target !== c.homeProjectId) throw new AppError("DIRECTIVE_SCOPE_CHANGED", "请切换到对应项目", 409);
  const member = await assertProject(actor, target);
  const focused = record(record(c.focusJson).entityRef);
  const view = await effectiveContinuity(actor.userId, { projectId: target, conversationId, ...(focused.kind === "MISSION" && focused.projectId === target && typeof focused.id === "string" ? { missionId: focused.id } : {}) });
  const recent = await db.conversationTurn.findMany({ where: { conversation: { ownerUserId: actor.userId, OR: [{ homeProjectId: target }, { projects: { some: { projectId: target } } }] }, status: { in: ["ANSWERED", "NEEDS_CLARIFICATION"] } }, orderBy: { createdAt: "desc" }, take: 16 });
  let candidate: import("@/lib/types/continuity").ContinuityView["candidate"];
  for (const t of recent) {
    const value = record(record(t.readManifestJson).directiveCandidate);
    if (value.status !== "INTERPRETATION_CANDIDATE" || value.projectId !== target) continue;
    const savedScope = record(value.scope);
    const scope = { projectId: target, ...(typeof savedScope.missionId === "string" ? { missionId: savedScope.missionId } : {}) };
    const originalView = await effectiveContinuity(actor.userId, { ...scope, conversationId: t.conversationId });
    if (record(value.binding).intentHash === originalView.intentHash && typeof value.id === "string" && typeof value.quote === "string" && typeof value.interpretation === "string" && ["WORKING_OBJECTIVE", "CONSTRAINT"].includes(String(value.kind))) {
      candidate = { id: value.id, quote: value.quote, interpretation: value.interpretation, kind: value.kind as "WORKING_OBJECTIVE" | "CONSTRAINT", turnId: t.id, conversationId: t.conversationId, scope }; break;
    }
  }
  const [missions, actions] = await Promise.all([
    member.role === "OWNER" ? db.agentMission.findMany({ where: { ownerUserId: actor.userId, projectId: target, status: { notIn: ["CANCELLED", "SUCCEEDED"] } }, orderBy: { updatedAt: "desc" }, take: 8 }) : [],
    db.actionItem.findMany({ where: { projectId: target, isSimulated: false, status: "DONE", resultCardId: { not: null } }, orderBy: { completedAt: "desc" }, take: 5 }),
  ]);
  const results = [];
  for (const a of actions) if ((await sourceUse(actor.userId, target, "action:" + a.id, db, { conversationId })).state === "ALLOWED")
    results.push({ id: a.id, title: a.title, resultText: a.resultText, resultCardId: a.resultCardId, verification: "REPORTED" as const, href: `/projects/${target}/actions#action-${a.id}` });
  return { ...view, ...(candidate ? { candidate } : {}), handoff: { missions: missions.map(m => ({ id: m.id, goal: m.goal, status: m.status,
    nextOwner: ["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED"].includes(m.status) ? "USER" : "AGENT",
    href: `/projects/${target}/missions?mission=${m.id}` })), results } };
}
const openSchema = z.object({ kind: z.enum(["MISSION", "ACTION"]), id: z.string().min(1).max(180), projectId: z.string().min(1).max(180) }).strict();
/** Explicit user navigation binds an original object through the existing ConversationBinding contract. */
export async function openHandoffWork(actor: ConversationActor, conversationId: string, raw: unknown) {
  const input = openSchema.parse(raw), view = await readContinuity(actor, conversationId, input.projectId);
  const item = input.kind === "MISSION" ? view?.handoff?.missions.find(m => m.id === input.id) : view?.handoff?.results.find(a => a.id === input.id);
  if (!item) throw new AppError("OBJECT_NOT_BOUND", "接续项已变化，请读取当前原对象", 409);
  await db.$transaction(async tx => {
    await lockConversation(tx, conversationId); await ownedConversation(actor, conversationId, tx);
    if (input.kind === "MISSION" && !await tx.agentMission.findFirst({ where: { id: input.id, projectId: input.projectId, ownerUserId: actor.userId } }))
      throw new AppError("MISSION_NOT_FOUND", "原委托已不可访问", 404);
    if (input.kind === "ACTION" && !await tx.actionItem.findFirst({ where: { id: input.id, projectId: input.projectId, isSimulated: false } }))
      throw new AppError("ACTION_NOT_FOUND", "原行动已不可访问", 404);
    await bindRefs(tx, conversationId, [{ kind: input.kind, id: input.id, projectId: input.projectId,
      title: "goal" in item ? item.goal : item.title, href: item.href }]);
  });
  return { ref: input };
}
