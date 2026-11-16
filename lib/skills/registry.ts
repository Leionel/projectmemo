export const BUILTIN_SKILLS = {
  "project-planning": { version: "1.0.0", label: "规划", output: "PlanDraft" },
  "evidence-research": { version: "1.0.0", label: "研究", output: "EvidencePack" },
  "deliverable-creation": { version: "1.0.0", label: "创作", output: "DeliverableDraft" },
  "project-review": { version: "1.0.0", label: "复盘", output: "ReviewFindings" },
} as const;
export type BuiltinSkillId = keyof typeof BUILTIN_SKILLS;
export function routeSkillSequence(goal: string): BuiltinSkillId[] {
  const primary: BuiltinSkillId = /复盘|回顾|失败原因|经验总结/.test(goal) ? "project-review"
    : /拆解|排期|制定计划|项目规划/.test(goal) ? "project-planning" : "evidence-research";
  return [primary, "deliverable-creation"];
}
