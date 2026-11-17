/**
 * Fault-injection child worker for reliability tests. Runs the real Runner against a given isolated DB
 * and exits at a controlled point, so a different process can observe crash recovery.
 *
 * Not a product entry point: no provider selection from the product API, fixture transport only.
 */
import { randomUUID } from "node:crypto";

const arg = (name: string) => {
  const prefix = "--" + name + "=";
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : "";
};
const mode = arg("mode"), missionId = arg("mission"), projectId = arg("project"), captureId = arg("capture");
Object.assign(process.env, {
  LLM_MODE: "mock", MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  MISSION_WORKBENCH_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true",
});

const { db } = await import("../lib/db");
const { runMissionSlice } = await import("../lib/mission/runner");
const { readProjectMaterial } = await import("../lib/mission/sourceSignals");
const { textHash } = await import("../lib/research/sourceRepository");
const { projectTools } = await import("../lib/mission/tools");

function emit(value: unknown) { console.log("RESULT:" + JSON.stringify(value)); }
async function state() {
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  const outputs = await db.agentMissionOutput.findMany({ where: { missionId }, orderBy: { revision: "asc" }, select: { id: true, revision: true, sourceRefsJson: true } });
  const plan = mission.planJson as { skillArtifacts?: Array<{ id: string; skillId: string; blocks: unknown[] }>; checkpoint?: { outputId?: string; cycleSeq?: number }; delegation?: { wakeSeq?: number; contentHash?: string; inputHash?: string } };
  return { status: mission.status, pauseReason: mission.pauseReason, version: mission.version, contextVersion: mission.contextVersion,
    planRevision: mission.planRevision, budgetUsed: mission.budgetUsedJson, lastError: mission.lastErrorJson,
    outputs: outputs.map(output => ({ id: output.id, revision: output.revision, refs: (output.sourceRefsJson as Array<{ id: string }>).map(ref => ref.id) })),
    checkpoint: plan.checkpoint ?? null, delegation: plan.delegation ?? null,
    skillArtifacts: (plan.skillArtifacts ?? []).map(artifact => ({ id: artifact.id, skillId: artifact.skillId, blocks: artifact.blocks.length })),
    events: (await db.agentMissionEvent.findMany({ where: { missionId }, orderBy: { seq: "asc" }, select: { type: true } })).map(event => event.type) };
}
async function pointer() {
  const source = await readProjectMaterial(projectId, "capture:" + captureId);
  if (!source) throw new Error("SOURCE_MISSING");
  return { sourceId: source.id, sourceHash: source.hash };
}
function blocksFrom(pack: Array<{ id: string; text: string }>) {
  const blocks: Array<Record<string, unknown>> = pack.slice(-3).map((source, index) => {
    const text = source.text.slice(0, 700);
    return { blockId: "child-source-" + index, kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + text, sourceIds: [source.id],
      citations: [{ sourceId: source.id, start: 0, end: text.length, excerptHash: textHash(text) }] };
  });
  blocks.push({ blockId: "child-note", kind: "INFERENCE", text: "本轮聚焦当前目标；未知条件按未知保留。", sourceIds: [] });
  return blocks;
}
function provider() {
  return async (raw: string) => {
    const context = JSON.parse(raw) as { goal?: string; planRevision?: number; continuity?: { workingObjective?: string | null };
      observations?: Array<{ tool?: string; status?: string; planRevision?: number }>;
      skillExecution: { stage: string; stageIndex: number; sequence: string[]; outputId?: string; evidencePack?: { sources: Array<{ id: string; text: string }> } } };
    const skill = context.skillExecution;
    const readThisCycle = (context.observations ?? []).some(item => item.tool === "read_project_material" && item.status === "SUCCEEDED" && item.planRevision === context.planRevision);
    if (skill.outputId) return { choice: { kind: "await_event" as const, outputId: skill.outputId, reason: "DELIVERABLE_READY" as const, subscriptionIds: ["project-materials"] },
      provider: "INJECTED_RELIABILITY", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 5, outputTokens: 5 } };
    if (skill.stage !== "deliverable-creation" && !readThisCycle) {
      const resolved = await pointer();
      return { choice: { kind: "tool" as const, tool: "read_project_material", args: resolved, summary: "读取本轮资料" },
        provider: "INJECTED_RELIABILITY", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 5, outputTokens: 5 } };
    }
    const terminal = skill.stage !== "deliverable-creation" && skill.stageIndex === skill.sequence.length - 1;
    return { choice: { kind: "tool" as const, tool: "save_mission_output", summary: terminal ? "交付阶段成果" : "保存私有稿",
      args: { blocks: blocksFrom(skill.evidencePack?.sources ?? []), missingInformation: ["未知条件按未知保留"] } },
      provider: "INJECTED_RELIABILITY", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 5, outputTokens: 5 } };
  };
}
async function runSlices(max: number) {
  for (let index = 0; index < max; index++) {
    // Do not pre-filter on READY: claimMission is the component that recovers an expired RUNNING lease.
    const claimed = await runMissionSlice({ id: missionId, provider: provider(), workerId: "fault-" + randomUUID() });
    if (!claimed) return false;
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    if (after.status !== "READY") return true;
  }
  return true;
}
try {
  let result: Record<string, unknown>;
  switch (mode) {
    case "read-crash": {
      if (!await runSlices(1)) throw new Error("NOT_CLAIMED");
      result = { mode, ...(await state()) };
      break;
    }
    case "save-crash": {
      if (!await runSlices(1)) throw new Error("READ_NOT_CLAIMED");
      const brokenTools = { ...projectTools, save_mission_output: { ...projectTools.save_mission_output,
        run: async () => { emit({ mode, crash: "BEFORE_OUTPUT_COMMIT" }); process.exit(137); } } };
      const row = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
      await runMissionSlice({ id: missionId, provider: provider(), tools: brokenTools, workerId: "fault-" + randomUUID() });
      result = { mode, note: "tool did not crash unexpectedly", status: row.status };
      break;
    }
    case "checkpoint": {
      await runSlices(8);
      result = { mode, ...(await state()) };
      break;
    }
    case "resume": {
      await runSlices(8);
      result = { mode, ...(await state()) };
      break;
    }
    case "work": {
      const claimed = await runMissionSlice({ id: missionId, provider: provider(), workerId: "fault-" + randomUUID() });
      result = { mode, claimed, ...(await state()) };
      break;
    }
    case "state": {
      result = { mode, ...(await state()) };
      break;
    }
    default: throw new Error("UNKNOWN_MODE:" + mode);
  }
  emit(result);
  await db.$disconnect();
  process.exit(0);
} catch (error) {
  emit({ mode, error: error instanceof Error ? error.message : String(error) });
  await db.$disconnect();
  process.exit(2);
}
