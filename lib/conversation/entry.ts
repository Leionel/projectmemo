import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { currentGoalQuestion } from "@/lib/decision/questions";
import { assertProject } from "./repository";
import type { ConversationActor, ConversationEntry, ConversationRef } from "@/lib/types/conversation";

export async function readConversationEntry(actor: ConversationActor, entry: ConversationEntry) {
  const member = await assertProject(actor, entry.projectId);
  let ref: ConversationRef, text: string, revision: string;
  if (entry.kind === "INTERVENTION") {
    const row = await db.agentIntervention.findFirst({ where: {
      id: entry.id, projectId: entry.projectId, isSimulated: false,
      NOT: { dedupeKey: { startsWith: "goal:" } },
    } });
    if (!row) throw new AppError("ENTRY_NOT_FOUND", "提醒已不可访问", 404);
    ref = { kind: "INTERVENTION", id: row.id, projectId: entry.projectId, title: row.title,
      status: row.status, href: "/projects/" + entry.projectId + "/actions#intervention-" + row.id };
    text = row.content;
    revision = jsonHash({ id: row.id, title: row.title, content: row.content, status: row.status, evidenceCardId: row.evidenceCardId });
  } else if (entry.kind === "GOAL_QUESTION") {
    const q = (await currentGoalQuestion(actor, entry.projectId)).question;
    if (!q || q.questionId !== entry.id) throw new AppError("ENTRY_CHANGED", "原问题已变化，请重新读取", 409);
    ref = { kind: "GOAL_QUESTION", id: q.questionId, projectId: entry.projectId, title: q.text,
      questionId: q.questionId, href: q.href };
    text = q.whyNow + " " + q.unansweredConsequence;
    revision = q.contextHash;
  } else {
    if (member.role !== "OWNER") throw new AppError("ENTRY_NOT_FOUND", "变化不可访问", 404);
    const effect = await db.projectImpactEffect.findFirst({ where: { id: entry.id,
      mission: { projectId: entry.projectId, ownerUserId: actor.userId } }, include: { mission: true } });
    if (!effect) throw new AppError("ENTRY_NOT_FOUND", "变化不可访问", 404);
    ref = { kind: "IMPACT", id: effect.id, projectId: entry.projectId, title: "原委托依据变化",
      href: "/projects/" + entry.projectId + "/missions?mission=" + effect.missionId };
    text = "委托计划由修订 " + effect.oldPlanRevision + " 进入 " + effect.newPlanRevision + "，需要回原依据核对。";
    revision = jsonHash(effect);
  }
  if (entry.revision && entry.revision !== revision) throw new AppError("ENTRY_CHANGED", "提醒或问题依据已变化，请刷新", 409);
  return { ref, text, revision };
}
