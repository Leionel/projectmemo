import { z } from "zod";
export type AnchorView = {
  id: string; conversationId: string; projectId: string; title: string; originKind: string; originId: string;
  topicKey: string; missionId: string | null; mode: "MANUAL" | "FOLLOWING" | "LATER" | "STOPPED";
  version: number; snoozedUntil: string | null; projectedSeq: number; seenSeq: number; unread: number;
};
export const anchorCommandSchema = z.object({ requestId: z.string().min(1).max(128), expectedVersion: z.number().int().positive(),
  action: z.enum(["FOLLOW", "LATER", "STOP", "ACK"]), seenSeq: z.number().int().nonnegative().optional() }).strict();
