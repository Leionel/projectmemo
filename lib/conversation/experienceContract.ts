import {
  agentPresentationSchema, investigationBudgetSchema, investigationDecisionSchema, presentationPlanSchema,
  type AgentPresentation, type AllowedAction, type EvidenceLink, type ExperienceEntityRef,
  type HydratedBlock, type InvestigationBudget, type InvestigationDecision, type PresentationPlan, type RichTextNode,
} from "@/lib/types/agentExperience";
import { reservedModelUsage, type ModelCallReservation } from "@/lib/agent/promptSpec";
import { isDeepStrictEqual } from "node:util";

export class ExperienceContractError extends Error {
  constructor(public code: string) { super(code); }
}
function reject(code: string): never { throw new ExperienceContractError(code); }
const key = (ref: ExperienceEntityRef) => JSON.stringify([ref.kind, ref.projectId, ref.id, ref.revision]);
const sameRefs = (a: ExperienceEntityRef[], b: ExperienceEntityRef[]) =>
  JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());

/** A fresh server snapshot, never accepted from a model/client or stored as an authorization grant. */
export interface ExperienceAuthority {
  conversationId: string;
  conversationVersion: number;
  userId: string;
  conversationOwnerUserId: string;
  sessionValid: boolean;
  scope: "WORKSPACE" | "PROJECT";
  homeProjectId: string | null;
  projectIds: string[];
  now: string;
  entities: Array<{ ref: ExperienceEntityRef; privateOwnerUserId: string | null }>;
  readSet: ExperienceEntityRef[];
  evidence: EvidenceLink[];
  catalog: HydratedBlock[];
  allowedActions: AllowedAction[];
}

function assertAuthority(a: ExperienceAuthority) {
  if (!a.sessionValid || a.userId !== a.conversationOwnerUserId) reject("EXPERIENCE_ACCESS_DENIED");
  if (!Number.isFinite(Date.parse(a.now))) reject("INVALID_AUTHORITY_TIME");
  if (a.scope === "PROJECT" && (!a.homeProjectId || a.projectIds.length !== 1 || a.projectIds[0] !== a.homeProjectId)) reject("EXPERIENCE_SCOPE_CHANGED");
  // Validate the complete read set even when the model omits a citation or chooses prose only.
  a.readSet.forEach(ref => assertRef(ref, a));
}
function assertRef(ref: ExperienceEntityRef, a: ExperienceAuthority) {
  if (!a.projectIds.includes(ref.projectId)) reject("EXPERIENCE_PROJECT_DENIED");
  const entity = a.entities.find(e => key(e.ref) === key(ref));
  if (!entity) reject("EXPERIENCE_SOURCE_CHANGED");
  if (entity.privateOwnerUserId && entity.privateOwnerUserId !== a.userId) reject("EXPERIENCE_PRIVATE_OBJECT_DENIED");
  if (["MISSION", "REVIEW", "PROPOSAL", "QUESTION", "ANCHOR"].includes(ref.kind) && entity.privateOwnerUserId !== a.userId)
    reject("EXPERIENCE_PRIVATE_OBJECT_DENIED");
}
function assertEvidence(e: EvidenceLink, a: ExperienceAuthority) {
  assertRef(e.source, a);
  if (!a.evidence.some(known => isDeepStrictEqual(known, e))) reject("EXPERIENCE_UNSUPPORTED_EVIDENCE");
}
function assertBlock(block: HydratedBlock, a: ExperienceAuthority) {
  block.refs.forEach(ref => assertRef(ref, a));
  if (block.semanticType === "evidence" || block.semanticType === "receipt") {
    block.evidence.forEach(e => assertEvidence(e, a));
    if ((block.semanticType === "evidence" && block.state === "SUPPORTED" || block.semanticType === "receipt" && block.verification === "VERIFIED") &&
      !block.evidence.some(e => e.applicability === "DIRECT" && e.verification === "CHECKED" && e.relation === "SUPPORTS"))
      reject("EXPERIENCE_UNSUPPORTED_VERIFICATION");
  }
  if (block.semanticType === "goal_gap") {
    assertRef(block.goalGap.goalRef, a);
    block.goalGap.criteria.forEach(c => c.evidence.forEach(e => assertEvidence(e, a)));
  }
  if (block.semanticType === "investigation") for (const step of block.steps) step.sources.forEach(ref => assertRef(ref, a));
  if (block.semanticType === "timeline") block.events.forEach(e => assertRef(e.ref, a));
  const requiredKinds: Partial<Record<HydratedBlock["semanticType"], string>> = {
    comparison: "PROPOSAL", approval: "PROPOSAL", receipt: "RECEIPT", question: "QUESTION", change: "REVIEW",
  };
  const requiredKind = requiredKinds[block.semanticType];
  if (requiredKind && !block.refs.some(r => r.kind === requiredKind)) reject("EXPERIENCE_MISSING_BUSINESS_OBJECT");
}
function assertAction(action: AllowedAction, a: ExperienceAuthority) {
  if (action.conversationId !== a.conversationId) reject("EXPERIENCE_CONVERSATION_MISMATCH");
  if (action.enabled && action.expectedConversationVersion !== a.conversationVersion) reject("EXPERIENCE_CONVERSATION_CHANGED");
  assertRef(action.target, a);
  if (action.enabled && action.frozen && Date.parse(action.frozen.expiresAt) <= Date.parse(a.now)) reject("EXPERIENCE_APPROVAL_EXPIRED");
}

export function validatePresentationPlan(raw: unknown, authority: ExperienceAuthority): PresentationPlan {
  assertAuthority(authority);
  const plan = presentationPlanSchema.parse(raw);
  for (const block of plan.composition) block.dataRefs.forEach(ref => assertRef(ref, authority));
  return plan;
}

function plainText(nodes: RichTextNode[]): string {
  return nodes.map(node => {
    if (node.type === "paragraph" || node.type === "heading") return node.spans.map(s => s.text).join("");
    if (node.type === "list") return node.items.map((item, i) => `${node.ordered ? i + 1 + "." : "•"} ${item.map(s => s.text).join("")}`).join("\n");
    if (node.type === "code") return node.text;
    return [node.headers, ...node.rows].map(row => row.join(" | ")).join("\n");
  }).join("\n\n");
}

/** Contract-level hydration. Business services must construct and refresh the catalog before use. */
export function hydratePresentation(raw: unknown, authority: ExperienceAuthority): AgentPresentation {
  const plan = validatePresentationPlan(raw, authority);
  const blocks: HydratedBlock[] = plan.composition.map(p => {
    if (p.semanticType === "prose") {
      const content: RichTextNode[] = p.content ?? [{ type: "paragraph", spans: [{ kind: "text", text: p.text! }] }];
      return { blockKey: p.blockKey, emphasis: p.emphasis, semanticType: "prose", fallbackText: plainText(content),
        refs: p.dataRefs, actionBindingIds: [], content };
    }
    const matches = authority.catalog.filter(b => b.semanticType === p.semanticType && sameRefs(b.refs, p.dataRefs));
    if (matches.length !== 1) return reject("EXPERIENCE_UNBOUND_BLOCK");
    // Model order/emphasis survive; status, candidates, drafts, receipts and actions are server-owned.
    return { ...matches[0], blockKey: p.blockKey, emphasis: p.emphasis };
  });
  const bindingIds = new Set(blocks.flatMap(b => b.actionBindingIds));
  const result = agentPresentationSchema.parse({ schemaVersion: 1, blocks,
    allowedActions: authority.allowedActions.filter(a => bindingIds.has(a.bindingId)) });
  validateHydratedPresentation(result, authority);
  return result;
}

export function validateHydratedPresentation(raw: unknown, authority: ExperienceAuthority): AgentPresentation {
  assertAuthority(authority);
  const view = agentPresentationSchema.parse(raw);
  for (const block of view.blocks) {
    assertBlock(block, authority);
    if (block.semanticType === "prose" && block.actionBindingIds.length) reject("EXPERIENCE_ACTION_UNBOUND");
    if (block.semanticType !== "prose" && !authority.catalog.some(known =>
      isDeepStrictEqual({ ...known, blockKey: block.blockKey, emphasis: block.emphasis }, block)))
      reject("EXPERIENCE_UNTRUSTED_BLOCK");
    for (const bindingId of block.actionBindingIds) {
      const action = view.allowedActions.find(a => a.bindingId === bindingId);
      if (!action || !block.refs.some(r => key(r) === key(action.target))) reject("EXPERIENCE_ACTION_UNBOUND");
      if (block.semanticType === "approval" && (!action.frozen || action.frozen.executionId !== block.executionId ||
        action.frozen.proposalHash !== block.proposalHash || action.frozen.expiresAt !== block.expiresAt ||
        action.enabled && block.state !== "PENDING")) reject("EXPERIENCE_APPROVAL_CHANGED");
      if (block.semanticType === "comparison" && (action.frozen?.proposalHash !== block.proposalHash ||
        action.actionKind === "PREVIEW" && !block.candidates.some(c => c.id === action.frozen?.candidateId && (!action.enabled || c.feasibility === "READY"))))
        reject("EXPERIENCE_APPROVAL_CHANGED");
    }
  }
  for (const action of view.allowedActions) {
    assertAction(action, authority);
    if (!view.blocks.some(b => b.actionBindingIds.includes(action.bindingId)) ||
      !authority.allowedActions.some(known => isDeepStrictEqual(known, action))) reject("EXPERIENCE_UNTRUSTED_ACTION");
  }
  return view;
}

export function validateInvestigationDecision(raw: unknown, authority: ExperienceAuthority,
  allowedTools: string[]): InvestigationDecision {
  assertAuthority(authority);
  const decision = investigationDecisionSchema.parse(raw);
  if (decision.decision === "HANDOFF_MISSION") assertRef(decision.mission, authority);
  if (decision.decision === "READ_EXISTING") {
    const call = decision.call;
    if (!allowedTools.includes(call.tool)) reject("INVESTIGATION_TOOL_DENIED");
    if (!authority.projectIds.includes(call.projectId)) reject("EXPERIENCE_PROJECT_DENIED");
    if (call.tool === "read_project_material") assertRef({ kind: "SOURCE", id: call.sourceId, projectId: call.projectId, revision: call.revision }, authority);
    if (call.tool === "inspect_action") assertRef({ kind: "ACTION", id: call.actionId, projectId: call.projectId, revision: call.revision }, authority);
  }
  return decision;
}

export function validateInvestigationBudget(raw: unknown, calls: ModelCallReservation[], toolReads: number, elapsedMs: number,
  observedProjectIds: string[]): InvestigationBudget {
  const budget = investigationBudgetSchema.parse(raw), usage = reservedModelUsage(calls);
  if (![toolReads, elapsedMs].every(n => Number.isSafeInteger(n) && n >= 0)) reject("INVALID_INVESTIGATION_USAGE");
  if (calls.length > budget.maxModelCalls || toolReads > budget.maxToolReads || elapsedMs > budget.maxElapsedMs ||
    new Set(observedProjectIds).size > budget.maxProjects || usage.inputTokens > budget.maxInputTokens || usage.outputTokens > budget.maxOutputTokens)
    reject("INVESTIGATION_BUDGET_EXHAUSTED");
  return budget;
}
