import type { JourneyRecord } from "./journey";
import { assessRevision, semanticReviewChecks, type DraftView, type QualityCheck } from "./contentQuality";

export type JourneyCheck = { name: string; passed: boolean; judge: "DETERMINISTIC" | "UNPROVEN"; detail: string; evidenceRef: string };

const text = (version: { blockTexts: string[] } | undefined) => version?.blockTexts.join("\n") ?? "";
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
 * Content-quality checks are deterministic structural checks over persisted drafts.
 * They reject copies of the user request, title-only changes, unrelated citations, trivial edits
 * and dropped unknowns. Semantic truth is intentionally left UNVERIFIED (see semanticChecks).
 */
export function contentChecks(run: JourneyRecord): JourneyCheck[] {
  const checks: JourneyCheck[] = [];
  const [first, second, third] = run.versions;
  const sources = [...new Map(Object.entries(run.sourceTexts ?? {}).map(([id, text]) => [id, { id, text }])).values()];
  const toDraft = (version: typeof run.versions[number]): DraftView => ({
    text: version.blockTexts.join("\n"), blocks: version.blocks, sourceIds: version.sourceRefs.map(ref => ref.id), missingInformation: [],
  });
  const quality = (input: Omit<Parameters<typeof assessRevision>[0], "sources">) => assessRevision({ ...input, sources });
  const failed = (items: QualityCheck[], names: string[]) => {
    const set = new Map(items.map(item => [item.name, item.status]));
    return names.filter(name => set.get(name) !== "PASS");
  };
  const first2 = first && second ? quality({ previous: toDraft(first), current: toDraft(second), userRequest: run.definition.newMaterialCondition,
    requiredUnknowns: [run.definition.newMaterialCondition] }) : [];
  const first2Status = new Map(first2.map(item => [item.name, item.status]));
  const materialEffective = first2Status.get("EFFECTIVE_REVISION") === "PASS" || first2Status.get("NEW_EVIDENCE_ADDED") === "PASS";
  const materialFailed = [...(materialEffective ? [] : ["EFFECTIVE_REVISION_OR_NEW_EVIDENCE"]), ...failed(first2, ["EVIDENCE_BOUND"])];
  checks.push(check("NEW_MATERIAL_CHANGED_DRAFT", !!second && materialFailed.length === 0,
    "新增材料形成有效修订" + (materialFailed.length ? "；未通过：" + materialFailed.join(",") : "") + "（hash=" + (first?.textHash.slice(0, 8) ?? "-") + "→" + (second?.textHash.slice(0, 8) ?? "-") + "）",
    "mission:" + run.missionId + ":output:" + (second?.outputId ?? "none")));
  const oldFailed = failed(first2, ["OLD_EVIDENCE_RETAINED"]);
  checks.push(check("OLD_EVIDENCE_RETAINED", !!second && oldFailed.length === 0,
    "第 2 版保留旧依据" + (oldFailed.length ? "；未通过：" + oldFailed.join(",") : "") + "（refs=" + (second?.sourceRefs.map(ref => ref.id).join(",") ?? "") + "）",
    "mission:" + run.missionId + ":output:" + (second?.outputId ?? "none")));
  const allText = run.versions.map(version => text(version)).join("\n");
  const invented = /(?:已|已经)(?:独立复现|验证通过|部署成功|上线成功|通过验收|测量完成)/.test(allText);
  const unknownDropped = failed(first2, ["UNKNOWN_PRESERVED"]);
  checks.push(check("UNKNOWN_NOT_WRITTEN_AS_FACT", !!second && unknownDropped.length === 0 && !invented,
    invented ? "把未验证结果写成已验证事实" : unknownDropped.length ? "遗漏关键未知：" + run.definition.newMaterialCondition : "未知条件按未知保留",
    "mission:" + run.missionId + ":outputs"));
  const second3 = second && third ? quality({ previous: toDraft(second), current: toDraft(third), redirectQuote: run.definition.redirectQuote,
    userRequest: run.definition.redirectQuote, requiredUnknowns: [run.definition.newMaterialCondition] }) : [];
  const redirectFailed = failed(second3, ["REDIRECT_ADDRESSED", "EVIDENCE_BOUND", "NOT_COPY_OF_USER_REQUEST"]);
  checks.push(check("USER_REDIRECT_APPLIED", !!third && redirectFailed.length === 0,
    "第 3 版实质落实改道" + (redirectFailed.length ? "；未通过：" + redirectFailed.join(",") : "") + "（命中句/来源均校验）",
    "mission:" + run.missionId + ":output:" + (third?.outputId ?? "none")));
  const hashes = run.versions.map(version => version.textHash);
  const consecutiveDistinct = hashes.every((hash, index) => index === 0 || hash !== hashes[index - 1]);
  checks.push(check("NO_MEANINGLESS_REPETITION", consecutiveDistinct && run.tools.filter(tool => tool.tool === "save_mission_output").length >= run.versions.length,
    "相邻版本正文不重复，且每版都有创作保存（版本 " + hashes.length + "，保存 " + run.tools.filter(tool => tool.tool === "save_mission_output").length + "）",
    "mission:" + run.missionId + ":versions"));
  const citationFailed = run.versions.some(version => failed(quality({ previous: null, current: toDraft(version) }), ["CITATIONS_RESOLVE", "CITATIONS_RELEVANT"]).length > 0);
  checks.push(check("CITATIONS_RESOLVE", !citationFailed && run.versions.every(version => version.sourceRefs.length > 0),
    citationFailed ? "存在无法解析或与正文无关的引用" : "每版引用均可解析且与所引段落相关", "mission:" + run.missionId + ":outputs"));
  return checks;
}

/** Semantic judgement is reported separately and never as a pass while only offline fixtures run. */
export function semanticChecks(run: JourneyRecord): JourneyCheck[] {
  void run;
  return semanticReviewChecks().map(item => ({ name: item.name, passed: false, judge: "UNPROVEN" as const, detail: item.detail, evidenceRef: "" }));
}

export function deterministicContentPassed(checks: JourneyCheck[]): boolean {
  return checks.every(check => check.passed);
}
