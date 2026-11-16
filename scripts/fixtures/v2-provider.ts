import type { DecisionProvider } from "@/lib/mission/modelAdapter";
import type { RuntimeChoice } from "@/lib/mission/contracts";
import { textHash } from "@/lib/research/sourceRepository";

type SourcePointer = { sourceId: string; sourceHash: string };
/** Deterministic fixture, used only by isolated tests/demo CLI. Never selected by a production flag or API. */
export function fixtureSkillProvider(resolve: () => Promise<SourcePointer | SourcePointer[]>): DecisionProvider {
  // Test-transport bookkeeping only: which planned stage already read its sources in this cycle.
  const readThisCycle = new Set<string>();
  const readCounts = new Map<string, number>();
  return async raw => {
    const context = JSON.parse(raw), skill = context.skillExecution;
    if (!skill) throw new Error("FIXTURE_REQUIRES_V2_SKILL_CONTEXT");
    const cycleKey = (context.contextVersion ?? 0) + ":" + (context.planRevision ?? 0);
    const key = cycleKey + ":" + skill.stage;
    let choice: RuntimeChoice;
    if (skill.outputId && (skill.stage === "deliverable-creation" || readThisCycle.has(key))) {
      choice = { kind: "await_event", outputId: skill.outputId, reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] };
    } else if (skill.stage !== "deliverable-creation") {
      readThisCycle.add(key);
      const pointers = await resolve(), list = Array.isArray(pointers) ? pointers : [pointers];
      const count = readCounts.get(cycleKey) ?? 0;
      const pointer = list[count % list.length];
      readCounts.set(cycleKey, count + 1);
      choice = { kind: "tool", tool: "read_project_material", args: pointer, summary: "读取获准项目原文" };
    } else {
      const packSources: Array<{ id: string; text: string }> = skill.evidencePack?.sources ?? [];
      const reads = (context.observations ?? []).filter((o: { tool: string; status: string; planRevision: number }) =>
        o.tool === "read_project_material" && o.status === "SUCCEEDED" && o.planRevision === context.planRevision);
      const excerpt = reads.at(-1)?.observation.sources[0]?.excerpts[0];
      const packed = packSources.at(-1);
      if (!packed && !excerpt?.text) throw new Error("FIXTURE_EVIDENCE_PACK_MISSING");
      const sourceId = packed?.id ?? excerpt.sourceId;
      const text = (packed?.text ?? excerpt.text ?? "").slice(0, 1100);
      const start = packed ? 0 : excerpt.start;
      const citation = { sourceId, start, end: start + text.length, excerptHash: textHash(text) };
      const unknowns: Array<{ kind: string; column: string }> = skill.evidencePack?.unknowns ?? [];
      choice = { kind: "tool", tool: "save_mission_output", summary: "依据当前记录修订私有稿", args: {
        blocks: [
          { blockId: "current-record", kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + text, sourceIds: [sourceId], citations: [citation] },
          { blockId: "next-step", kind: "INFERENCE", text: "本轮重点：" + (context.continuity?.workingObjective ?? context.goal) + "。尚缺条件按原资料保留为未知，建议核对差异后交付；私有草稿不代表现实工作已经完成。", sourceIds: [] },
        ],
        missingInformation: unknowns.slice(0, 6).map(unknown => (unknown.column || "数值列") + " 没有单位或口径，按未知保留，不推断"),
      } };
    }
    return { choice, provider: "INJECTED_V2_FIXTURE", model: "deterministic-test", protocol: "JSON_CHOICE",
      usage: { inputTokens: 10, outputTokens: 5 } };
  };
}
