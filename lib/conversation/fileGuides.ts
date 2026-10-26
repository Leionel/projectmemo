import { db } from "@/lib/db";
import { sourceHash } from "@/lib/mission/repository";
import type { ConversationCitation, ConversationFileGuide, ConversationSource } from "@/lib/types/conversation";

/** Resolve only qualified source identities from the saved read manifest, never filenames in prose. */
export async function resolveFileGuides(sources: ConversationSource[], citations: ConversationCitation[] = [], snapshots: ConversationFileGuide[] = []): Promise<ConversationFileGuide[]> {
  const output: ConversationFileGuide[] = [];
  for (const [index, source] of sources.slice(0, 12).entries()) {
    const projectId = source.projectId, rawId = source.sourceId.slice(source.sourceId.indexOf(":") + 1);
    let entityId = rawId, kind: ConversationFileGuide["kind"] = "RECORD", title = source.title;
    let attachmentId: string | null = null, missing = false, archived = false;
    if (source.sourceId.startsWith("card:")) {
      const card = await db.knowledgeCard.findFirst({ where: { id: rawId, projectId }, select: { title: true, attachmentId: true, archivedAt: true } });
      if (card) { title = card.title; attachmentId = card.attachmentId; archived = card.archivedAt !== null; } else missing = true;
    } else if (source.sourceId.startsWith("capture:")) {
      const capture = await db.capture.findFirst({ where: { id: rawId, projectId }, select: { rawText: true, card: { select: { id: true, title: true, attachmentId: true, archivedAt: true } } } });
      if (capture) { entityId = capture.card?.id ?? rawId; title = capture.card?.title ?? capture.rawText.split(/\r?\n/, 1)[0].slice(0, 80); attachmentId = capture.card?.attachmentId ?? null; archived = !!capture.card?.archivedAt; } else missing = true;
    } else if (source.sourceId.startsWith("attachment:")) {
      attachmentId = rawId;
    } else if (source.sourceId.startsWith("artifact:")) {
      kind = "ARTIFACT";
      const artifact = await db.generatedArtifact.findFirst({ where: { id: rawId, projectId }, select: { content: true } });
      if (artifact) title = artifact.content.split(/\r?\n/, 1)[0].replace(/^#+\s*/, "").slice(0, 80) || "项目成果"; else missing = true;
    } else continue;
    const snapshot = snapshots.find(s => s.sourceId === source.id && s.revision === source.revision && s.projectId === projectId);
    if (snapshot) { kind = snapshot.kind; entityId = snapshot.entityId; title = snapshot.title; attachmentId = kind === "ATTACHMENT" ? entityId : null; }
    if (attachmentId) {
      kind = "ATTACHMENT"; entityId = attachmentId;
      const attachment = await db.attachment.findFirst({ where: { id: attachmentId, projectId }, select: { fileName: true } });
      if (attachment) { if (!snapshot) title = attachment.fileName; } else missing = true;
    }
    const currentHash = missing ? null : await sourceHash(projectId, source.sourceId);
    const citation = citations.find(c => c.sourceId === source.id);
    output.push({ number: index + 1, sourceId: source.id, projectId, entityId, kind, title,
      revision: source.revision, stale: currentHash !== null && currentHash !== source.revision, missing: missing || currentHash === null,
      archived, temporalState: source.temporalState, excerpt: source.excerpt, quote: citation?.quote ?? null,
      readScope: source.sourceId.startsWith("card:") ? "SUMMARY" : "EXCERPT",
      href: kind === "ATTACHMENT" ? `/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(entityId)}/file`
        : `/projects/${encodeURIComponent(projectId)}/${kind === "ARTIFACT" ? "artifacts" : "knowledge"}${source.sourceId.startsWith("card:") ? "#card-" + encodeURIComponent(entityId) : ""}`,
    });
  }
  return output;
}
