import {
  PROJECT_STATE_DIFF_ALGORITHM_VERSION,
  type ProjectStateDiff,
  type ProjectStatePayload,
  type SnapshotFact,
  type StateDiffItem,
} from "@/lib/types/projectState";

/**
 * 按稳定实体键比较两个状态 payload，不按数组位置。
 * 每条变化携带 changeKey 与证据引用；不做任何模型生成。
 */

class RebuildRequiredError extends Error {
  constructor() {
    super("PROJECT_STATE_REBUILD_REQUIRED");
  }
}

export function isRebuildRequiredError(error: unknown): boolean {
  return error instanceof RebuildRequiredError;
}

function kindLabel(kind: StateDiffItem["kind"]): string {
  switch (kind) {
    case "ADDED": return "新增";
    case "RESOLVED": return "已解决";
    case "REGRESSED": return "回退";
    case "UNCERTAIN": return "变得不确定";
    default: return "变化";
  }
}

function diffFacts(before: ProjectStatePayload, after: ProjectStatePayload): StateDiffItem[] {
  const items: StateDiffItem[] = [];
  const beforeMap = new Map(before.facts.map((fact) => [fact.key, fact]));
  const afterMap = new Map(after.facts.map((fact) => [fact.key, fact]));

  for (const [key, prev] of beforeMap) {
    const next = afterMap.get(key);
    if (!next) {
      items.push({
        changeKey: `${key}:recorded`,
        kind: "CHANGED",
        summary: `记录「${prev.text}」不再出现在当前状态中`,
        before: prev.text,
        after: null,
        evidenceRefs: prev.evidenceRefs,
      });
      continue;
    }
    if (prev.truth === next.truth && prev.temporalStatus === next.temporalStatus) continue;
    const changeKey = `${key}:validity`;
    let kind: StateDiffItem["kind"];
    let summary: string;
    if (next.truth === "TRUE" && prev.truth !== "TRUE") {
      kind = "RESOLVED";
      summary = `${next.text}`;
    } else if (next.truth === "FALSE" && prev.truth === "TRUE") {
      kind = "CHANGED";
      summary = `${next.text}`;
    } else if (next.truth === "UNKNOWN") {
      kind = "UNCERTAIN";
      summary = `「${prev.text}」当前证据不足，状态退回未知`;
    } else {
      kind = "CHANGED";
      summary = `${prev.text} → ${next.text}`;
    }
    items.push({
      changeKey,
      kind,
      summary,
      before: prev.text,
      after: next.text,
      evidenceRefs: next.evidenceRefs,
    });
  }

  for (const [key, next] of afterMap) {
    if (!beforeMap.has(key)) {
      // 新出现但已是 FALSE 的事实 = 两个快照之间发生了取代：按 CHANGED 报告，
      // 文案本身携带「已被取代」；否则才是真正的新增记录
      const kind: StateDiffItem["kind"] = next.truth === "FALSE" ? "CHANGED" : "ADDED";
      items.push({
        changeKey: `${key}:validity`,
        kind,
        summary: next.text,
        before: null,
        after: next.text,
        evidenceRefs: next.evidenceRefs,
      });
    }
  }
  return items;
}

function diffActions(before: ProjectStatePayload, after: ProjectStatePayload): StateDiffItem[] {
  const items: StateDiffItem[] = [];
  const beforeMap = new Map(before.actions.map((action) => [action.actionId, action]));
  const afterMap = new Map(after.actions.map((action) => [action.actionId, action]));

  for (const [actionId, prev] of beforeMap) {
    const next = afterMap.get(actionId);
    if (!next) continue; // 行动删除在 V1 中不作为状态变化处理（业务删除有独立审计）
    if (prev.recordedStatus === next.recordedStatus) continue;
    const changeKey = `action:${actionId}:status`;
    let kind: StateDiffItem["kind"];
    let summary: string;
    if (next.recordedStatus === "DONE" && prev.recordedStatus !== "DONE") {
      kind = "RESOLVED";
      summary = `行动「${next.title}」已记录为完成`;
    } else if (prev.recordedStatus === "DONE" && next.recordedStatus === "TODO") {
      kind = "REGRESSED";
      summary = `行动「${next.title}」由完成退回待办`;
    } else if (next.recordedStatus === "CANCELLED") {
      kind = "CHANGED";
      summary = `行动「${next.title}」已取消`;
    } else {
      kind = "CHANGED";
      summary = `行动「${next.title}」状态 ${prev.recordedStatus} → ${next.recordedStatus}`;
    }
    items.push({
      changeKey,
      kind,
      summary,
      before: prev.recordedStatus,
      after: next.recordedStatus,
      evidenceRefs: next.evidenceRefs,
    });
  }

  for (const [actionId, next] of afterMap) {
    if (!beforeMap.has(actionId)) {
      items.push({
        changeKey: `action:${actionId}:recorded`,
        kind: "ADDED",
        summary: `新增行动「${next.title}」（${next.recordedStatus}）`,
        before: null,
        after: next.recordedStatus,
        evidenceRefs: next.evidenceRefs,
      });
    }
  }
  return items;
}

function diffGaps(before: ProjectStatePayload, after: ProjectStatePayload): StateDiffItem[] {
  const items: StateDiffItem[] = [];
  const beforeMap = new Map(before.gaps.map((gap) => [gap.deliverableId, gap]));
  const afterMap = new Map(after.gaps.map((gap) => [gap.deliverableId, gap]));

  for (const [deliverableId, prev] of beforeMap) {
    const next = afterMap.get(deliverableId);
    if (next) {
      const beforeKeys = prev.missingEvidenceTypes.join("|");
      const afterKeys = next.missingEvidenceTypes.join("|");
      if (beforeKeys !== afterKeys) {
        items.push({
          changeKey: `gap:${deliverableId}:evidence`,
          kind: "CHANGED",
          summary: `交付物缺少的证据类型变化：${beforeKeys} → ${afterKeys}`,
          before: beforeKeys,
          after: afterKeys,
          evidenceRefs: next.evidenceRefs,
        });
      }
    } else {
      items.push({
        changeKey: `gap:${deliverableId}:evidence`,
        kind: "RESOLVED",
        summary: `交付物 ${deliverableId} 的缺口已补齐`,
        before: prev.missingEvidenceTypes.join("|"),
        after: null,
        evidenceRefs: prev.evidenceRefs,
      });
    }
  }
  for (const [deliverableId, next] of afterMap) {
    if (!beforeMap.has(deliverableId)) {
      items.push({
        changeKey: `gap:${deliverableId}:evidence`,
        kind: "ADDED",
        summary: `交付物 ${deliverableId} 缺少证据：${next.missingEvidenceTypes.join("|")}`,
        before: null,
        after: next.missingEvidenceTypes.join("|"),
        evidenceRefs: next.evidenceRefs,
      });
    }
  }
  return items;
}

function diffRisks(before: ProjectStatePayload, after: ProjectStatePayload): StateDiffItem[] {
  const items: StateDiffItem[] = [];
  const beforeMap = new Map(before.risks.map((risk) => [risk.stableKey, risk]));
  const afterMap = new Map(after.risks.map((risk) => [risk.stableKey, risk]));

  for (const [stableKey, prev] of beforeMap) {
    const next = afterMap.get(stableKey);
    if (next) {
      if (prev.truth !== next.truth) {
        items.push({
          changeKey: `risk:${stableKey}:truth`,
          kind: next.truth === "TRUE" ? "REGRESSED" : "RESOLVED",
          summary: next.truth === "TRUE" ? `风险成立：${next.text}` : `风险解除：${prev.text}`,
          before: prev.truth,
          after: next.truth,
          evidenceRefs: next.evidenceRefs,
        });
      }
    } else {
      items.push({
        changeKey: `risk:${stableKey}:truth`,
        kind: "RESOLVED",
        summary: `风险解除：${prev.text}`,
        before: prev.truth,
        after: null,
        evidenceRefs: prev.evidenceRefs,
      });
    }
  }
  for (const [stableKey, next] of afterMap) {
    if (!beforeMap.has(stableKey)) {
      items.push({
        changeKey: `risk:${stableKey}:truth`,
        kind: "REGRESSED",
        summary: `风险成立：${next.text}`,
        before: null,
        after: next.truth,
        evidenceRefs: next.evidenceRefs,
      });
    }
  }
  return items;
}

function diffUnknowns(before: ProjectStatePayload, after: ProjectStatePayload): StateDiffItem[] {
  const items: StateDiffItem[] = [];
  const beforeMap = new Map(before.unknowns.map((item) => [item.predicate, item]));
  const afterMap = new Map(after.unknowns.map((item) => [item.predicate, item]));
  for (const [predicate, next] of afterMap) {
    if (!beforeMap.has(predicate)) {
      items.push({
        changeKey: `unknown:${predicate}`,
        kind: "UNCERTAIN",
        summary: `信息缺口：${next.text}`,
        before: null,
        after: next.text,
        evidenceRefs: [],
      });
    }
  }
  for (const predicate of beforeMap.keys()) {
    if (!afterMap.has(predicate)) {
      items.push({
        changeKey: `unknown:${predicate}`,
        kind: "RESOLVED",
        summary: `信息缺口已补充：${predicate}`,
        before: predicate,
        after: null,
        evidenceRefs: [],
      });
    }
  }
  return items;
}

function diffProjectFields(before: ProjectStatePayload, after: ProjectStatePayload): StateDiffItem[] {
  const items: StateDiffItem[] = [];
  if (before.goal !== after.goal) {
    items.push({
      changeKey: "project:goal",
      kind: "CHANGED",
      summary: `项目目标变化：${before.goal ?? "未设置"} → ${after.goal ?? "未设置"}`,
      before: before.goal,
      after: after.goal,
      evidenceRefs: [],
    });
  }
  if (before.deadline !== after.deadline) {
    items.push({
      changeKey: "project:deadline",
      kind: "CHANGED",
      summary: `截止时间变化：${before.deadline?.substring(0, 10) ?? "未设置"} → ${after.deadline?.substring(0, 10) ?? "未设置"}`,
      before: before.deadline,
      after: after.deadline,
      evidenceRefs: [],
    });
  }
  if (before.health !== after.health) {
    items.push({
      changeKey: "state:health",
      kind: after.health === "AT_RISK" ? "REGRESSED" : "RESOLVED",
      summary: `健康状态变化：${before.health} → ${after.health}`,
      before: before.health,
      after: after.health,
      evidenceRefs: [],
    });
  }
  return items;
}

export function computeProjectStateDiff(from: ProjectStatePayload, to: ProjectStatePayload): ProjectStateDiff {
  if (from.schemaVersion !== to.schemaVersion) {
    throw new RebuildRequiredError();
  }

  const items: StateDiffItem[] = [
    ...diffProjectFields(from, to),
    ...diffFacts(from, to),
    ...diffActions(from, to),
    ...diffGaps(from, to),
    ...diffRisks(from, to),
    ...diffUnknowns(from, to),
  ].sort((a, b) => (a.changeKey < b.changeKey ? -1 : a.changeKey > b.changeKey ? 1 : 0));

  const counts = {
    added: items.filter((item) => item.kind === "ADDED").length,
    resolved: items.filter((item) => item.kind === "RESOLVED").length,
    regressed: items.filter((item) => item.kind === "REGRESSED").length,
    uncertain: items.filter((item) => item.kind === "UNCERTAIN").length,
    changed: items.filter((item) => item.kind === "CHANGED").length,
  };

  const materialChange = items.length > 0;
  const summary = materialChange
    ? `共 ${items.length} 项变化：新增 ${counts.added}，解决 ${counts.resolved}，回退 ${counts.regressed}，变得不确定 ${counts.uncertain}，其他变化 ${counts.changed}。`
    : "没有可确认的重要变化。";

  return {
    fromSnapshotId: from.snapshotId,
    toSnapshotId: to.snapshotId,
    algorithmVersion: PROJECT_STATE_DIFF_ALGORITHM_VERSION,
    materialChange,
    summary,
    items,
  };
}
