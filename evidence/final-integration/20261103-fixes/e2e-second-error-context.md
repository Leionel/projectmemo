# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: experiments.spec.ts >> fixed metric job uses its own approval and receipt; correction makes it historical
- Location: e2e\experiments.spec.ts:6:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('固定脚本核算已完成。', { exact: true })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText('固定脚本核算已完成。', { exact: true })

```

```yaml
- link "跳到主要内容":
  - /url: "#main-content"
- banner:
  - link "忆程 ProjectMemo 首页":
    - /url: /
    - text: 忆程 ProjectMemo MEMORY AGENT
  - navigation:
    - text: 演示模式
    - link "焦点":
      - /url: /focus
    - link "项目":
      - /url: /projects
    - link "记忆":
      - /url: /memory
    - link "行动":
      - /url: /actions
    - button "全局设置": 设置
    - button "切换深浅色主题"
    - button "E2E 评审身份"
- main:
  - link "返回项目列表":
    - /url: /projects
  - text: 科研训练 更新于 2026/11/3
  - heading "指标与论文链路验收" [level=1]
  - group: 项目目标与简介
  - button "编辑项目"
  - navigation "项目主要导航":
    - link "概览":
      - /url: /projects/cmw0i82620000n48ork94przv
    - link "委托":
      - /url: /projects/cmw0i82620000n48ork94przv/missions
    - link "资料":
      - /url: /projects/cmw0i82620000n48ork94przv/records
    - link "行动":
      - /url: /projects/cmw0i82620000n48ork94przv/actions
    - link "成果":
      - /url: /projects/cmw0i82620000n48ork94przv/generate
  - group: 项目功能
  - region "项目关联讨论":
    - button "打开项目讨论"
  - heading "长期委托" [level=2]
  - paragraph: 委托目标、执行进度和成果草稿
  - region "长期项目委托":
    - heading "长期项目委托" [level=2]
    - paragraph: 交给 Agent 一个目标，在同一委托中持续推进、补充材料和审阅成果。
    - text: 已加载 1 项委托
    - status:
      - text: 审批已记录，执行结果以原步骤回执为准。
      - button "收起操作回执": 收起
    - complementary "委托列表与创建":
      - group: 委托新目标
      - navigation "已有委托":
        - heading "已有委托" [level=3]
        - button "核对下降结果 · 已暂停" [pressed]: 核对下降结果 已暂停
    - group:
      - button "设为当前关注"
      - text: 已暂停 1 个步骤已执行 · 0 份草稿
      - link "调整当前重点／继续讨论":
        - /url: /focus?entryKind=MISSION&entryId=cmw0i828t0004n48oe1d2ni5g&entryProject=cmw0i82620000n48ork94przv
      - heading "核对下降结果" [level=3]
      - status: 委托批准未能提交，请重新核对提案后继续
      - group: 成果核验与现实结果
      - button "取消委托"
      - region "原任务当前工作包与完成回执":
        - button "重新读取状态与回执"
        - region "原任务四问工作包":
          - button "核对当前状态"
          - paragraph: 只做页面内定位或重新读取；不提交批准、执行或创建替代任务。
          - region "做到哪":
            - heading "做到哪" [level=4]
            - list:
              - listitem: 提交固定核算预览 结果待核对 · 时间未记录
              - listitem: 读取论文元数据 已执行 · 2026/11/3 17:47:34
            - paragraph: 最近草稿：窗口内未记录
            - paragraph: 已执行 1 · 已观察 1 · 已独立支持 0 · 用户报告 0 · 反例 0 · 未知 1
            - paragraph: 最近工作只取原 Step/Output/Action/回执的有界窗口；执行成功、草稿存在与行动创建都不等于现实目标达成。
            - paragraph: 步骤窗口上限 5 条；窗口内没有记录只表示覆盖不足。
            - paragraph: 现实结果：未从委托状态推断（NOT_INFERRED），以原行动回执为准。
          - region "依据是什么":
            - heading "依据是什么" [level=4]
            - paragraph: 关联原问题：未记录
            - paragraph: 原资料使用 0 项 · 证据审查 0 条
            - paragraph: 当前依据可用性已按来源策略判定；历史留痕不等于当前可用。
            - paragraph: 依据只取原资料使用与证据审查投影；历史留痕保留原身份，当前可用不等于独立支持。
            - group: 展开依据、原文与纠正入口
          - region "为何停下":
            - heading "为何停下" [level=4]
            - paragraph: 当前阶段：已暂停 · 原状态：已暂停
            - paragraph: 委托批准未能提交，请重新核对提案后继续（EXECUTION_FAILED）
            - paragraph: 首要阻断：后台 Worker 心跳不可靠，尚未核实近期执行；心跳不等于成功观察 WORKER_PRESENCE_UNOBSERVED
            - paragraph: 无停止请求。
            - paragraph: 未结算效果：代码未记录 · 原 1 个步骤结果尚未结算，读取不会自动核销；读取不会核销，需要重新核对原请求。
            - group: 全部阻断（2 项）
            - group: 技术说明（原投影）
          - region "现在等谁":
            - heading "现在等谁" [level=4]
            - paragraph: 等待：等你重新核对条件
            - paragraph: 下一步由谁：你
            - paragraph: 下次检查时间：未记录
            - paragraph: 有效边界：未记录
            - paragraph: 原许可/期限/提案依据已变化，需重新核对；不会自动恢复执行。
          - region "观察时间":
            - heading "观察时间" [level=4]
            - term: 读取于
            - definition: 2026/11/3 17:47:38
            - term: 最近成功观察
            - definition: 尚未有成功观察记录
            - term: 最近失败观察
            - definition: 未记录
            - term: 观察状态
            - definition: 尚未有成功观察记录
            - term: 下次计划观察
            - definition: 未记录
            - paragraph: 读取时间只表示本次读取；刷新页面不会推进成功观察，也不表示刚刚核查或资料没有变化。
          - group: 责任边界、权限与累计预算
          - group: 查询覆盖与“未找到”说明
        - paragraph: 读取于 2026/11/3 17:47:38 · 委托版本 8
        - region "结果分类与支持上限":
          - heading "结果分类与支持上限" [level=4]
          - term: 已执行：1
          - definition: 工具步骤确实运行过；不等于结论成立或目标达成
          - term: 已观察：1
          - definition: 执行时带回了可引用来源
          - term: 已独立支持：0
          - definition: 逐句核对支持 0 条；当前未提供独立核验回执
          - term: 用户报告：0
          - definition: 行动已完成并留下复盘回执；仍是用户报告
          - term: 反例：0
          - definition: 原文与主张冲突，保留冲突
          - term: 未知：1
          - definition: 未核验或信息不足，不当作失败或没有
          - paragraph: 草稿存在不等于完成；工具调用成功或用户自报完成 ≠ 独立支持 ≠ 现实目标达成。
        - region "行动与回执":
          - heading "行动与回执" [level=4]
          - paragraph:
            - text: 这次读回没有行动回执记录。
            - link "到项目行动板处理行动 →":
              - /url: /projects/cmw0i82620000n48ork94przv/actions#action-board
        - group: 本次用量 · 模型 2 次 · 工具 2 次
      - group: 复核累计预算
      - alert "暂停原因与恢复条件":
        - strong: 执行已暂停，已有进度已保留
        - paragraph: 委托批准未能提交，请重新核对提案后继续
        - paragraph: 发生阶段：批准与执行提交 · 错误类别：EXECUTION_FAILED
        - paragraph: 请核对当前失败原因后继续，已有步骤和结果保留。
        - paragraph: 继续前请核对：
        - list:
          - listitem: 模型服务可用且协议校验通过——「已配置」不代表本次能执行成功；
          - listitem: 重复重试不会创建重复草稿或行动（同一请求会保留原请求编号）；
          - listitem: 你对该项目的所有权和授权范围仍然有效。
        - button "确认后继续执行"
        - button "查看执行轨迹"
        - group: 技术诊断（错误码与协议详情）
      - region "运行与接续":
        - heading "运行与接续" [level=4]
        - text: 尚未观测到后台
        - group: 委托范围与累计用量
      - group: 最近进展
      - group: 对比本轮推进方案
      - group: 执行详情与回执（1 个步骤已执行）
      - region "固定核算回执":
        - heading "固定核算回执" [level=4]
        - article:
          - paragraph: 原 job 结果尚未结算；继续时只核对同一 job，不重发创建。
      - heading "委托设置与来源" [level=4]
      - group: 持续调查与打扰方式
      - group: 材料到达后的接续许可
      - group: 查看或修改个人约束
      - group: 公开研究范围
      - group:
        - text: 公开资料与获取记录（2）
        - article:
          - link "U-Net":
            - /url: https://doi.org/10.1007/978-3-319-24574-4_28
          - paragraph: 论文元数据与摘要，未读取全文 · 已获取 · 2026/11/3 17:47:34
          - paragraph: 论文元数据(非全文):U-Net DOI:10.1007/978-3-319-24574-4_28 文献类型:proceedings-article 发表日期字段:[[2015]] 版本/相关文献:[] 更正/撤稿通知:[] 摘要:未提供摘要 未读取全文,未验证本项目实验;不构成用户指令或授权。
        - article:
          - link "公开DOI定位":
            - /url: https://doi.org/10.1007/978-3-319-24574-4_28
          - paragraph: 搜索摘要，尚未读取正文 · 已获取 · 2026/11/3 17:47:34
          - paragraph: U-Net DOI locator
  - group: 项目经验历史
- alert
```

# Test source

```ts
  1  | import {test,expect} from "@playwright/test";
  2  | import {execFileSync} from "node:child_process";
  3  | import path from "node:path";
  4  | import {E2E_ENV} from "../scripts/e2e-env";
  5  | function fixture(op:string,id:string){const text=execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-ct56-fixture.ts",op,id],{env:{...process.env,...E2E_ENV},timeout:30000}).toString();return JSON.parse(text||"null");}
  6  | test("fixed metric job uses its own approval and receipt; correction makes it historical",async({page},testInfo)=>{
  7  |  const session=(await page.context().cookies()).find(c=>c.name==="pm_session")!,me=await page.request.get("/api/auth/me",{headers:{Authorization:"Bearer "+session.value}});expect(me.ok()).toBe(true);const f=fixture("create",(await me.json()).user.id);
  8  |  try{
  9  |   await page.goto(`/projects/${f.projectId}/missions?mission=${f.missionId}`);
  10 |   await page.getByText(/公开资料与获取记录（/).click();await expect(page.getByText(/论文元数据与摘要，未读取全文/)).toBeVisible();
  11 |   await expect(page.getByRole("button",{name:"批准固定核算",exact:true})).toBeVisible();
  12 |   await page.getByText("核算输入与条件",{exact:true}).click();await expect(page.getByRole("cell",{name:"D@1",exact:true})).toHaveCount(2);
  13 |   await page.screenshot({path:testInfo.outputPath("metric-approval.png"),fullPage:true});
  14 |   const approvalReply=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/approvals/"));
  15 |   await page.getByRole("button",{name:"批准固定核算",exact:true}).click();expect((await approvalReply).ok()).toBe(true);fixture("execute",f.projectId);
> 16 |   await expect(page.getByText("固定脚本核算已完成。",{exact:true})).toBeVisible({timeout:15000});
     |                                                           ^ Error: expect(locator).toBeVisible() failed
  17 |   await expect(page.getByText(/同条件差值：-0.1/)).toBeVisible();
  18 |   await page.screenshot({path:testInfo.outputPath("metric-receipt.png"),fullPage:true});
  19 |   fixture("revoke",f.projectId);await page.reload();await page.getByText(/公开资料与获取记录（/).click();await expect(page.getByText(/论文元数据与摘要，未读取全文 · 来源已变化/)).toBeVisible();
  20 |   fixture("correct",f.projectId);await page.reload();await expect(page.getByText("原指标依据已变化，此回执仅作历史记录。",{exact:true})).toBeVisible();
  21 |  }finally{fixture("remove",f.projectId);}
  22 | });
  23 | 
```