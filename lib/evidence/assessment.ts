/** 引用准入、记录的时态、文本支持和现实真伪是不同问题。 */
export interface EvidenceAssessment {
  schemaVersion: 1;
  policyVersion: "evidence-v1";
  citationAdmissibility: "ADMITTED" | "REJECTED" | "NOT_CHECKED";
  temporalState: "CURRENT" | "SUPERSEDED" | "CONTESTED" | "UNKNOWN";
  semanticVerdict: "ENTAILS" | "CONTRADICTS" | "NOT_ENOUGH_INFORMATION" | "NOT_CHECKED";
  knowledgeClass: "PROJECT_OBSERVATION" | "EXTERNAL_REFERENCE" | "MIXED" | "INFERENCE";
  sourceId: string;
  sourceRevision: string;
  observedAt: string;
  sourceTime: string | null;
  textRange: { start: number; end: number } | null;
  reasonCode: string;
  method: "RULE" | "JUDGE" | "NONE";
}

export function evidenceAssessment(input: Pick<EvidenceAssessment, "sourceId" | "observedAt"> & Partial<EvidenceAssessment>): EvidenceAssessment {
  return { schemaVersion: 1, policyVersion: "evidence-v1", citationAdmissibility: "NOT_CHECKED", temporalState: "UNKNOWN",
    semanticVerdict: "NOT_CHECKED", knowledgeClass: "PROJECT_OBSERVATION", sourceRevision: "", sourceTime: null,
    textRange: null, reasonCode: "NOT_CHECKED", method: "NONE", ...input };
}

export const semanticLabel = (value?: string) => value === "ENTAILS" ? "原文支持此句" : value === "CONTRADICTS" ? "原文与此句相反" : value === "NOT_ENOUGH_INFORMATION" ? "原文不足以支持" : "语义尚未核验";
export const temporalLabel = (value?: string) => value === "CURRENT" ? "当前有效" : value === "SUPERSEDED" ? "历史记录" : value === "CONTESTED" ? "存在争议" : "时态未知";
