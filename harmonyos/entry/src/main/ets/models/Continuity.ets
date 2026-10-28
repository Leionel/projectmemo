import { ConversationWorkRef } from './ConversationWork';
export class DirectiveScope {
  projectId: string = '';
  conversationId?: string;
  missionId?: string;
}
export class EffectiveDirective {
  id: string = ''; directiveId: string = ''; seq: number = 0;
  scope: DirectiveScope = new DirectiveScope(); kind: string = ''; quote: string = '';
  sourceIds: string[] = []; validFrom: string = ''; validUntil: string | null = null;
}
export class HandoffMission { id: string = ''; goal: string = ''; status: string = ''; nextOwner: string = ''; href: string = ''; }
export class HandoffResult { id: string = ''; title: string = ''; resultText: string | null = null; resultCardId: string | null = null; verification: string = 'REPORTED'; href: string = ''; }
export class ContinuityHandoff { missions: HandoffMission[] = []; results: HandoffResult[] = []; }
export class DirectiveCandidate { id: string = ''; quote: string = ''; interpretation: string = ''; kind: string = ''; turnId: string = ''; conversationId: string = ''; scope: DirectiveScope = new DirectiveScope(); }
export class ContinuityView {
  schemaVersion: number = 1; seq: number = 0; intentHash: string = ''; reusePolicyHash: string = '';
  nextBoundary: string | null = null; directives: EffectiveDirective[] = []; workingObjective: string | null = null;
  constraints: string[] = []; stopped: boolean = false; handoff?: ContinuityHandoff;
  candidate?: DirectiveCandidate;
}
export class DirectiveInput {
  commandId: string = ''; expectedSeq: number = 0; scope: DirectiveScope = new DirectiveScope(); operation: string = 'SET';
  quote?: string; kind?: string; directiveId?: string; sourceIds?: string[];
  validUntil?: string; timezone: string = 'Asia/Shanghai'; admission: string = 'LITERAL';
  candidateHash?: string; confirmed?: boolean; preview?: boolean;
  candidateId?: string;
}
export class DirectiveAdmission { status: string = ''; reason: string = ''; question?: string; }
export class DirectiveReply { admission?: DirectiveAdmission; events?: string[]; view?: ContinuityView; command?: DirectiveInput; }
export class OpenHandoffInput { openWork: ConversationWorkRef = { kind: 'MISSION', id: '', projectId: '' }; }
export class OpenHandoffReply { ref: ConversationWorkRef = { kind: 'MISSION', id: '', projectId: '' }; }
