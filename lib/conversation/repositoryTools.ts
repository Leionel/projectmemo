import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { readRepositoryCi, readRepositoryCiDetail, type CiTransport, type CiDispatch } from "@/lib/sensing/repoCi";
import { validateRepositoryObservation } from "@/lib/sensing/repoCiObservations";
import type { RepositoryCiCall, RepositorySourceMeta } from "@/lib/types/repositoryCi";
import type { ConversationActor, ConversationSource } from "@/lib/types/conversation";
import { turnOperation, mutateTurn } from "./turnRuntime";
import { record } from "./repository";
import type { MaterialPointer } from "./toolAdapter";
import { readSourceObservation } from "./sourceObservation";

export async function readConversationRepositoryTool(actor: ConversationActor, id: string, turnId: string, call: RepositoryCiCall,
  pointers: MaterialPointer[], sources: ConversationSource[], fetcher?: CiTransport): Promise<{ data: unknown; coverage: Record<string, unknown>; sources: ConversationSource[]; discovered: MaterialPointer[] }> {
  actor = { ...actor, conversationId: id };
  let seq = 0;
  const dispatch: CiDispatch = (url, requestUnits, run) => turnOperation(actor, id, turnId, "ci-http:" + jsonHash({ call, seq: ++seq }), "REPO_CI_HTTP", { url, requestUnits }, run);
  let repository: RepositorySourceMeta, data: unknown, coverage: Record<string, unknown>;
  if (call.tool === "read_repository_ci") {
    const pointer = pointers.find(p => p.projectId === call.projectId && p.sourceId === "repo:" + call.connectionId && p.revision === call.revision);
    const original = await readSourceObservation(actor, call.projectId, call.connectionId);
    if (!pointer || original.revision !== call.revision || !original.signalIds.includes(call.sha)) throw new AppError("CI_TARGET_NOT_OBSERVED", "请从当前授权仓库的原提交中选择 SHA", 409);
    const result = await readRepositoryCi(actor, call.projectId, call.connectionId, call.sha, fetcher, dispatch);
    repository = { connectionId: call.connectionId, connectionRevision: result.connectionRevision, repo: result.repo, sha: call.sha, kind: "STATUS", runs: result.runs, observedAt: result.observedAt };
    data = result; coverage = result.coverage;
  } else {
    const parent = sources.find(s => s.sourceId === call.sourceId && s.projectId === call.projectId && s.revision === call.revision);
    if (!parent?.repository) throw new AppError("CI_TARGET_NOT_OBSERVED", "请先读取原提交的 CI 状态或失败任务", 409);
    await validateRepositoryObservation(actor.userId, call.projectId, parent.sourceId, parent.revision);
    const result = await readRepositoryCiDetail(actor, call.projectId, parent.repository, call.tool === "read_ci_jobs" ? { runId: call.runId, attempt: call.attempt } : { jobId: call.jobId }, fetcher, dispatch);
    repository = result.repository; data = result.body; coverage = result.coverage;
  }
  repository = { ...repository, conversationId: id, turnId };
  if(typeof data==="string"&&data.length>3000){data=data.slice(-3000);coverage={...coverage,complete:false,truncated:true,description:"脱敏日志末尾片段，前文未载入"};}
  const text = JSON.stringify({ observation: data, verification: "CI_OBSERVATION_NOT_DEPLOYMENT", authority: "UNTRUSTED_TOOL_DATA", repository }).slice(0, 5000);
  const revision = jsonHash({ repository, text }), sourceId = "ci:" + randomUUID();
  const source: ConversationSource = { id: call.projectId + "/" + sourceId, sourceId, projectId: call.projectId, repository, revision,
    title: `${repository.repo} · ${repository.sha.slice(0, 10)} · ${repository.kind}${repository.attempt ? " · attempt " + repository.attempt : ""}`,
    excerpt: text, observedAt: repository.observedAt, temporalState: "UNKNOWN", knowledgeClass: "EXTERNAL_REFERENCE", start: 0, end: text.length, excerptHash: jsonHash(text), readScope: repository.kind === "LOG" ? "EXCERPT" : "STRUCTURED" };
  await mutateTurn(actor, id, turnId, manifest => ({ ...manifest, repositorySources: [...(record(manifest).repositorySources as ConversationSource[] ?? []), source].slice(-16) }));
  await validateRepositoryObservation(actor.userId, call.projectId, sourceId, revision);
  return { data, coverage, sources: [source], discovered: [{ projectId: call.projectId, sourceId, revision, title: source.title, repository }] };
}
