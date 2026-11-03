/**
 * 官网与五步示例共用的公开安全素材。
 *
 * 全部文案取自 prisma/seed.ts 的演示项目，不含私人项目内容；
 * 官网任何交互只读取这份常量，不调用模型、不读取登录用户的项目。
 */
export const exampleProject = {
  label: "内置公开示例",
  project: "忆程参赛作品开发",
  mission: "整理阶段汇报",
  goal: "用已有材料整理一份阶段汇报",
  sources: [
    {
      id: "requirements",
      title: "比赛材料",
      detail: "初赛需要准备创意描述、设计稿、作品介绍文档和演示材料。",
      meta: "示例素材 · 比赛要求摘录",
    },
    {
      id: "task",
      title: "任务安排",
      detail:
        "目前还没有完整 Demo，需要先完成项目创建、碎片捕获和成果生成闭环。",
      meta: "示例素材 · 项目任务记录",
    },
    {
      id: "advice",
      title: "老师建议",
      detail:
        "老师建议作品不要叫普通学习助手，要突出项目制学习和知识资产复用。",
      meta: "示例素材 · 指导意见摘录",
    },
  ],
  missing: {
    title: "演示流程的实际结果",
    detail: "还没有完成回执，不能确认演示流程已经跑通。",
  },
  pending: {
    title: "补充演示结果，或确认先按现有材料写汇报草稿",
  },
  boundary: "公开示例 · 不调用模型 · 不写入你的项目",
} as const;

export type ExampleSource = (typeof exampleProject.sources)[number];
