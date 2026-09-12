import {
  PROJECT_STATE_BRIEF_TEMPLATE_VERSION,
  type ChangeBriefSentence,
  type ProjectChangeBrief,
  type ProjectStateDiff,
  type StateDiffItem,
} from "@/lib/types/projectState";

/**
 * C1 变化简报：以两个快照的 Diff 为唯一事实输入的确定性模板。
 * 每句保留 changeKey 与证据数量；可选 LLM 只能在此基础上润色（V1 未启用）。
 * 读简报不会创建任何行动或修改状态。
 */

function templatesFor(item: StateDiffItem): { impact: string; suggestion: string } {
  if (item.changeKey.startsWith("decision:")) {
    if (item.kind === "CHANGED") {
      return {
        impact: "后续任务与证据应以新决策为准，旧决策不再支撑当前结论。",
        suggestion: "检查基于原决策的待办与成果是否需要调整。",
      };
    }
    if (item.kind === "ADDED") {
      return {
        impact: "新增结论进入当前状态。",
        suggestion: "确认相关任务是否需要跟随调整。",
      };
    }
    if (item.kind === "RESOLVED") {
      return {
        impact: "该决策恢复为当前有效。",
        suggestion: "核对相关任务的前提是否重新成立。",
      };
    }
    return {
      impact: "该决策当前证据不足，状态不确定。",
      suggestion: "补充确认后系统会重新评估。",
    };
  }

  if (item.changeKey.startsWith("action:")) {
    if (item.kind === "RESOLVED") {
      return {
        impact: "该行动已有完成回执。",
        suggestion: "无需重复执行。",
      };
    }
    if (item.kind === "REGRESSED") {
      return {
        impact: "该行动退回待办。",
        suggestion: "重新安排执行计划。",
      };
    }
    if (item.kind === "ADDED") {
      return {
        impact: "新行动进入清单。",
        suggestion: "按优先级安排时间。",
      };
    }
    return {
      impact: "该行动记录发生变化。",
      suggestion: "确认是否需要替代行动。",
    };
  }

  if (item.changeKey.startsWith("risk:")) {
    if (item.kind === "REGRESSED") {
      return {
        impact: "项目状态受该风险影响。",
        suggestion: "优先处理该风险或补充规避记录。",
      };
    }
    return {
      impact: "该风险已解除。",
      suggestion: "无需额外处理。",
    };
  }

  if (item.changeKey.startsWith("gap:")) {
    if (item.kind === "RESOLVED") {
      return {
        impact: "交付物证据链已补齐。",
        suggestion: "无需额外处理。",
      };
    }
    return {
      impact: "交付物证据链不完整。",
      suggestion: "补充对应类型的证据并人工确认。",
    };
  }

  // unknown:
  return {
    impact: "系统对这一项保持未知，不猜测结论。",
    suggestion: "补充对应信息后，系统会重新评估。",
  };
}

export function buildChangeBrief(diff: ProjectStateDiff, options: { generatedAt?: Date } = {}): ProjectChangeBrief {
  const sentences: ChangeBriefSentence[] = diff.items.map((item) => {
    const { impact, suggestion } = templatesFor(item);
    return {
      changeKey: item.changeKey,
      kind: item.kind,
      text: item.summary,
      impact,
      suggestion,
      evidenceCount: item.evidenceRefs.length,
      evidence: item.evidenceRefs.map((ref) => ({ entityKind: ref.entityKind, entityId: ref.entityId })),
    };
  });

  const headline = diff.materialChange
    ? `自上次查看以来有 ${sentences.length} 项变化：${diff.summary}`
    : "没有可确认的重要变化。";

  return {
    fromSnapshotId: diff.fromSnapshotId,
    toSnapshotId: diff.toSnapshotId,
    templateVersion: PROJECT_STATE_BRIEF_TEMPLATE_VERSION,
    materialChange: diff.materialChange,
    headline,
    sentences,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
  };
}

/** 首次查看（尚无对比基线）的简报文案 */
export function buildFirstTimeBrief(toSnapshotId: string, options: { generatedAt?: Date } = {}): ProjectChangeBrief {
  return {
    fromSnapshotId: "",
    toSnapshotId,
    templateVersion: PROJECT_STATE_BRIEF_TEMPLATE_VERSION,
    materialChange: false,
    headline: "这是第一份状态记录，暂无对比基线；后续变化都会与它比较。",
    sentences: [],
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
  };
}
