import { jsonHash } from "@/lib/mission/contracts";
import { githubConnection } from "./githubConnection";

type ConnectionIdentity = { id: string; projectId: string; ownerUserId: string; repo: string|null; ref: string|null; provider?:string };
export type RepositoryGrantBinding = { schemaVersion: 1; connectionId: string; scopeHash: string; observedRevision: number };

/** Connection identity is the non-renewable grant; refresh revision is only an observation/CAS clock. */
export function repositoryGrantBinding(c: ConnectionIdentity, observedRevision: number): RepositoryGrantBinding {
  githubConnection(c);
  return { schemaVersion: 1, connectionId: c.id, scopeHash: jsonHash({ connectionId: c.id, projectId: c.projectId,
    ownerUserId: c.ownerUserId, repo: c.repo, ref: c.ref }), observedRevision };
}

export function repositoryGrantCurrent(raw: unknown, c: ConnectionIdentity & { status: string; revokedAt: Date | null; revision: number }): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || c.status !== "ACTIVE" || c.revokedAt !== null || !c.repo || !c.ref || c.provider&&c.provider!=="GITHUB") return false;
  const b = raw as Partial<RepositoryGrantBinding>;
  return b.schemaVersion === 1 && b.connectionId === c.id && b.scopeHash === repositoryGrantBinding(c, c.revision).scopeHash &&
    Number.isInteger(b.observedRevision) && b.observedRevision! >= 0 && b.observedRevision! <= c.revision;
}
