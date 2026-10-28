import { z } from "zod";
const id = z.string().min(1).max(180);
export const directiveScopeSchema = z.object({ projectId: id, conversationId: id.optional(), missionId: id.optional() }).strict();
export const directiveCommandSchema = z.object({
  commandId: id, expectedSeq: z.number().int().nonnegative(), scope: directiveScopeSchema,
  operation: z.enum(["SET", "WITHDRAW", "SUPPRESS_USE", "TRANSFER"]),
  quote: z.string().trim().min(1).max(1000).optional(),
  kind: z.enum(["WORKING_OBJECTIVE", "CONSTRAINT", "STOP", "USE_SUPPRESSION"]).optional(),
  directiveId: id.optional(), targetProjectId: id.optional(), sourceIds: z.array(id).max(24).optional(),
  candidateId: id.optional(),
  validFrom: z.string().datetime().optional(), validUntil: z.string().datetime().optional(),
  timezone: z.string().max(80).default("Asia/Shanghai"),
  admission: z.enum(["LITERAL", "CONFIRMED"]).default("LITERAL"),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), confirmed: z.literal(true).optional(),
}).strict();
export type DirectiveCommand = z.infer<typeof directiveCommandSchema>;
export type DirectiveScope = z.infer<typeof directiveScopeSchema>;
export type Admission = { status: "DIRECT_APPLIED" | "CONFIRMED_APPLIED" | "INTERPRETATION_CANDIDATE" | "NEEDS_CLARIFICATION" | "REJECTED";
  kind?: "WORKING_OBJECTIVE" | "CONSTRAINT" | "STOP" | "USE_SUPPRESSION"; until?: string; constraints?: string[]; reason: string; question?: string };
export type EffectiveDirective = { id: string; directiveId: string; seq: number; scope: DirectiveScope; kind: string; quote: string; sourceIds: string[]; validFrom: string; validUntil: string | null };
export type ContinuityView = { schemaVersion: 1; seq: number; intentHash: string; reusePolicyHash: string; nextBoundary: string | null;
  candidate?: { id: string; quote: string; interpretation: string; kind: "WORKING_OBJECTIVE" | "CONSTRAINT"; turnId: string; conversationId: string; scope: DirectiveScope };
  directives: EffectiveDirective[]; workingObjective: string | null; constraints: string[]; stopped: boolean;
  handoff?: { missions: Array<{ id: string; goal: string; status: string; nextOwner: string; href: string }>;
    results: Array<{ id: string; title: string; resultCardId: string | null; resultText: string | null; verification: "REPORTED"; href: string }> };
};
