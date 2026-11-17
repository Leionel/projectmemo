import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { record } from "@/lib/conversation/repository";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { agentPresentationSchema } from "@/lib/types/agentExperience";
import { BUILTIN_SKILLS } from "@/lib/skills/registry";
import { readSkillArtifacts } from "@/lib/skills/artifacts";
import type { WorkbenchOutput, WorkbenchSnapshot, WorkbenchSource, WorkbenchStageArtifact } from "@/lib/types/workbench";
import type { Source } from "./contracts";
import { ownedMission, validateSources } from "./repository";
import { missionWorkState } from "./workState";

/** Authenticated, bounded, read-only view. Historical material is checked against current source-use permission. */
export async function readMissionWorkbench(userId: string, id: string): Promise<WorkbenchSnapshot> {
  if (!isFeatureEnabled("MISSION_WORKBENCH_ENABLED", false)) throw new AppError("WORKBENCH_DISABLED", "成果工作台试验未开启", 404);
  return db.$transaction(async tx => {
    const m = await ownedMission(userId, id, tx);
    const [project, rows, events, run, continuity, approvals, unknownSteps] = await Promise.all([
      tx.project.findUniqueOrThrow({ where: { id: m.projectId }, select: { title: true } }),
      tx.agentMissionOutput.findMany({ where: { missionId: id }, orderBy: { revision: "desc" }, take: 5 }),
      tx.agentMissionEvent.findMany({ where: { missionId: id }, orderBy: { seq: "desc" }, take: 24 }),
      tx.agentRun.findFirst({ where: { projectId: m.projectId, trace: { path: "$.missionId", equals: id } }, orderBy: { createdAt: "desc" }, select: { provider: true } }),
      effectiveContinuity(userId, { projectId: m.projectId, missionId: id }, tx),
      tx.agentMissionApproval.findMany({ where: { missionId: id, status: "PENDING" } }),
      tx.agentMissionStep.count({ where: { missionId: id, status: "UNKNOWN" } }),
    ]);
    const sources: WorkbenchSource[] = [], outputs: WorkbenchOutput[] = [], stageArtifacts: WorkbenchStageArtifact[] = [];
    /** Resolve real source refs against the current owner/source-use policy; returns the visible ids. */
    const visibleRefs = async (refs: Source[]): Promise<Set<string>> => {
      const allowed = new Set<string>();
      for (const source of refs) {
        if (!source?.id || !source?.hash) continue;
        if ((await sourceUse(userId, m.projectId, source.id, tx, { missionId: id })).state !== "ALLOWED") continue;
        allowed.add(source.id);
        const key = source.id + "@" + source.hash;
        if (sources.some(item => item.key === key)) continue;
        let current = true;
        try { await validateSources(m.projectId, [source], tx, id); } catch { current = false; }
        sources.push({ key, id: source.id, revision: source.revision, hash: source.hash, text: source.text.slice(0, 4000), current, kind: source.kind });
      }
      return allowed;
    };
    const withSuppressedText = <T extends { blockId: string; text: string; kind: string; sourceIds: string[] }>(blocks: T[], refs: Source[], allowed: Set<string>) =>
      blocks.map(block => {
        const visible = refs.every(source => allowed.has(source.id)) && block.sourceIds.every(sourceId => allowed.has(sourceId));
        return { blockId: block.blockId, text: visible ? block.text : "相关来源的使用许可已变化，请重新核对。",
          kind: block.kind, sourceIds: visible ? block.sourceIds : [] };
      });
    const presentationOf = (blocks: Array<{ blockId: string; text: string }>) => agentPresentationSchema.parse({ schemaVersion: 1, allowedActions: [], blocks: blocks.map(block => ({
      blockKey: block.blockId, semanticType: "prose", emphasis: "supporting", refs: [], actionBindingIds: [],
      fallbackText: block.text, content: [{ type: "paragraph", spans: [{ kind: "text", text: block.text }] }],
    })) });
    // Stage artifacts from non-creation Skills are separate from report revisions.
    for (const artifact of readSkillArtifacts(m.planJson)) {
      const allowed = await visibleRefs(artifact.sources);
      const blocks = withSuppressedText(artifact.blocks, artifact.sources, allowed);
      stageArtifacts.push({ id: artifact.id, skillId: artifact.skillId, label: BUILTIN_SKILLS[artifact.skillId]?.label ?? artifact.skillId,
        createdAt: artifact.createdAt, blocks, sourceKeys: artifact.sources.filter(source => allowed.has(source.id)).map(source => source.id + "@" + source.hash),
        presentation: presentationOf(blocks), checks: artifact.checks, unknowns: artifact.unknowns });
    }
    for (const row of rows) {
      const refs = row.sourceRefsJson as unknown as Source[];
      const allowed = await visibleRefs(refs);
      const content = record(row.contentJson), raw = Array.isArray(content.blocks) ? content.blocks.map(record) : [];
      const blocks = raw.map(b => {
        const ids = Array.isArray(b.sourceIds) ? b.sourceIds.filter((v): v is string => typeof v === "string") : [];
        const visible = refs.every(source => allowed.has(source.id)) && ids.every(sourceId => allowed.has(sourceId));
        return { blockId: String(b.blockId), text: visible ? String(b.text) : "相关来源的使用许可已变化，请重新核对。",
          kind: String(b.kind), sourceIds: visible ? ids : [] };
      });
      outputs.push({ id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(),
        sourceKeys: refs.filter(s => allowed.has(s.id)).map(s => s.id + "@" + s.hash), blocks, presentation: presentationOf(blocks) });
    }
    const state = missionWorkState({ ...m, delegationEnabled: isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED", false),
      events, approvals, unknownSteps });
    const labels: Record<string, string> = { SKILL_ENTERED: "开始读取项目资料", SKILL_HANDOFF: "证据包已交给创作",
      SKILL_OUTPUT_READY: "创作产物已保存", OUTPUT_SAVED: "私有稿已更新", CHECKPOINT_REACHED: "成果备好，继续留意变化",
      SKILL_ARTIFACT_SAVED: "阶段成果已保存", SKILL_DELIVERABLE_READY: "阶段成果已备好，原报告与行动未改动",
      INVESTIGATION_WOKEN: "新资料唤醒原委托", INVESTIGATION_OBSERVATION_CHANGED: "观察到获准变化",
      CLAIMED: "后台取得本轮执行权", TOOL_STARTED: "正在执行获准步骤", TOOL_FINISHED: "步骤回执已保存",
      PAUSE: "已收到暂停请求", CANCEL: "已收到取消请求", RESPONSIBILITY_REVISED: "工作方向已更新",
      NATURAL_CONTROL_APPLIED: "已按你的指引调整原委托", INVESTIGATION_HELD: "持续跟进需核对条件",
      FAILURE: "当前步骤需核对" };
    const usage = record(m.budgetUsedJson);
    return { id, projectId: m.projectId, projectTitle: project.title, goal: m.goal,
      workingObjective: continuity.workingObjective ?? m.goal, status: m.status, phase: state.phase, reason: state.reasonText, reasonCode: state.reasonCode, version: m.version,
      checkedAt: new Date().toISOString(), provider: run?.provider ?? "尚无模型调用",
      models: Number(usage.models ?? 0), tools: Number(usage.tools ?? 0), outputs, stageArtifacts, sources,
      events: events.filter(e => labels[e.type]).map(e => ({ id: e.id, label: labels[e.type], at: e.createdAt.toISOString() })) };
  });
}
