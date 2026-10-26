import { MissionPointer } from './Mission';
import { ConversationView } from './Conversation';
import { ConversationWorkRef } from './ConversationWork';
export interface ReviewMaterial { sourcePointer: MissionPointer; title: string; excerpt: string; readable: boolean; }
export interface ReviewCandidate {
  candidateId: string; kind?: string; title?: string; reason: string; question: string | null;
  goalLink?: string;
  expectedObservation?: string; stopCondition?: string; feasibility?: string; feasibilityReasons?: string[];
}
export interface ReviewResult { summary: string; decision?: string; candidates: ReviewCandidate[]; }
export interface ReviewBase { attempt: number; }
export interface ReviewView { id: string; status: string; stale: boolean; proposalHash: string; result: ReviewResult | null; base: ReviewBase; toolAttempts: number; }
export class ConversationReviews { enabled: boolean = false; materials: ReviewMaterial[] = []; change: ReviewView | null = null; dynamic: ReviewView | null = null; }
export class ConversationReviewInput {
  requestId: string = ''; expectedConversationVersion: number = 1; ref: ConversationWorkRef = new ConversationWorkRef();
  purpose: string = 'CHANGE_REVIEW'; expectedVersion: number = 1; llmContextApproved: boolean = true;
  sources?: MissionPointer[]; reviewId?: string; feedback?: string; retry?: boolean; rejectedCandidateIds?: string[];
}
export interface ConversationReviewReply { review: ReviewView | null; conversation: ConversationView; }
