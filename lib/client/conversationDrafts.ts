const prefix = "projectmemo:conversation-draft:";
export type ConversationDraft = { answer: string; selected: string[]; minutes: string; delivery: string; mode: string; premiseHash: string; versionToken: string };
export const emptyConversationDraft = (): ConversationDraft => ({ answer: "", selected: [], minutes: "", delivery: "", mode: "CONDITIONAL_ANALYSIS", premiseHash: "", versionToken: "" });
export function readConversationDraft(key: string): ConversationDraft {
  const fallback = emptyConversationDraft();
  if (typeof window === "undefined") return fallback;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(prefix + key) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    for (const field of ["answer", "minutes", "delivery", "mode", "premiseHash", "versionToken"] as const)
      if (typeof value[field] === "string") fallback[field] = value[field].slice(0, field === "answer" ? 3000 : 500);
    fallback.selected = Array.isArray(value.selected) ? value.selected.filter((s: unknown) => typeof s === "string").slice(0, 8) : [];
    return fallback;
  } catch { return fallback; }
}
export function saveConversationDraft(key: string, value: ConversationDraft) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(prefix + key, JSON.stringify(value)); } catch { /* Storage unavailable: keep the mounted draft. */ }
}
export function clearConversationDraft(key: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(prefix + key); } catch { /* No persistent draft. */ }
}
export function clearConversationDrafts() {
  if (typeof window === "undefined") return;
  try { for (const key of Object.keys(window.sessionStorage)) if (key.startsWith(prefix)) window.sessionStorage.removeItem(key); } catch { /* No persistent draft. */ }
}
export function bindConversationDraftOwner(userId: string) {
  if (typeof window === "undefined") return;
  try {
    const previous = window.sessionStorage.getItem(prefix + "owner");
    if (previous && previous !== userId) clearConversationDrafts();
    window.sessionStorage.setItem(prefix + "owner", userId);
  } catch { /* Drafts remain in mounted components only. */ }
}
