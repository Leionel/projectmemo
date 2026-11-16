import type { JourneyRecord } from "./journey";

export type JourneyCheck = { name: string; passed: boolean; judge: "DETERMINISTIC" | "UNPROVEN"; detail: string; evidenceRef: string };

const text = (version: { blockTexts: string[] } | undefined) => version?.blockTexts.join("\n") ?? "";
const refs = (version: { sourceRefs: Array<{ id: string }> } | undefined) => new Set((version?.sourceRefs ?? []).map(ref => ref.id));
const budget = (value: unknown) => value as { models?: number; tools?: number; inputTokens?: number; outputTokens?: number } | null;

function check(name: string, passed: boolean, detail: string, evidenceRef: string): JourneyCheck {
  return { name, passed, judge: "DETERMINISTIC", detail, evidenceRef };
}

/** Protocol/persistence truth: same Mission, real checkpoints, monotonic budget, controls applied before dispatch. */
export function protocolChecks(run: JourneyRecord): JourneyCheck[] {
  const checks: JourneyCheck[] = [];
  const versions = run.versions;
  const models = run.phases.map(phase => Number(budget(phase.budgetUsed)?.models ?? 0));
  const tools = run.phases.map(phase => Number(budget(phase.budgetUsed)?.tools ?? 0));
  checks.push(check("SAME_MISSION_CONTINUATION", run.wake.sameMission && run.wake.woken >= 1 && run.wake.inputChanged,
    "新资料由既有扫描器唤醒同一 Mission（woken=" + run.wake.woken + "）", "mission:" + run.missionId + ":wake"));
  const checkpointed = versions.filter(version => version.checkpointSeq !== null);
  checks.push(check("VERSION_CHAIN_WITH_CHECKPOINTS", versions.length >= 3 && checkpointed.length >= 1 && versions.at(-1)!.revision >= 3
    && new Set(versions.map(version => version.revision)).size === versions.length,
    "版本 " + versions.map(version => version.revision).join(",") + "；checkpoint " + checkpointed.map(version => version.revision).join(","), "mission:" + run.missionId + ":versions"));
  checks.push(check("EVIDENCE_AND_TOOL_RECEIPTS", run.events.includes("SKILL_ENTERED") && run.events.includes("SKILL_HANDOFF")
    && run.tools.some(tool => tool.tool === "read_project_material") && run.tools.some(tool => tool.tool === "save_mission_output"),
    "Skill 进入/交接与读取/创作步骤均有持久回执", "mission:" + run.missionId + ":steps:" + run.tools.length));
  checks.push(check("BUDGET_MONOTONIC_NO_RESET", models.every((value, index) => index === 0 || value >= models[index - 1])
    && tools.every((value, index) => index === 0 || value >= tools[index - 1]) && models.at(-1)! > 0,
    "模型/工具累计用量不重置：" + models.join("→") + " / " + tools.join("→"), "mission:" + run.missionId + ":budget"));
  checks.push(check("RESTRICTION_BEFORE_DISPATCH", !!run.control.restriction?.externalReadBlocked && !!run.control.restriction?.outputsUnchanged
    && (run.control.restriction?.directiveIds.length ?? 0) > 0 && (run.control.restriction?.constraints ?? []).some(constraint => /不(?:要)?联网/.test(constraint)),
    "限制先落库并禁止外部读取，之后没有新增稿（ids=" + (run.control.restriction?.directiveIds ?? []).length + "，blocked=" + run.control.restriction?.externalReadBlocked + "，unchanged=" + run.control.restriction?.outputsUnchanged + "）", "directive:" + (run.control.restriction?.directiveIds[0] ?? "none")));
  checks.push(check("REDIRECT_SAME_MISSION", (run.control.redirect?.directiveIds.length ?? 0) > 0 && (run.control.redirect?.outputCountAfter ?? 0) >= 3,
    "有限目标改道后同一 Mission 产出第 3 版", "directive:" + (run.control.redirect?.directiveIds[0] ?? "none")));
  checks.push(check("ENDING_STOPS_DISPATCH", !!run.control.ending && !run.control.ending.extraDispatch
    && run.control.ending.status === (run.definition.ending === "pause" ? "PAUSED" : "CANCELLED"),
    "暂停/取消后不再派发（" + run.control.ending?.action + " → " + run.control.ending?.status + "）", "mission:" + run.missionId + ":ending"));
  checks.push(check("NO_LEGACY_FINISH", !run.events.includes("CRITERIA_CHECKED") && run.phases.at(-1)?.missionStatus !== "SUCCEEDED",
    "持续委托没有用旧 finish 结束", "mission:" + run.missionId + ":events"));
  checks.push(check("TOOL_BOUNDARY_PRIVATE_ONLY", run.tools.every(tool => ["read_project_material", "save_mission_output", "inspect_project"].includes(tool.tool)),
    "工具只使用项目读取与私有稿：" + [...new Set(run.tools.map(tool => tool.tool))].join(","), "mission:" + run.missionId + ":steps"));
  checks.push(check("PROVIDER_RECORDED", run.modelRuns.length > 0 && run.modelRuns.every(run => !!run.provider),
    "模型 provider 与用量留痕：" + [...new Set(run.modelRuns.map(run => run.provider))].join(","), "mission:" + run.missionId + ":runs"));
  return checks;
}

/**
 * Content-quality checks. In offline injected mode they prove the pipeline propagates material,
 * evidence and controls into persisted drafts; they are not evidence of real-model writing quality.
 */
export function contentChecks(run: JourneyRecord): JourneyCheck[] {
  const checks: JourneyCheck[] = [];
  const [first, second, third] = run.versions;
  const firstId = run.versionIds[0], secondId = run.versionIds[1];
  const secondRefs = refs(second), allText = run.versions.map(version => text(version)).join("\n");
  checks.push(check("NEW_MATERIAL_CHANGED_DRAFT", !!second && !!first && second.textHash !== first.textHash
    && secondRefs.has(secondId) && (second.blockTexts.join("\n") !== first.blockTexts.join("\n")),
    "新增材料进入第 2 版且正文变化（hash=" + (first?.textHash.slice(0, 8) ?? "-") + "→" + (second?.textHash.slice(0, 8) ?? "-") + "；refs=" + [...secondRefs].join(",") + "）", "mission:" + run.missionId + ":output:" + (second?.outputId ?? "none")));
  checks.push(check("OLD_EVIDENCE_RETAINED", !!second && (secondRefs.has(firstId) || secondRefs.size > 1),
    "第 2 版仍保留旧依据：" + [...secondRefs].join(","), "mission:" + run.missionId + ":output:" + (second?.outputId ?? "none")));
  const unknownKept = run.versions.some(version => /未知|未(?:独立)?(?:复现|确认|验证|写明)|仍缺|尚未/.test(text(version)));
  const invented = /(?:已|已经)(?:独立复现|验证通过|部署成功|上线成功|通过验收|测量完成)/.test(allText);
  checks.push(check("UNKNOWN_NOT_WRITTEN_AS_FACT", unknownKept && !invented,
    unknownKept ? "未知条件按未知保留，没有写成已验证事实" : "没有保留未知条件", "mission:" + run.missionId + ":outputs"));
  const focusTerms = run.definition.redirectQuote.replace(/今天|本周|这周|先|核对|对应|中的|的|资料|第二版/g, " ").split(/[\s，。]+/).filter(term => term.length >= 2);
  const thirdText = text(third);
  const focusHits = focusTerms.filter(term => thirdText.includes(term));
  const redirectApplied = !!third && (focusHits.length > 0 || thirdText.includes("工作重点"));
  checks.push(check("USER_REDIRECT_APPLIED", redirectApplied,
    "第 3 版是否体现改道重点（命中=" + focusHits.join("|") + "，需至少一项）", "mission:" + run.missionId + ":output:" + (third?.outputId ?? "none")));
  const hashes = run.versions.map(version => version.textHash);
  const consecutiveDistinct = hashes.every((hash, index) => index === 0 || hash !== hashes[index - 1]);
  checks.push(check("NO_MEANINGLESS_REPETITION", consecutiveDistinct && run.tools.filter(tool => tool.tool === "save_mission_output").length >= run.versions.length,
    "相邻版本正文不重复，且每版都有创作保存（版本 " + hashes.length + "，保存 " + run.tools.filter(tool => tool.tool === "save_mission_output").length + "）", "mission:" + run.missionId + ":versions"));
  const citationsResolve = run.versions.every(version => {
    const output = version as unknown as { cited?: string[] };
    return !output.cited || output.cited.every(id => version.sourceRefs.some(ref => ref.id === id));
  });
  checks.push(check("CITATIONS_RESOLVE", citationsResolve && run.versions.every(version => version.sourceRefs.length > 0),
    "每版引用均落在该版来源清单内", "mission:" + run.missionId + ":outputs"));
  return checks;
}
