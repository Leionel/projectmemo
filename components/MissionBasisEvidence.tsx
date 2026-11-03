"use client";
/**
 * 当前判断的依据 / 原文 / 纠正入口（C2 接线骨架）。
 *
 * 分开呈现：
 * - currentUse（当前是否允许继续作为依据）：ALLOWED / SUPPRESSED / UNKNOWN / 旧服务未提供=资格未知；
 * - revisionAvailability（原修订匹配事实）：CURRENT / CHANGED / UNAVAILABLE；
 * - 历史 facts/摘录原样保留，但被抑制/来源链未知的资料不作为当前推荐或默认引用；
 * - 只有文件级定位时说明未记录页码/段落，不编造精确位置；EXACT_QUOTE 不等于独立证实。
 *
 * 纠正入口复用原 ClaimCorrection / 原草稿版本链接，不新建判断或来源数据库。
 */
import type { MissionReadback as ReadbackData } from "@/lib/mission/readback";
import type { WorkPacket } from "@/lib/types/workPacket";

export type MissionBasisEvidenceProps = {
  packet: WorkPacket;
  readback: ReadbackData;
  missionId: string;
  /** 只重新读取原端点，用于纠正后/来源变化后重新核对。 */
  onReload: () => void;
  disabled?: boolean;
};

export function MissionBasisEvidence({ packet }: MissionBasisEvidenceProps) {
  // C2 实现逐项依据、原文/版本、资格与纠正入口；骨架阶段保持空渲染。
  if (!packet) return null;
  return null;
}
