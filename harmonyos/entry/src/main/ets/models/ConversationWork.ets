import { FitPremise, EvidenceReview } from './EvidenceFit';
import { MissionPointer, MissionMaterialPreview } from './Mission';
import { ConversationView } from './Conversation';
export class ConversationWorkRef { kind: string = 'MISSION'; id: string = ''; projectId: string = ''; }
export interface WorkQuestion { id: string; text: string; premise: FitPremise | null; }
export interface WorkApproval { id: string; proposalHash: string; title: string; description: string; }
export interface WorkOutput { id: string; revision: number; title: string; verificationStatus: string; }
export interface WorkCandidate { sourcePointer: MissionPointer; title: string; excerpt: string; readable: boolean; }
export interface WorkChoice { key: string; title: string; tradeoff: string; feasibility: string; reasons: string[]; }
export interface WorkScenario { id: string; proposalHash: string; expectedVersion: number; stale: boolean; status: string; choices: WorkChoice[]; }
export class ConversationWork {
  ref: ConversationWorkRef = new ConversationWorkRef(); title: string = ''; status: string = ''; versionToken: string = '';
  version: number = 0; contextVersion: number = 0; planRevision: number = 0;
  question: WorkQuestion | null = null; approval: WorkApproval | null = null; output: WorkOutput | null = null;
  resultText: string | null = null; resultCardId: string | null = null; candidates: WorkCandidate[] = []; scenario: WorkScenario | null = null;
}
export class ConversationWorkInput {
  requestId: string = ''; expectedConversationVersion: number = 1; ref: ConversationWorkRef = new ConversationWorkRef(); versionToken: string = '';
  operation: string = ''; answer?: string; decision?: string; sourcePointers?: MissionPointer[]; evidenceReview?: EvidenceReview;
  scenarioProposalId?: string; scenarioKey?: string; outputId?: string; outputRevision?: number;
  dynamicProposalId?: string; candidateId?: string;
}
export class ConversationScenarioInput {
  requestId: string = ''; ref: ConversationWorkRef = new ConversationWorkRef(); versionToken: string = '';
  availableMinutes: number = 0; deliveryMinutes: number = 0; allowActionProposals: boolean = false;
}
export interface ConversationWorkReply { conversation: ConversationView; work?: ConversationWork; }
export type ConversationMaterialAssessment = MissionMaterialPreview;
