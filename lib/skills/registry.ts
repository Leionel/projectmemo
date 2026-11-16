export const BUILTIN_SKILLS = {
  "project-planning": { version: "1.0.0", label: "规划", output: "PlanDraft" },
  "evidence-research": { version: "1.0.0", label: "研究", output: "EvidencePack" },
  "deliverable-creation": { version: "1.0.0", label: "创作", output: "DeliverableDraft" },
  "project-review": { version: "1.0.0", label: "复盘", output: "ReviewFindings" },
} as const;
export type BuiltinSkillId = keyof typeof BUILTIN_SKILLS;
