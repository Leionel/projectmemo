import type { AgentPresentation } from "./agentExperience";
import type { ConversationMessage } from "./conversation";
export type WorkbenchOutput = {
  id: string; revision: number; createdAt: string; sourceKeys: string[];
  blocks: Array<{ blockId: string; text: string; kind: string; sourceIds: string[] }>;
  presentation: AgentPresentation;
};
export type WorkbenchSource = { key: string; id: string; revision: string; hash: string; text: string; current: boolean; kind: string };
export type WorkbenchSnapshot = {
  id: string; projectId: string; goal: string; projectTitle: string; workingObjective: string;
  status: string; phase: string; reason: string; checkedAt: string; provider: string; version: number;
  models: number; tools: number; outputs: WorkbenchOutput[]; sources: WorkbenchSource[];
  events: Array<{ id: string; label: string; at: string }>;
};
export function workbenchMessage(output: WorkbenchOutput, projectId: string, provider: string): ConversationMessage {
  return { schemaVersion: 1, id: output.id, seq: output.revision, role: "ASSISTANT", content: "", restricted: false,
    refs: [], sources: [], priorities: [], proposal: null, provider, limitations: [], observedProjectIds: [projectId],
    presentation: output.presentation };
}
