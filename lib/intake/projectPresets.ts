/** Starting suggestions only: they never grant tools, choose a profession, or change project facts. */
export const PROJECT_PRESET_IDS = ["release", "client", "research", "course"] as const;
export const PROJECT_PRESETS = [
  { id: "release", label: "发布准备", goal: "整理下一版本发布说明与待验证项", hint: "需求、变更记录、测试结果与尚未验证的条件" },
  { id: "client", label: "客户交付", goal: "整理客户交付说明，区分反馈与已确认要求", hint: "获准处理的 brief、交付范围与客户反馈；客户资料仅放入当前项目" },
  { id: "research", label: "科研汇报", goal: "整理实验阶段汇报，保留条件差异与未知项", hint: "实验记录、数据划分、评估条件与尚未复现的结果" },
  { id: "course", label: "课程项目", goal: "整理课程项目交付清单与待确认条件", hint: "课程要求、已有成果、评分口径与尚未完成的部分" },
] as const;
