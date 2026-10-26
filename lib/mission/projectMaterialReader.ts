import { db } from "@/lib/db";
import { jsonHash, type Source } from "./contracts";
import { sourceHash, type Tx } from "./repository";
import { readProjectMaterialView } from "./sourceSignals";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";

export async function readReviewMaterial(projectId: string, id: string, tx: Tx = db) {
  const material = await readProjectMaterialView(projectId, id, tx);
  if (material) return { ...material, readScope: "EXCERPT" as const };
  if (id.startsWith("card:")) {
    const card = await tx.knowledgeCard.findFirst({ where: { id: id.slice(5), projectId }, select: { id: true, title: true, summary: true, createdAt: true } });
    if (!card) return null;
    const hash = await sourceHash(projectId, id, tx);
    const states = await getTemporalSearchStates(projectId, [card.id]);
    const text = (card.title + "\n" + card.summary).slice(0, 12000);
    return { source: { id, kind: "PROJECT", entityType: "CARD", revision: hash!, hash: hash!, text,
      temporalState: states.get(card.id)?.state ?? "UNKNOWN", knowledgeClass: "PROJECT_OBSERVATION", observedAt: card.createdAt.toISOString() } as Source,
      title: card.title, readScope: "SUMMARY" as const, coverage: { loadedCharacters: text.length, totalCharacters: card.title.length + card.summary.length + 1, truncated: text.length < card.title.length + card.summary.length + 1, extractionStatus: "SUCCESS" } };
  }
  if (id.startsWith("artifact:")) {
    const artifact = await tx.generatedArtifact.findFirst({ where: { id: id.slice(9), projectId }, select: { content: true, createdAt: true } });
    if (!artifact) return null;
    const hash = await sourceHash(projectId, id, tx), text = artifact.content.slice(0, 12000);
    return { source: { id, kind: "PROJECT", entityType: "ARTIFACT", revision: hash!, hash: hash!, text, knowledgeClass: "MIXED", observedAt: artifact.createdAt.toISOString() } as Source,
      title: artifact.content.split(/\r?\n/, 1)[0].slice(0, 80) || "项目成果", readScope: "EXCERPT" as const,
      coverage: { loadedCharacters: text.length, totalCharacters: artifact.content.length, truncated: text.length < artifact.content.length, extractionStatus: "SUCCESS" } };
  }
  return null;
}
export function evidenceKey(source: Source) { return source.id + "@" + jsonHash({ hash: source.hash }).slice(0, 16); }
