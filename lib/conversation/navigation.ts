/** Preserve the private discussion and exact origin through project navigation. */
export function conversationHref(href: string, conversationId: string, messageId?: string) {
  const url = new URL(href, "http://projectmemo.local");
  if (!href.startsWith("/") || href.startsWith("//")) return "/focus";
  url.searchParams.set("conversation", conversationId);
  if (messageId) url.searchParams.set("originMessage", messageId);
  return url.pathname + url.search + url.hash;
}
