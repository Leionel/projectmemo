import { ConversationView } from './Conversation';

export interface ConversationAnchor {
  id: string; conversationId: string; projectId: string; title: string;
  originKind: string; originId: string; topicKey: string; missionId: string | null;
  mode: string; version: number; snoozedUntil: string | null;
  projectedSeq: number; seenSeq: number; unread: number;
}
export interface ConversationAnchorListReply { anchors: ConversationAnchor[]; enabled: boolean; }
export interface ConversationAnchorReply { anchors: ConversationAnchor[]; conversation: ConversationView; enabled?: boolean; projected?: number; }
export interface ConversationUnreadDiscussion { conversationId: string; title: string; unread: number; }
export interface ConversationWorkspaceSyncReply { enabled: boolean; projected: number; discussions: ConversationUnreadDiscussion[]; }
export class ConversationAnchorInput {
  requestId: string = ''; expectedVersion: number = 0; action: string = ''; seenSeq?: number;
}
