import { materialLabel } from "./contracts";
import { intactPrefix } from "./textRange";

/**
 * 项目前材料“实际送入模型”的覆盖投影。
 *
 * 这里只做确定性的切分计算：单份上限 INTAKE_MODEL_MATERIAL_LIMIT、总量上限 INTAKE_TOTAL_LIMIT，
 * 按材料顺序分配。预览必须能区分“上一版实际送入的正文”和“现在这批材料下次会送入多少”，
 * 不能把上传总字符数当成模型已读字符数，也不能把旧轮次的覆盖标成当前。
 */

/** 单份送入模型的上限（字符），与粘贴入口的 INTAKE_TEXT_LIMIT 无关。 */
export const INTAKE_MODEL_MATERIAL_LIMIT = 200_000;
/** 一次理解的总输入（字符）：中文最坏约 30 万 token，给 1M 窗口留足余量并控制单次费用。 */
export const INTAKE_TOTAL_LIMIT = 300_000;

export type IntakeCoverageReason = "INCLUDED" | "INCLUDED_TRUNCATED" | "NO_READABLE_TEXT" | "OVER_BUDGET" | "ADDED_AFTER_UNDERSTANDING";

export type IntakeCoverageMaterial = {
  id: string; kind: string; fileName: string | null; ordinal: number; type: string | null;
  rawText: string | null; extractionStatus: string;
};

export type IntakeCoverageItem = {
  materialId: string;
  label: string;
  kind: string;
  type: string | null;
  extractionStatus: string;
  /** 当前可读正文的字符数（不是文件字节数） */
  availableChars: number;
  /** 下一次理解会送入的字符数（计划值） */
  plannedChars: number;
  /** 上一次理解实际送入的字符数；null 表示从未派发过 */
  lastSentChars: number | null;
  /** 上一次送入是否被截取 */
  lastSentTruncated: boolean;
  reason: IntakeCoverageReason;
};

export type IntakeCoverageRoundItem = {
  materialId: string; availableChars: number; sentChars: number; truncated: boolean; reason: IntakeCoverageReason;
};

export type IntakeCoverageRound = {
  computedAt: string;
  requestHash: string | null;
  guidanceEpoch: string | null;
  revision: number;
  materialsHash: string;
  totalAvailableChars: number;
  totalSentChars: number;
  /** 这一轮是否真的产出了可核对的理解；false 表示送过但没有保存理解 */
  understandingPublished: boolean;
  items: IntakeCoverageRoundItem[];
};

export type IntakeCoverage = {
  schemaVersion: 1;
  perMaterialLimit: number;
  totalLimit: number;
  consentGranted: boolean;
  lastSent: null | {
    computedAt: string;
    requestHash: string | null;
    guidanceEpoch: string | null;
    revision: number;
    materialsHash: string;
    understandingPublished: boolean;
    totalAvailableChars: number;
    totalSentChars: number;
  };
  /** 当前材料集合的切分结果；stale 表示理解所依据的材料已经变化 */
  current: {
    materialsHash: string;
    stale: boolean;
    totalAvailableChars: number;
    totalSentChars: number;
    items: IntakeCoverageItem[];
  };
  note: string;
};

export type MaterialSlice = { materialId: string; label: string; type: string; text: string };

/** 单次切分：返回真正会发给模型的正文、逐份字符数与分配原因。 */
export function sliceMaterialsForModel(materials: IntakeCoverageMaterial[]) {
  let used = 0;
  const slices: MaterialSlice[] = [];
  const items: IntakeCoverageRoundItem[] = [];
  for (const material of materials) {
    const text = (material.rawText ?? "").trim();
    const availableChars = text.length;
    if (availableChars === 0) {
      items.push({ materialId: material.id, availableChars: 0, sentChars: 0, truncated: false, reason: "NO_READABLE_TEXT" });
      continue;
    }
    const room = Math.max(0, INTAKE_TOTAL_LIMIT - used);
    if (room <= 0) {
      items.push({ materialId: material.id, availableChars, sentChars: 0, truncated: true, reason: "OVER_BUDGET" });
      continue;
    }
    const take = Math.min(room, INTAKE_MODEL_MATERIAL_LIMIT, availableChars);
    const textSlice = intactPrefix(text, take);
    if (!textSlice) {
      items.push({ materialId: material.id, availableChars, sentChars: 0, truncated: true, reason: "OVER_BUDGET" });
      continue;
    }
    used += textSlice.length;
    slices.push({ materialId: material.id, label: materialLabel({ kind: material.kind, fileName: material.fileName, ordinal: material.ordinal }),
      type: material.type ?? "TEXT", text: textSlice });
    items.push({ materialId: material.id, availableChars, sentChars: textSlice.length, truncated: textSlice.length < availableChars,
      reason: textSlice.length < availableChars ? "INCLUDED_TRUNCATED" : "INCLUDED" });
  }
  return { slices, items, totalAvailableChars: items.reduce((sum, item) => sum + item.availableChars, 0),
    totalSentChars: used };
}

/**
 * 合成预览用的覆盖投影。
 *
 * `round` 是上次派发的事实（持久在 previewJson 中），只描述那一轮送了什么；
 * `current` 是现在这批材料下次会送什么。材料一变就 stale，旧轮次不再冒充当前覆盖。
 */
export function buildIntakeCoverage(input: {
  materials: IntakeCoverageMaterial[];
  materialsHash: string;
  consentGranted: boolean;
  round: IntakeCoverageRound | null;
}): IntakeCoverage {
  const planned = sliceMaterialsForModel(input.materials);
  const plannedById = new Map(planned.items.map(item => [item.materialId, item]));
  const roundItems = new Map((input.round?.items ?? []).map(item => [item.materialId, item]));
  const stale = input.round !== null && input.round.materialsHash !== input.materialsHash;
  const items: IntakeCoverageItem[] = input.materials.map(material => {
    const plannedItem = plannedById.get(material.id);
    const previous = roundItems.get(material.id);
    const lastSentChars = input.round === null ? null : previous ? previous.sentChars : 0;
    const reason: IntakeCoverageReason = input.round !== null && previous === undefined
      ? "ADDED_AFTER_UNDERSTANDING" : plannedItem?.reason ?? "NO_READABLE_TEXT";
    return {
      materialId: material.id,
      label: materialLabel({ kind: material.kind, fileName: material.fileName, ordinal: material.ordinal }),
      kind: material.kind,
      type: material.type,
      extractionStatus: material.extractionStatus,
      availableChars: plannedItem?.availableChars ?? 0,
      plannedChars: plannedItem?.sentChars ?? 0,
      lastSentChars,
      lastSentTruncated: previous ? previous.truncated : false,
      reason,
    };
  });
  const truncatedLastSent = (input.round?.items ?? []).some(item => item.truncated && item.sentChars > 0);
  const note = !input.consentGranted && input.round !== null
    ? "已撤回云处理同意；上一轮的送入事实保留，但不会再次送入。"
    : input.round === null
      ? input.consentGranted
        ? "还没有把材料交给云模型；下面是下一次理解会送入的范围。"
        : "尚未同意云处理，材料不会被送入模型。"
      : stale
        ? "材料在上一版理解之后有变化；标为“之后新增”的材料还没有送入模型。"
        : truncatedLastSent
          ? "模型只读到上述字符；未送入的原文仍完整保留。"
          : "模型已读到的范围与上述字符一致。";
  return {
    schemaVersion: 1,
    perMaterialLimit: INTAKE_MODEL_MATERIAL_LIMIT,
    totalLimit: INTAKE_TOTAL_LIMIT,
    consentGranted: input.consentGranted,
    lastSent: input.round === null ? null : {
      computedAt: input.round.computedAt, requestHash: input.round.requestHash, guidanceEpoch: input.round.guidanceEpoch,
      revision: input.round.revision, materialsHash: input.round.materialsHash,
      understandingPublished: input.round.understandingPublished,
      totalAvailableChars: input.round.totalAvailableChars, totalSentChars: input.round.totalSentChars,
    },
    current: { materialsHash: input.materialsHash, stale, totalAvailableChars: planned.totalAvailableChars,
      totalSentChars: planned.totalSentChars, items },
    note,
  };
}

