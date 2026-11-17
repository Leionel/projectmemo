/** Presentation only: identities and permission checks keep using the original values. */
export function sourceDisplayName(sourceId: string, name?: string) {
  if (name?.trim()) return name;
  const prefix = sourceId.split(":", 1)[0];
  return ({ capture: "项目记录", attachment: "上传文档", card: "记忆卡片", artifact: "项目成果", project: "项目概况",
    action: "行动记录", ci: "构建记录", deploy: "环境记录", doc: "文档摘录", external: "网页参考" } as Record<string, string>)[prefix] ?? "引用资料";
}
export function evidenceTime(value?: string | null, compact = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ...(compact ? {} : { year: "numeric" as const }),
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
