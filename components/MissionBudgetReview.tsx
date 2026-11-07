"use client";

const rows: Array<[string, string, (value: number) => string]> = [
  ["模型调用", "models", value => `${value} 次`],
  ["工具调用", "tools", value => `${value} 次`],
  ["活动时间", "activeMs", value => `${Math.round(value / 60000)} 分钟`],
  ["输出预留", "reservedOutputTokens", value => `${value} tokens`],
];

/** 额度明细只读，默认收起；提高额度由“加额度并继续”一个按钮完成。 */
export function MissionBudgetDetails({ budget, used }: { budget: Record<string, number>; used: Record<string, number> }) {
  return <details><summary>查看额度明细</summary><ul>
    {rows.map(([label, key, format]) => <li key={key}>{label}：{format(used[key] ?? 0)} / {format(budget[key] ?? 0)}</li>)}
  </ul></details>;
}
