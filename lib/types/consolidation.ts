/**
 * R2 可撤销记忆归并契约。
 * 归并不删除原始 Capture、附件修订、关系与历史快照：被归并的卡只标记归档，
 * 撤销按回执恢复，不重建数据。
 */

export const CONSOLIDATION_SCHEMA_VERSION = 1;

export type ConsolidationReceiptStatus = "ACTIVE" | "REVOKED";

export interface ConsolidationCardSummary {
  id: string;
  title: string;
  summary: string;
  importance: number;
  createdAt: string;
  /** 统一时态顶层状态；UNKNOWN 不参与自动重复判定 */
  topLevelState: string;
}

export interface ConsolidationProposal {
  /** 由候选对稳定生成的 ID：同一对卡片重复请求得到同一 proposalId */
  proposalId: string;
  reason: string;
  similarityScore: number;
  masterCardId: string;
  cards: ConsolidationCardSummary[];
  /** 合并预览：只重组已有文本，不新增事实 */
  mergedPreview: string;
  /** 全部原始来源（Capture/附件/关系）在归并后仍可追溯 */
  preservedSources: string[];
}

export interface ConsolidationReceipt {
  id: string;
  projectId: string;
  masterCardId: string;
  masterCardTitle: string;
  mergedCardIds: string[];
  reason: string;
  similarityScore: number;
  status: ConsolidationReceiptStatus;
  createdAt: string;
  revokedAt: string | null;
}
