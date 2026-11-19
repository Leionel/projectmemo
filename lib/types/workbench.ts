import type { AgentPresentation } from "./agentExperience";
import type { ConversationMessage } from "./conversation";
export type WorkbenchOutput = {
  id: string; revision: number; createdAt: string; sourceKeys: string[];
  blocks: Array<{ blockId: string; text: string; kind: string; sourceIds: string[] }>;
  presentation: AgentPresentation;
  missingInformation?: string[];
  sourceAccessChanged?: boolean;
  weeklyReportArtifactId?: string;
};
export type WorkbenchRevisionTarget = { revision: number; baselineRevision: number; sourceId?: string };
export type WorkbenchComparison = {
  revision: number; baselineRevision: number; restricted: boolean;
  changes: Array<{ id: string; kind: string; before?: string; after?: string; beforeKeys: string[]; afterKeys: string[] }>;
  addedKeys: string[]; removedKeys: string[];
};
export function readRevision(value: string | null | undefined) {
  const revision = value && /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isSafeInteger(revision) && revision > 0 && revision <= 2147483647 ? revision : undefined;
}
export type WorkbenchSource = { key: string; id: string; revision: string; hash: string; text: string; current: boolean; kind: string; name?: string; observedAt?: string };
export type WorkbenchStageArtifact = {
  id: string; skillId: string; label: string; createdAt: string; sourceKeys: string[];
  blocks: Array<{ blockId: string; text: string; kind: string; sourceIds: string[] }>;
  presentation: AgentPresentation; checks: Array<{ name: string; passed: boolean; detail: string }>; unknowns: string[];
};
export type WorkbenchSnapshot = {
  challengesEnabled?: boolean;
  artifactAdoptionEnabled?: boolean;
  lastSeenOutputRevision?: number;
  pendingQuestionId?: string;
  lastAnsweredQuestionId?: string;
  comparison?: WorkbenchComparison;
  id: string; projectId: string; goal: string; projectTitle: string; workingObjective: string;
  status: string; phase: string; reason: string; reasonCode: string; checkedAt: string; provider: string; version: number;
  models: number; tools: number; outputs: WorkbenchOutput[]; stageArtifacts: WorkbenchStageArtifact[]; sources: WorkbenchSource[];
  events: Array<{ id: string; label: string; at: string; kind?: string }>;
};
export function workbenchMessage(output: WorkbenchOutput, projectId: string, provider: string): ConversationMessage {
  return { schemaVersion: 1, id: output.id, seq: output.revision, role: "ASSISTANT", content: "", restricted: false,
    refs: [], sources: [], priorities: [], proposal: null, provider, limitations: [], observedProjectIds: [projectId],
    presentation: output.presentation };
}
export function workbenchArtifactMessage(artifact: WorkbenchStageArtifact, projectId: string, provider: string): ConversationMessage {
  return { schemaVersion: 1, id: artifact.id, seq: 0, role: "ASSISTANT", content: "", restricted: false,
    refs: [], sources: [], priorities: [], proposal: null, provider, limitations: [], observedProjectIds: [projectId],
    presentation: artifact.presentation };
}
