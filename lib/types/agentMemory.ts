export type ClaimOriginView = {
  kind: "CAPTURE" | "CARD" | "MESSAGE" | "MISSION_OUTPUT" | "ARTIFACT" | "EPISODE" | "CLAIM";
  id: string; contentHash: string; offsetEncoding: "UTF16_CODE_UNITS"; normalization: "RAW_V1";
  start: number; end: number; quote: string;
};
export type ClaimHeadView = { claimId: string; revision: number; origin: ClaimOriginView; eventKind: string;
  userQuote: string | null; validUntil: string | null; active: boolean };
export type ClaimControlsView = { ownerUserId: string; seq: number; heads: ClaimHeadView[]; reusePolicyHash: string; nextBoundary: string | null };
export type ClaimTextView = Omit<ClaimOriginView, "start" | "end" | "quote"> & { text: string };
export type ClaimCommand = { requestId: string; scope: { projectId: string }; expectedSeq: number; expectedOwnerUserId?: string;
  expectedRevision?: number; origin: ClaimOriginView; operation: "CORRECT" | "WITHDRAW"; userQuote?: string };
