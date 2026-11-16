import type { AgentMission } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { json, type ToolResult, type Source } from "@/lib/mission/contracts";
import { db } from "@/lib/db";
import { event, validateSources, type Tx } from "@/lib/mission/repository";
import { fenced, type Lease } from "@/lib/mission/runtimeStore";
import { loadBuiltinSkill } from "./loader";
import { routeSkillSequence, type BuiltinSkillId } from "./registry";
type Cursor = {
  schemaVersion: 1; contextVersion: number; planRevision: number; sequence: BuiltinSkillId[];
  stage: BuiltinSkillId; digests: Record<string, string>;
  evidencePack?: { sources: Source[]; contextVersion: number };
  outputId?: string;
};
function cursor(m: AgentMission): Cursor { return record(m.planJson).skillCursor as Cursor; }
export async function prepareSkillCursor(lease: Lease) {
  return db.$transaction(async tx => {
    const m = await fenced(tx, lease);
    if (m.runtimeProtocolVersion !== 2) return m;
    const sequence = routeSkillSequence(m.goal), digests = Object.fromEntries(sequence.map(id => [id, loadBuiltinSkill(id).contentHash]));
    const old = cursor(m);
    if (old?.contextVersion === m.contextVersion && old.planRevision === m.planRevision) {
      if (Object.entries(old.digests).some(([id, hash]) => digests[id] !== hash))
        throw new AppError("SKILL_VERSION_CHANGED", "内置方法已更新，原接力需人工核对后恢复", 409);
      return m;
    }
    const next: Cursor = { schemaVersion: 1, contextVersion: m.contextVersion, planRevision: m.planRevision,
      sequence, stage: sequence[0], digests };
    await event(tx, m.id, "SKILL_ENTERED", { skillId: next.stage, contentHash: digests[next.stage], contextVersion: m.contextVersion });
    return tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(m.planJson), skillCursor: next }) } });
  });
}
export function skillContext(m: AgentMission) {
  if (m.runtimeProtocolVersion !== 2) return undefined;
  const c = cursor(m);
  if (!c) return undefined;
  const skill = loadBuiltinSkill(c.stage);
  if (c.digests[c.stage] !== skill.contentHash) throw new AppError("SKILL_VERSION_CHANGED", "原接力的方法版本已变化", 409);
  return { ...skill, stage: c.stage, sequence: c.sequence, evidencePack: c.evidencePack, outputId: c.outputId,
    policy: "方法不是权限。工具、来源、送云、预算和副作用仍由原Mission服务校验。" };
}
export async function assertSkillTool(tx: Tx, m: AgentMission, tool: string) {
  if (m.runtimeProtocolVersion !== 2) return;
  const c = cursor(m);
  if (!c || c.contextVersion !== m.contextVersion || c.planRevision !== m.planRevision)
    throw new AppError("SKILL_CURSOR_CHANGED", "接力上下文已变化，请读取当前原委托", 409);
  if (tool === "save_mission_output" || tool.startsWith("propose_")) {
    if (c.stage !== "deliverable-creation" || !c.evidencePack?.sources.length)
      throw new AppError("SKILL_GATE_NOT_MET", "先读取有效项目资料，形成证据包后再创作或提出操作", 409);
    await validateSources(m.projectId, c.evidencePack.sources, tx, m.id);
  }
}
export async function recordSkillResult(tx: Tx, m: AgentMission, tool: string, result: ToolResult) {
  if (m.runtimeProtocolVersion !== 2) return;
  const current = await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), c = cursor(current);
  if (!c) return;
  let next = c;
  if (tool === "save_mission_output") {
    const outputId = record(result.data).outputId;
    if (typeof outputId !== "string") throw new AppError("SKILL_OUTPUT_REQUIRED", "创作缺少真实成果编号", 409);
    next = { ...c, outputId };
    await event(tx, m.id, "SKILL_OUTPUT_READY", { skillId: c.stage, outputId });
  } else if (result.sources.length && c.stage !== "deliverable-creation") {
    await validateSources(m.projectId, result.sources, tx, m.id);
    const sources = result.sources.slice(0, 32).map(source => ({ ...source, text: "" }));
    next = { ...c, stage: "deliverable-creation", evidencePack: { sources, contextVersion: m.contextVersion } };
    await event(tx, m.id, "SKILL_HANDOFF", { from: c.stage, to: next.stage, sourceRefs: sources.map(s => ({ id: s.id, hash: s.hash })),
      fromDigest: c.digests[c.stage], toDigest: c.digests[next.stage] });
  }
  await tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(current.planJson), skillCursor: next }) } });
}
