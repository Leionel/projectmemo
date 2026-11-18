import { AppError } from "@/lib/api";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import { blockSources, workbenchChangeLabels, workbenchChanges, workbenchReferenceChanges } from "./workbenchComparison";
import { readMissionWorkbench } from "./workbenchService";

// Plain paragraphs travel well across Markdown viewers even when the original includes HTML or Markdown.
function markdownText(value: string) {
  return value.trim().replace(/[\\`*_[\]<>#|~&]/g, character => "\\" + character)
    .replace(/^(\s*)([-+!]|\d+[.)])(?=\s)/gm, "$1\\$2");
}

export async function readWorkbenchDelivery(userId: string, missionId: string, outputId: string, revision: number, baseline?: number) {
  const snapshot = await readMissionWorkbench(userId, missionId, { revision, baseline });
  const output = snapshot.outputs.find(row => row.id === outputId && row.revision === revision);
  if (!output) throw new AppError("OUTPUT_NOT_FOUND", "所选稿件已不可用，请重新选择版本", 404);
  if (output.sourceAccessChanged) throw new AppError("DELIVERY_SOURCE_CHANGED", "部分原始依据的使用许可已变化，请在工作台重新核对。", 409);
  const sources = snapshot.sources.filter(source => output.sourceKeys.includes(source.key));
  const base = baseline && baseline < revision ? snapshot.outputs.find(row => row.revision === baseline) : undefined;
  const changes = base && !base.sourceAccessChanged ? workbenchChanges(base, output, snapshot.sources) : [];
  const changeSummary = !base ? "本次未选择对照起点。" : base.sourceAccessChanged ? "对照基准的来源许可已变化，未生成差异摘要。" :
    changes.length ? Object.entries(workbenchChangeLabels).flatMap(([kind, label]) => {
      const count = changes.filter(item => item.kind === kind).length;
      return count ? [label + " " + count + " 处"] : [];
    }).join("、") : "两版可读正文与引用一致。";
  const blockLines = output.blocks.map(block => {
    const kinds: Record<string, string> = { PROJECT_OBSERVATION: "项目记录", EXTERNAL_REFERENCE: "外部参考", INFERENCE: "推断或建议" };
    const references = blockSources(output, block, sources).map(source => sources.findIndex(row => row.key === source.key) + 1);
    return "**" + (kinds[block.kind] ?? "稿件内容") + "**\n\n" + markdownText(block.text) +
      (references.length ? "\n\n引用 " + references.map(index => "〔" + index + "〕").join("、") : "");
  });
  const sourceLines = sources.map((source, index) =>
    "- 〔" + (index + 1) + "〕 " + markdownText(sourceDisplayName(source.id, source.name)) + " · " + evidenceTime(source.observedAt) +
    (source.current ? "" : " · 历史引用版本"));
  const references = base && !base.sourceAccessChanged ? workbenchReferenceChanges(base, output, snapshot.sources) : null;
  const referenceLines = references ? [
    ...references.added.map(source => "- 新增引用 · " + markdownText(sourceDisplayName(source.id, source.name)) + " · " + evidenceTime(source.observedAt)),
    ...references.removed.map(source => "- 当前稿移除引用 · " + markdownText(sourceDisplayName(source.id, source.name)) + " · " + evidenceTime(source.observedAt)),
  ] : [];
  const unknowns = output.missingInformation ?? [];
  const markdown = [
    "# " + markdownText(snapshot.goal.replace(/\s+/g, " ")),
    markdownText(snapshot.projectTitle) + " · 第 " + revision + " 版 · " + evidenceTime(output.createdAt) + "\n\n私有工作稿，交付前由你核对。",
    "## 正文\n\n" + blockLines.join("\n\n"),
    "## 修改摘要\n\n" + (base ? "第 " + base.revision + " 版 → 第 " + revision + " 版。 " : "") + changeSummary,
    ...(referenceLines.length ? ["## 引用变化\n\n" + referenceLines.join("\n")] : []),
    "## 待确认项\n\n" + (unknowns.length ? unknowns.map(item => "- " + markdownText(item)).join("\n") : "此版本没有另外登记的待确认项。"),
    "## 引用资料\n\n" + (sourceLines.length ? sourceLines.join("\n") : "此版本没有可读的引用资料。"),
  ].join("\n\n") + "\n";
  return { revision, filename: "忆程成果-第" + revision + "版.md", markdown };
}
