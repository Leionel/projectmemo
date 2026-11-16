import type { DecisionProvider } from "@/lib/mission/modelAdapter";
import type { RuntimeChoice } from "@/lib/mission/contracts";
/** Deterministic fixture, used only by isolated tests/demo CLI. Never selected by a production flag or API. */
export function fixtureSkillProvider(resolve: () => Promise<{ sourceId: string; sourceHash: string }>): DecisionProvider {
  return async raw => {
    const context = JSON.parse(raw), skill = context.skillExecution;
    if (!skill) throw new Error("FIXTURE_REQUIRES_V2_SKILL_CONTEXT");
    let choice: RuntimeChoice;
    if (skill.outputId) {
      choice = { kind: "await_event", outputId: skill.outputId, reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] };
    } else if (skill.stage !== "deliverable-creation") {
      choice = { kind: "tool", tool: "read_project_material", args: await resolve(), summary: "读取获准项目原文" };
    } else {
      const reads = context.observations.filter((o: { tool: string; status: string; planRevision: number }) =>
        o.tool === "read_project_material" && o.status === "SUCCEEDED" && o.planRevision === context.planRevision);
      const source = reads.at(-1)?.observation.sources[0], excerpt = source?.excerpts[0];
      if (!excerpt?.text) throw new Error("FIXTURE_EVIDENCE_PACK_MISSING");
      choice = { kind: "tool", tool: "save_mission_output", summary: "依据当前记录修订私有稿", args: { blocks: [
        { blockId: "current-record", kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + excerpt.text.slice(0, 1100),
          sourceIds: [source.id], citations: [{ sourceId: source.id, start: excerpt.start, end: excerpt.end, excerptHash: excerpt.excerptHash }] },
        { blockId: "next-step", kind: "INFERENCE", text: "本轮重点：" + (context.continuity?.workingObjective ?? context.goal) + "。建议核对差异后交付；私有草稿不代表现实工作已经完成。", sourceIds: [] },
      ] } };
    }
    return { choice, provider: "INJECTED_V2_FIXTURE", model: "deterministic-test", protocol: "JSON_CHOICE",
      usage: { inputTokens: 10, outputTokens: 5 } };
  };
}
