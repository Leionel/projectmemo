import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { record } from "@/lib/conversation/repository";
import { event, ownedMission, lock, validateSources, type Tx } from "@/lib/mission/repository";
import { jsonHash, type Source } from "@/lib/mission/contracts";
import { investigationInputHash } from "@/lib/mission/investigationDelegation";
import { addMissionMaterialInTx } from "@/lib/mission/materialService";
import type { AgentMission } from "@/lib/generated/prisma/client";
import type { ChallengeSession, ChallengeAnswer, ChallengeKind } from "@/lib/types/challenge";
import { challengeQuestions, linkVerdict, type FrozenQuestion } from "./rules";

const requestId = z.string().min(1).max(100);
const startInput = z.object({ requestId, kind: z.enum(["EVIDENCE", "REHEARSAL"]), outputId: z.string().min(1).max(160) }).strict();
const commandInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ANSWER"), requestId, questionKey: z.string().max(50), text: z.string().trim().max(1200).default(""), selected: z.array(z.string().max(180)).max(17).default([]) }).strict(),
  z.object({ action: z.literal("OPEN_SOURCE"), requestId, sourceKey: z.string().max(240) }).strict(),
  z.object({ action: z.literal("HANDOFF"), requestId }).strict(),
  z.object({ action: z.literal("STOP"), requestId }).strict(),
]);
type Frozen = { kind: ChallengeKind; outputId: string; revision: number; contextVersion: number; inputHash: string;
  outputHash: string; questions: FrozenQuestion[]; sourceKeys: string[] };
function enabled() {
  if (!isFeatureEnabled("MISSION_V2_ENABLED", false) || !isFeatureEnabled("MISSION_CHALLENGES_ENABLED", false))
    throw new AppError("CHALLENGE_DISABLED", "成果挑战尚未开启", 404);
}
async function replay(tx: Tx, missionId: string, id: string, hash: string) {
  const row = await tx.agentMissionEvent.findUnique({ where: { missionId_commandRequestId: { missionId, commandRequestId: id } } });
  if (row && row.commandPayloadHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于其他挑战内容", 409);
  return row;
}
async function sessionState(tx: Tx, m: AgentMission, id: string) {
  const start = await tx.agentMissionEvent.findFirst({ where: { id, missionId: m.id, type: "CHALLENGE_STARTED" } });
  if (!start) throw new AppError("CHALLENGE_NOT_FOUND", "没有可访问的挑战", 404);
  const frozen = start.payloadJson as unknown as Frozen;
  const events = await tx.agentMissionEvent.findMany({ where: { missionId: m.id, seq: { gt: start.seq },
    type: { in: ["CHALLENGE_ANSWERED", "CHALLENGE_SOURCE_OPENED", "CHALLENGE_STOPPED", "CHALLENGE_HANDED_OFF"] },
    payloadJson: { path: "$.challengeId", equals: id } }, orderBy: { seq: "asc" }, take: 24 });
  const answers = events.filter(e => e.type === "CHALLENGE_ANSWERED").map(e => record(e.payloadJson).answer as ChallengeAnswer);
  const handoff = events.find(e => e.type === "CHALLENGE_HANDED_OFF");
  let reason: string | null = null;
  const output = await tx.agentMissionOutput.findFirst({ where: { id: frozen.outputId, missionId: m.id } });
  const latest = await tx.agentMissionOutput.findFirst({ where: { missionId: m.id }, orderBy: { revision: "desc" }, select: { id: true } });
  if (!output || latest?.id !== frozen.outputId || frozen.outputHash !== jsonHash({ content: output.contentJson, sources: output.sourceRefsJson })) reason = "稿件已有变化，请从当前版本重新开始";
  else if (m.contextVersion !== frozen.contextVersion || (await investigationInputHash(m, tx)).hash !== frozen.inputHash) reason = "项目资料或工作方向已变化，本轮已撤下";
  else {
    try { await validateSources(m.projectId, output.sourceRefsJson as unknown as Source[], tx, m.id); }
    catch { reason = "来源已变化或使用权限已撤销，本轮已撤下"; }
  }
  if (Date.now() - start.createdAt.getTime() > 86400000) reason = "本轮已超过一天，请核对当前成果后重新开始";
  const stopped = events.some(e => e.type === "CHALLENGE_STOPPED") || ["CANCELLED", "SUCCEEDED"].includes(m.status);
  const session: ChallengeSession = { schemaVersion: 1, id, missionId: m.id, outputId: frozen.outputId, revision: frozen.revision, kind: frozen.kind,
    status: reason ? "STALE" : stopped ? "STOPPED" : answers.length === frozen.questions.length ? "COMPLETED" : "ACTIVE", reason,
    // A revoked or stale source must not survive in cached question/answer text from the event ledger.
    questions: reason ? [] : frozen.questions.map(({ key, title, excerpt, options }) => ({ key, title, excerpt, options })), answers: reason ? [] : answers,
    sourceKeys: reason ? [] : frozen.sourceKeys,
    openedSourceKeys: reason ? [] : events.filter(e => e.type === "CHALLENGE_SOURCE_OPENED").map(e => String(record(e.payloadJson).sourceKey)),
    handoffSourceId: handoff ? String(record(handoff.payloadJson).sourceId) : null, createdAt: start.createdAt.toISOString() };
  return { session, frozen };
}
export async function readChallenge(userId: string, missionId: string, id?: string): Promise<ChallengeSession | null> {
  enabled();
  return db.$transaction(async tx => {
    const m = await ownedMission(userId, missionId, tx);
    const latest = id ? { id } : await tx.agentMissionEvent.findFirst({ where: { missionId, type: "CHALLENGE_STARTED" }, orderBy: { seq: "desc" }, select: { id: true } });
    return latest ? (await sessionState(tx, m, latest.id)).session : null;
  });
}
export async function startChallenge(userId: string, missionId: string, raw: unknown) {
  enabled(); const body = startInput.parse(raw), hash = jsonHash(body), key = "challenge:start:" + body.requestId;
  return db.$transaction(async tx => {
    const m = await ownedMission(userId, missionId, tx); await lock(tx, missionId);
    if (m.runtimeProtocolVersion !== 2) throw new AppError("MISSION_PROTOCOL_REQUIRED", "成果挑战仅用于 V2 委托", 409);
    const old = await replay(tx, missionId, key, hash);
    if (old) return { session: (await sessionState(tx, m, old.id)).session, replayed: true };
    if (["CANCELLED", "SUCCEEDED"].includes(m.status)) throw new AppError("CHALLENGE_MISSION_ENDED", "原委托已结束，可以查看原稿", 409);
    const output = await tx.agentMissionOutput.findFirst({ where: { missionId }, orderBy: { revision: "desc" } });
    if (!output || output.id !== body.outputId) throw new AppError("CHALLENGE_OUTPUT_CHANGED", "请先读取当前稿件再开始", 409);
    const sources = output.sourceRefsJson as unknown as Source[];
    if (new Set(sources.map(source => source.id)).size > 16) throw new AppError("CHALLENGE_NOT_READY", "本轮来源较多，请先缩小核查范围", 409);
    await validateSources(m.projectId, sources, tx, missionId);
    const frozen: Frozen = { kind: body.kind, outputId: output.id, revision: output.revision, contextVersion: m.contextVersion,
      inputHash: (await investigationInputHash(m, tx)).hash, outputHash: jsonHash({ content: output.contentJson, sources: output.sourceRefsJson }),
      questions: challengeQuestions(body.kind, output.contentJson, sources), sourceKeys: [...new Set(sources.map(s => s.id + "@" + s.hash))] };
    const active = await tx.agentMissionEvent.findFirst({ where: { missionId, type: "CHALLENGE_STARTED" }, orderBy: { seq: "desc" } });
    if (active && (await sessionState(tx, m, active.id)).session.status === "ACTIVE") throw new AppError("CHALLENGE_ACTIVE", "已有一轮挑战，可继续或先退出本轮", 409);
    const start = await event(tx, missionId, "CHALLENGE_STARTED", frozen, { id: key, hash });
    return { session: (await sessionState(tx, m, start.id)).session, replayed: false };
  });
}
export async function commandChallenge(userId: string, missionId: string, id: string, raw: unknown) {
  enabled(); const body = commandInput.parse(raw), hash = jsonHash(body), key = "challenge:" + id + ":" + body.requestId;
  return db.$transaction(async tx => {
    const m = await ownedMission(userId, missionId, tx); await lock(tx, missionId);
    const old = await replay(tx, missionId, key, hash);
    const { session, frozen } = await sessionState(tx, m, id);
    if (old) return { session, replayed: true };
    const command = { id: key, hash }, base = { challengeId: id };
    if (body.action === "STOP") {
      if (session.status !== "STOPPED") await event(tx, missionId, "CHALLENGE_STOPPED", base, command);
    } else {
      if (session.status === "STALE") throw new AppError("CHALLENGE_STALE", session.reason!, 409);
      if (session.status === "STOPPED" || ["CANCELLED", "SUCCEEDED"].includes(m.status)) throw new AppError("CHALLENGE_STOPPED", "本轮或原委托已结束，不再接受新操作", 409);
      if (body.action === "ANSWER") {
        const question = frozen.questions[session.answers.length];
        if (!question || question.key !== body.questionKey) throw new AppError("CHALLENGE_ROUND_CHANGED", "本题已回答，请读取当前回合", 409);
        if (frozen.kind === "REHEARSAL" && (!body.text || body.selected.length)) throw new AppError("CHALLENGE_ANSWER_REQUIRED", "写下一项缺口，或说明目前不知道", 422);
        if (frozen.kind === "EVIDENCE" && (!body.selected.length || body.text || new Set(body.selected).size !== body.selected.length)) throw new AppError("CHALLENGE_ANSWER_REQUIRED", "请选择引用记录，或选择没有引用依据", 422);
        const answer: ChallengeAnswer = { questionKey: question.key, text: body.text, selected: body.selected,
          verdict: frozen.kind === "REHEARSAL" ? "OPEN" : linkVerdict(question, body.selected) };
        await event(tx, missionId, "CHALLENGE_ANSWERED", { ...base, answer }, command);
      } else if (body.action === "OPEN_SOURCE") {
        if (!frozen.sourceKeys.includes(body.sourceKey)) throw new AppError("CHALLENGE_SOURCE_DENIED", "该来源不属于本轮成果", 404);
        if (!session.openedSourceKeys.includes(body.sourceKey)) await event(tx, missionId, "CHALLENGE_SOURCE_OPENED", { ...base, sourceKey: body.sourceKey }, command);
      } else {
        if (session.status !== "COMPLETED") throw new AppError("CHALLENGE_INCOMPLETE", "先完成本轮，再将缺口交回原委托", 409);
        if (session.handoffSourceId) throw new AppError("CHALLENGE_ALREADY_HANDED_OFF", "本轮缺口已经交回原委托", 409);
        const text = frozen.kind === "REHEARSAL"
          ? "交付彩排，第 " + frozen.revision + " 版的用户核查意见：\n" + session.answers.map((answer, index) => frozen.questions[index].title + "\n" + answer.text).join("\n\n")
          : "证据侦探，第 " + frozen.revision + " 版核查请求：请核对以下段落的引用与表述是否得到来源支持，保留未知条件。\n" + frozen.questions[0].excerpt;
        const saved = await addMissionMaterialInTx(tx, userId, missionId, { requestId: "challenge-" + id, text, kind: "FEEDBACK" });
        await tx.capture.update({ where: { id: saved.sourceId.slice(8) }, data: { sourceType: "CHALLENGE_FEEDBACK" } });
        await event(tx, missionId, "CHALLENGE_HANDED_OFF", { ...base, sourceId: saved.sourceId, outputId: frozen.outputId }, command);
      }
    }
    return { session: (await sessionState(tx, m, id)).session, replayed: false };
  });
}
