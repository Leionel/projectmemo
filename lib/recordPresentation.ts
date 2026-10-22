/** Only a display label for the existing structured capture envelope, never a verified claim. */
export function readableRecord(title: string, summary: string) {
  for (const text of [title, summary]) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === 1 && "kind" in value && value.kind === "PROJECT_METRIC") {
        return { title: "结构化项目实验记录", summary: "已保存结构化资料；打开原项目查看原文与核验状态。" };
      }
    } catch { /* Ordinary user text stays unchanged. */ }
  }
  return { title, summary };
}
