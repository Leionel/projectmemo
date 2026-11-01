import { jsonHash } from "@/lib/mission/contracts";

/**
 * 认知账本的作用域判别联合：项目查询必须显式携带已验证 projectId；
 * 账户行 projectId/conversationId/missionId 均为空（迁移 CHECK 约束强制）。
 * 禁止把 undefined/null 当作"全部范围"——所有查询经这里生成过滤条件。
 */
export type ClaimScope = { type: "PROJECT"; projectId: string } | { type: "ACCOUNT" };

export const ACCOUNT_SCOPE_KEY = "ACCOUNT";

export function accountClaimScope(): { scopeType: "ACCOUNT"; projectId: null; scopeKey: string } {
  return { scopeType: "ACCOUNT", projectId: null, scopeKey: ACCOUNT_SCOPE_KEY };
}

export function projectClaimScope(projectId: string): { scopeType: "PROJECT"; projectId: string } {
  if (!projectId) throw new Error("PROJECT_SCOPE_REQUIRED");
  return { scopeType: "PROJECT", projectId };
}

/** 项目过滤条件：显式 scopeType + 已验证 projectId，缺 projectId 直接抛错而不是静默全量。 */
export function projectClaimWhere(projectId: string): { scopeType: "PROJECT"; projectId: string } {
  return projectClaimScope(projectId);
}

export function scopeKeyValue(scope: ClaimScope): string {
  return scope.type === "PROJECT" ? jsonHash({ projectId: scope.projectId }) : ACCOUNT_SCOPE_KEY;
}
