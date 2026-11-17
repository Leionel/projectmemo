export interface WorkbenchBlock { blockId: string; text: string; kind: string; sourceIds: string[]; }
export interface WorkbenchOutput { id: string; revision: number; createdAt: string; blocks: WorkbenchBlock[]; sourceKeys: string[]; }
export interface WorkbenchSource { key: string; id: string; hash: string; revision: string; text: string; current: boolean; kind: string; name?: string; }
export interface WorkbenchEvent { id: string; label: string; at: string; }
export class MissionWorkbench {
  id: string = ''; projectId: string = ''; projectTitle: string = ''; goal: string = ''; workingObjective: string = '';
  status: string = ''; phase: string = ''; reason: string = ''; version: number = 0; checkedAt: string = '';
  challengesEnabled?: boolean; outputs: WorkbenchOutput[] = []; sources: WorkbenchSource[] = []; events: WorkbenchEvent[] = [];
}
export class WorkbenchMaterial {
  requestId: string = ''; text: string = ''; kind: string = 'FEEDBACK';
}
export interface WorkbenchMaterialReply { sourceId: string; replayed: boolean; kind: string; }
export interface ChallengeOption { key: string; label: string; sourceKey?: string; }
export interface ChallengeQuestion { key: string; title: string; excerpt: string; options: ChallengeOption[]; }
export interface ChallengeAnswer { questionKey: string; text: string; selected: string[]; verdict: string; }
export interface OutcomeChallenge {
  id: string; missionId: string; outputId: string; revision: number; kind: string; status: string; reason: string | null;
  questions: ChallengeQuestion[]; answers: ChallengeAnswer[]; sourceKeys: string[]; openedSourceKeys: string[]; handoffSourceId: string | null;
}
export interface OutcomeChallengeReply { session: OutcomeChallenge | null; replayed?: boolean; }
export class OutcomeChallengeCommand {
  requestId: string = ''; action?: string; questionKey?: string; text?: string; selected?: string[]; sourceKey?: string;
  kind?: string; outputId?: string;
}
export function workbenchOutput(view: MissionWorkbench, id: string): WorkbenchOutput | undefined {
  return view.outputs.find((output: WorkbenchOutput) => output.id === id) ?? view.outputs[0];
}
export function workbenchSource(view: MissionWorkbench, key: string): WorkbenchSource | undefined {
  // Bind by frozen id+hash, never only by a reused filename or bare source id.
  return view.sources.find((source: WorkbenchSource) => source.key === key);
}
export function challengeQuestion(session: OutcomeChallenge | null): ChallengeQuestion | undefined {
  if (session === null || session.status !== 'ACTIVE') return undefined;
  return session.questions[session.answers.length];
}
