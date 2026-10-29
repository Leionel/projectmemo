/** Stable, local titles: no extra model call and no title changes on follow-ups. */
export function discussionTitle(question: string, projectTitle?: string) {
  const text = question.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(?:请问|请|帮我|麻烦)(?:一下)?\s*/, "");
  const prefix = projectTitle ? Array.from(projectTitle).slice(0, 10).join("") + " · " : "";
  const characters = Array.from(text || "项目讨论"), limit = Math.max(12, 36 - Array.from(prefix).length);
  const body = characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : characters.join("");
  return prefix + body;
}
export function hasDefaultDiscussionTitle(title: string) {
  return ["项目协作", "新讨论", "与忆程协作", "项目讨论"].includes(title);
}
