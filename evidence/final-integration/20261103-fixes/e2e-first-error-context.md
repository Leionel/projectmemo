# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: missions.spec.ts >> same Mission survives reload, receives metric, auto continues, waits for approval and adopts a reusable draft
- Location: e2e\missions.spec.ts:12:1

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for locator('#mission-agent').getByRole('region', { name: '原任务与完成回执' }).getByText(/^本次用量 · 模型/)

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "跳到主要内容" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "忆程 ProjectMemo 首页" [ref=e5] [cursor=pointer]:
        - /url: /
        - generic [ref=e6]: 忆程 ProjectMemo
        - generic [ref=e7]: MEMORY AGENT
      - navigation [ref=e8]:
        - generic [ref=e9]: 演示模式
        - generic [ref=e11]:
          - generic [ref=e12]:
            - link "焦点" [ref=e13] [cursor=pointer]:
              - /url: /focus
              - img [ref=e14]
              - text: 焦点
            - link "项目" [ref=e19] [cursor=pointer]:
              - /url: /projects
              - img [ref=e20]
              - text: 项目
            - link "记忆" [ref=e22] [cursor=pointer]:
              - /url: /memory
              - img [ref=e23]
              - text: 记忆
            - link "行动" [ref=e25] [cursor=pointer]:
              - /url: /actions
              - img [ref=e26]
              - text: 行动
          - button "全局设置" [ref=e30]:
            - img [ref=e31]
            - text: 设置
          - button "切换深浅色主题" [ref=e34]:
            - img [ref=e36]
          - button "E2E 评审身份" [ref=e40]:
            - img [ref=e42]
            - generic [ref=e45]: E2E 评审身份
  - main [ref=e46]:
    - link "返回项目列表" [ref=e47] [cursor=pointer]:
      - /url: /projects
      - img [ref=e48]
      - text: 返回项目列表
    - generic [ref=e50]:
      - generic [ref=e51]:
        - generic [ref=e52]:
          - generic [ref=e53]: 学科竞赛
          - generic [ref=e54]: 更新于 2026/11/3
        - heading "E2E Mission 1793698898022" [level=1] [ref=e55]
        - group [ref=e56]:
          - generic "项目目标与简介" [ref=e57] [cursor=pointer]
      - button "编辑项目" [ref=e59]:
        - img [ref=e60]
        - text: 编辑项目
    - generic [ref=e63]:
      - generic [ref=e64]:
        - navigation "项目主要导航" [ref=e65]:
          - link "概览" [ref=e66] [cursor=pointer]:
            - /url: /projects/cmw0i0fy5005cao8o6dvrayfy
            - img [ref=e67]
            - generic [ref=e72]: 概览
          - link "委托" [ref=e73] [cursor=pointer]:
            - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/missions
            - img [ref=e74]
            - generic [ref=e77]: 委托
          - link "资料" [ref=e78] [cursor=pointer]:
            - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/records
            - img [ref=e79]
            - generic [ref=e82]: 资料
          - link "行动" [ref=e83] [cursor=pointer]:
            - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/actions
            - img [ref=e84]
            - generic [ref=e87]: 行动
          - link "成果" [ref=e88] [cursor=pointer]:
            - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/generate
            - img [ref=e89]
            - generic [ref=e94]: 成果
        - group [ref=e95]:
          - generic "项目功能" [ref=e96] [cursor=pointer]
      - generic [ref=e97]:
        - region "项目关联讨论" [ref=e98]:
          - button "打开项目讨论" [ref=e99]
        - generic [ref=e100]:
          - heading "长期委托" [level=2] [ref=e101]
          - paragraph [ref=e102]: 委托目标、执行进度和成果草稿
        - generic [ref=e103]:
          - region "长期项目委托" [ref=e104]:
            - generic [ref=e105]:
              - generic [ref=e106]:
                - heading "长期项目委托" [level=2] [ref=e107]
                - paragraph [ref=e108]: 交给 Agent 一个目标，在同一委托中持续推进、补充材料和审阅成果。
              - generic [ref=e109]: 已加载 1 项委托
            - status [ref=e110]:
              - text: 审批已记录，执行结果以原步骤回执为准。
              - button "收起操作回执" [ref=e111] [cursor=pointer]: 收起
            - generic [ref=e112]:
              - complementary "委托列表与创建" [ref=e113]:
                - group [ref=e114]:
                  - generic "委托新目标" [ref=e115] [cursor=pointer]
                - navigation "已有委托" [ref=e116]:
                  - heading "已有委托" [level=3] [ref=e117]
                  - button "跨时间准备10月实验汇报 · 委托条件已验收" [pressed] [ref=e118] [cursor=pointer]:
                    - generic [ref=e119]: 跨时间准备10月实验汇报
                    - generic [ref=e120]: 委托条件已验收
              - group [ref=e123]:
                - generic [ref=e124]:
                  - generic [ref=e125]:
                    - generic [ref=e126]: 已结束
                    - generic [ref=e127]: 3 个步骤已执行 · 1 份草稿
                  - link "调整当前重点／继续讨论" [ref=e128] [cursor=pointer]:
                    - /url: /focus?entryKind=MISSION&entryId=cmw0i0gng005gao8oibti7isb&entryProject=cmw0i0fy5005cao8o6dvrayfy
                  - heading "跨时间准备10月实验汇报" [level=3] [ref=e129]
                  - status [ref=e130]: 委托完成条件已通过，现实效果以原结果为准
                  - group [ref=e131]:
                    - generic "成果核验与现实结果" [ref=e132] [cursor=pointer]
                    - generic "完成与核验" [ref=e133]:
                      - generic [ref=e134]:
                        - term [ref=e135]: 执行条件
                        - definition [ref=e136]: 已通过本委托设定的条件
                      - generic [ref=e137]:
                        - term [ref=e138]: 草稿核验
                        - definition [ref=e139]: 待审阅，尚未整体核验
                      - generic [ref=e140]:
                        - term [ref=e141]: 用户采纳
                        - definition [ref=e142]: 已确认归入 1 份项目成果
                      - generic [ref=e143]:
                        - term [ref=e144]: 现实完成
                        - definition [ref=e145]: 未从委托状态推断，以实际行动回执为准
                  - generic "暂停与取消"
                - region "原任务当前工作包与完成回执" [ref=e146]:
                  - button "重新读取状态与回执" [ref=e147] [cursor=pointer]
                  - region "原任务四问工作包" [ref=e148]:
                    - generic [ref=e149]:
                      - button "查看原结果" [ref=e150] [cursor=pointer]
                      - paragraph [ref=e151]: 只做页面内定位或重新读取；不提交批准、执行或创建替代任务。
                    - generic [ref=e152]:
                      - region "做到哪" [ref=e153]:
                        - heading "做到哪" [level=4] [ref=e154]
                        - list [ref=e155]:
                          - listitem [ref=e156]:
                            - generic [ref=e157]: 提议行动
                            - generic [ref=e158]: 已执行 · 2026/11/3 17:41:55
                          - listitem [ref=e159]:
                            - generic [ref=e160]: 保存草稿
                            - generic [ref=e161]: 已执行 · 2026/11/3 17:41:49
                          - listitem [ref=e162]:
                            - generic [ref=e163]: 选入补充材料
                            - generic [ref=e164]: 已执行 · 2026/11/3 17:41:46
                        - paragraph [ref=e165]: 最近草稿：修订 1 · 2026/11/3 17:41:49
                        - paragraph [ref=e166]: 已执行 3 · 已观察 1 · 已独立支持 0 · 用户报告 0 · 反例 0 · 未知 1
                        - list [ref=e167]:
                          - listitem [ref=e168]:
                            - generic [ref=e169]: 核对实验条件后确认汇报
                            - generic [ref=e170]: 待处理 · 尚未填写复盘回执
                        - paragraph [ref=e171]: 最近工作只取原 Step/Output/Action/回执的有界窗口；执行成功、草稿存在与行动创建都不等于现实目标达成。
                        - paragraph [ref=e172]: 步骤窗口上限 5 条；窗口内没有记录只表示覆盖不足。
                        - paragraph [ref=e173]: 现实结果：未从委托状态推断（NOT_INFERRED），以原行动回执为准。
                      - region "依据是什么" [ref=e174]:
                        - heading "依据是什么" [level=4] [ref=e175]
                        - paragraph [ref=e176]: 关联原问题：cmw0i0i300002a48ouytuhrc8
                        - paragraph [ref=e177]: 原资料使用 1 项 · 证据审查 0 条
                        - paragraph [ref=e178]: 当前依据可用性已按来源策略判定；历史留痕不等于当前可用。
                        - paragraph [ref=e179]: 依据只取原资料使用与证据审查投影；历史留痕保留原身份，当前可用不等于独立支持。
                        - group [ref=e180]:
                          - generic "展开依据、原文与纠正入口" [ref=e181] [cursor=pointer]
                      - region "为何停下" [ref=e182]:
                        - heading "为何停下" [level=4] [ref=e183]
                        - paragraph [ref=e184]: 当前阶段：已结束 · 原状态：委托条件已验收
                        - paragraph [ref=e185]: 委托完成条件已通过，现实效果以原结果为准（SUCCEEDED）
                        - paragraph [ref=e186]: 无停止请求（原委托已完成；停止请求不再具有执行含义）。
                        - paragraph [ref=e187]: 未结算效果：未记录。
                        - group [ref=e188]:
                          - generic "技术说明（原投影）" [ref=e189] [cursor=pointer]
                      - region "现在等谁" [ref=e190]:
                        - heading "现在等谁" [level=4] [ref=e191]
                        - paragraph [ref=e192]: 等待：不再等待谁
                        - paragraph [ref=e193]: 下一步由谁：无
                        - paragraph [ref=e194]: 下次检查时间：未记录
                        - paragraph [ref=e195]: 有效边界：未记录
                        - paragraph [ref=e196]: 完成条件已通过；现实效果仍以原结果为准。
                    - region "观察时间" [ref=e197]:
                      - heading "观察时间" [level=4] [ref=e198]
                      - generic [ref=e199]:
                        - generic [ref=e200]:
                          - term [ref=e201]: 读取于
                          - definition [ref=e202]: 2026/11/3 17:42:00
                        - generic [ref=e203]:
                          - term [ref=e204]: 最近成功观察
                          - definition [ref=e205]: 尚未有成功观察记录
                        - generic [ref=e206]:
                          - term [ref=e207]: 最近失败观察
                          - definition [ref=e208]: 未记录
                        - generic [ref=e209]:
                          - term [ref=e210]: 观察状态
                          - definition [ref=e211]: 尚未有成功观察记录
                        - generic [ref=e212]:
                          - term [ref=e213]: 下次计划观察
                          - definition [ref=e214]: 未记录
                      - paragraph [ref=e215]: 读取时间只表示本次读取；刷新页面不会推进成功观察，也不表示刚刚核查或资料没有变化。
                    - group [ref=e216]:
                      - generic "责任边界、权限与累计预算" [ref=e217] [cursor=pointer]
                    - group [ref=e218]:
                      - generic "查询覆盖与“未找到”说明" [ref=e219] [cursor=pointer]
                  - paragraph [ref=e220]: 读取于 2026/11/3 17:42:00 · 委托版本 14
                  - region "结果分类与支持上限" [ref=e221]:
                    - heading "结果分类与支持上限" [level=4] [ref=e222]
                    - generic "服务端原结果分类" [ref=e223]:
                      - generic [ref=e224]:
                        - term [ref=e225]: 已执行：3
                        - definition [ref=e226]: 工具步骤确实运行过；不等于结论成立或目标达成
                      - generic [ref=e227]:
                        - term [ref=e228]: 已观察：1
                        - definition [ref=e229]: 执行时带回了可引用来源
                      - generic [ref=e230]:
                        - term [ref=e231]: 已独立支持：0
                        - definition [ref=e232]: 逐句核对支持 0 条；当前未提供独立核验回执
                      - generic [ref=e233]:
                        - term [ref=e234]: 用户报告：0
                        - definition [ref=e235]: 行动已完成并留下复盘回执；仍是用户报告
                      - generic [ref=e236]:
                        - term [ref=e237]: 反例：0
                        - definition [ref=e238]: 原文与主张冲突，保留冲突
                      - generic [ref=e239]:
                        - term [ref=e240]: 未知：1
                        - definition [ref=e241]: 未核验或信息不足，不当作失败或没有
                    - paragraph [ref=e242]: 草稿存在不等于完成；工具调用成功或用户自报完成 ≠ 独立支持 ≠ 现实目标达成。
                  - region "行动与回执" [ref=e243]:
                    - heading "行动与回执" [level=4] [ref=e244]
                    - list [ref=e245]:
                      - listitem [ref=e246]:
                        - strong [ref=e247]: 核对实验条件后确认汇报
                        - paragraph [ref=e248]: 尚未开始，未完成
                        - paragraph [ref=e249]:
                          - link "回到原行动填写结果 →" [ref=e250] [cursor=pointer]:
                            - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/actions#action-cmw0i0sob0001xo8o6hi49z52
                  - region "草稿与已采纳成果" [ref=e251]:
                    - heading "草稿与已采纳成果" [level=4] [ref=e252]
                    - paragraph [ref=e253]:
                      - text: 已归入成果：
                      - link "项目周报 · 2026/11/3 17:41:57" [ref=e254] [cursor=pointer]:
                        - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/generate?artifact=cmw0i0uh7005nao8oyis4l3sy&type=weekly_report
                      - text: （来自草稿 1；回执 cmw0i0uha005oao8orzmedud3）
                  - group [ref=e255]:
                    - generic "本次用量 · 模型 4 次 · 工具 2 次" [ref=e256] [cursor=pointer]
                - region "运行与接续" [ref=e257]:
                  - generic [ref=e258]:
                    - heading "运行与接续" [level=4] [ref=e259]
                    - generic [ref=e261]: 尚未观测到后台
                  - group [ref=e262]:
                    - generic "委托范围与累计用量" [ref=e263] [cursor=pointer]
                - group [ref=e264]:
                  - generic "最近进展" [ref=e265] [cursor=pointer]
                - group [ref=e266]:
                  - generic "对比本轮推进方案" [ref=e267] [cursor=pointer]
                - generic "当前目标的一项问题"
                - region "委托成果" [ref=e268]:
                  - heading "成果草稿" [level=4] [ref=e269]
                  - group [ref=e270]:
                    - generic "草稿版本 1 · 内容待审核" [ref=e271] [cursor=pointer]:
                      - heading "草稿版本 1 · 内容待审核" [level=5] [ref=e272]
                    - generic [ref=e273]:
                      - paragraph [ref=e274]: 10月汇报：用户已提供Dice记录，需继续核对实验条件。
                      - generic [ref=e275]: 推断或建议
                    - group [ref=e276]:
                      - generic "逐块核验记录" [ref=e277] [cursor=pointer]
                    - paragraph [ref=e279]:
                      - text: 已归入项目周报，成果编号：cmw0i0uh7005nao8oyis4l3sy ·
                      - link "打开已归入的成果版本" [ref=e280] [cursor=pointer]:
                        - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/generate?type=weekly_report&artifact=cmw0i0uh7005nao8oyis4l3sy
                - group [ref=e281]:
                  - generic "执行详情与回执（3 个步骤已执行）" [ref=e282] [cursor=pointer]
                  - region "执行记录" [ref=e283]:
                    - generic [ref=e284]:
                      - heading "执行记录" [level=4] [ref=e285]
                      - generic [ref=e286]: 3 个步骤已执行
                    - paragraph [ref=e287]: 任务编号：cmw0i0gng005gao8oibti7isb
                    - list [ref=e288]:
                      - listitem [ref=e289]:
                        - generic [ref=e290]: ✓
                        - generic [ref=e292]:
                          - generic [ref=e293]: 选入补充材料
                          - generic [ref=e294]: 已执行
                      - listitem [ref=e295]:
                        - generic [ref=e296]: ✓
                        - generic [ref=e298]:
                          - generic [ref=e299]: 保存草稿
                          - generic [ref=e300]: 已执行
                      - listitem [ref=e301]:
                        - generic [ref=e302]: ✓
                        - generic [ref=e303]:
                          - generic [ref=e304]:
                            - generic [ref=e305]: 提议行动
                            - generic [ref=e306]: 已执行
                          - paragraph [ref=e307]:
                            - link "已创建行动：核对实验条件后确认汇报" [ref=e308] [cursor=pointer]:
                              - /url: /projects/cmw0i0fy5005cao8o6dvrayfy/actions#action-cmw0i0sob0001xo8o6hi49z52
                            - text: （创建回执：待办）
                - generic [ref=e309]:
                  - heading "委托设置与来源" [level=4] [ref=e310]
                  - group [ref=e311]:
                    - generic "持续调查与打扰方式" [ref=e312] [cursor=pointer]
                  - group [ref=e313]:
                    - generic "材料到达后的接续许可" [ref=e314] [cursor=pointer]
                    - generic [ref=e315]:
                      - paragraph [ref=e316]: 当前：允许符合条件后继续读取与分析。
                      - paragraph [ref=e317]: 自动接续只接受字段完全匹配的结构化本项目实验记录，不会自动创建行动或发布成果。
                      - button "撤销自动接续许可" [disabled] [ref=e318]
                  - group [ref=e319]:
                    - generic "查看或修改个人约束" [ref=e320] [cursor=pointer]
                    - option "未设定" [selected]
                    - option "1"
                    - option "2"
                    - option "3"
                    - option "4"
                    - option "5"
                    - option "CNY" [selected]
                    - option "USD"
                    - option "只读取和分析"
                    - option "可提议行动，批准后创建" [selected]
                  - group [ref=e321]:
                    - generic "公开研究范围" [ref=e322] [cursor=pointer]
                  - group [ref=e323]:
                    - generic "公开资料与获取记录（0）" [ref=e324] [cursor=pointer]
          - group [ref=e325]:
            - generic "项目经验历史" [ref=e326] [cursor=pointer]
  - alert [ref=e327]
```

# Test source

```ts
  1  | import {openProjectDirectory,fillManualProjectForm} from "./projectMenu";
  2  | import {test,expect} from "@playwright/test";
  3  | import {E2E_ENV} from "../scripts/e2e-env";
  4  | import {execFileSync} from "node:child_process";
  5  | import path from "node:path";
  6  | type State={status:string;events:Array<{type:string}>;steps:Array<{toolName:string;resultJson:{sources?:Array<{id:string}>}|null}>;actions:Array<{title:string;status:string}>;approvals:Array<{status:string}>;receipt:{artifactId:string;outputId:string}|null};
  7  | function fixture(operation:string,id:string,choice?:import("../lib/mission/contracts").Choice):State{
  8  |  const output=execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-mission-fixture.ts",operation,id,...(choice?[JSON.stringify(choice)]:[])],{env:{...process.env,...E2E_ENV},encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024});return JSON.parse(output);
  9  | }
  10 | async function slice(id:string,choice:import("../lib/mission/contracts").Choice){return fixture("slice",id,choice);}
  11 | async function scan(id:string){return fixture("scan",id);}
  12 | test("same Mission survives reload, receives metric, auto continues, waits for approval and adopts a reusable draft",async({page})=>{
  13 |  test.setTimeout(120000);
  14 |  await page.goto("/projects/new");
  15 |   await fillManualProjectForm(page, {
  16 |     title: `E2E Mission ${Date.now()}`,
  17 |     description: "独立的Mission接续测试项目",
  18 |     goal: "验证接续、批准和成果归入",
  19 |   });await expect(page).toHaveURL(/\/projects\/(?!new)[^/?#]+$/);
  20 |  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"长期委托"}).click();
  21 |  const panel=page.locator("#mission-agent"),goal="跨时间准备10月实验汇报";await panel.getByRole("textbox",{name:"想推进什么"}).fill(goal);await panel.getByRole("checkbox",{name:/允许配置的云模型/}).check();
  22 |  const created=page.waitForResponse(r=>r.url().endsWith("/api/missions")&&r.request().method()==="POST");await panel.getByRole("button",{name:"创建委托",exact:true}).click();const{id}=((await(await created).json()) as {mission:{id:string}}).mission;
  23 |  await slice(id,{kind:"ask",question:"请补充本项目2026-10的Dice百分比",missing:"PRIVATE",requirements:{terms:[],unit:"",period:"",sourceType:"EITHER",metric:{name:"Dice",unit:"%",period:"2026-10"}}});
  24 |  await expect(panel.getByText("请补充本项目2026-10的Dice百分比",{exact:true})).toBeVisible();await page.reload();await panel.getByRole("button",{name:new RegExp(goal+" · 等待补充信息")}).click();await panel.getByText(/执行详情与回执（/).click();await expect(panel.getByText(`任务编号：${id}`,{exact:true})).toBeVisible();
  25 |  await panel.getByText("材料到达后的接续许可",{exact:true}).click();await panel.getByRole("button",{name:"授权满足结构化缺口后自动读取与分析",exact:true}).click();await expect(panel.getByRole("button",{name:"撤销自动接续许可",exact:true})).toBeVisible();
  26 |  await panel.getByRole("spinbutton",{name:"实验指标数值（%）"}).fill("82");await panel.getByRole("button",{name:"保存本项目实验记录",exact:true}).click();await expect(panel.getByText(/已保存实验记录/)).toBeVisible();await scan(id);
  27 |  const state=fixture("state",id);expect(state.status).toBe("READY");expect(state.events.filter(e=>e.type==="AUTO_CONTINUATION_READY")).toHaveLength(1);
  28 |  await slice(id,{kind:"tool",tool:"save_mission_output",args:{blocks:[{blockId:"report",kind:"INFERENCE",text:"10月汇报：用户已提供Dice记录，需继续核对实验条件。",sourceIds:[]}]},summary:"更新汇报"});
  29 |  await expect(panel.getByRole("heading",{name:"草稿版本 1 · 内容待审核"})).toBeVisible();await slice(id,{kind:"tool",tool:"propose_action",args:{title:"核对实验条件后确认汇报",priority:4},summary:"待批准"});await expect(panel.getByText("将创建本项目 1 项待办：核对实验条件后确认汇报",{exact:true})).toBeVisible();expect(fixture("state",id).actions.filter(a=>a.title==="核对实验条件后确认汇报")).toHaveLength(0);
  30 |  await panel.getByRole("button",{name:"批准创建行动",exact:true}).click();await expect.poll(()=>fixture("state",id).approvals.filter(a=>a.status==="APPROVED").length).toBe(1);await slice(id,{kind:"ask",question:"不应在创建片段额外调用模型",missing:"PRIVATE"});await expect(panel.getByRole("link",{name:"已创建行动：核对实验条件后确认汇报"})).toBeVisible();expect(fixture("state",id).actions.filter(a=>a.title==="核对实验条件后确认汇报"&&a.status==="TODO")).toHaveLength(1);
  31 |  await panel.getByRole("button",{name:"预览归入项目周报",exact:true}).click();await expect(panel.getByText("归入只保存成果，不确认项目事实。",{exact:true})).toBeVisible();await panel.getByRole("button",{name:"确认保存并向项目成员共享",exact:true}).click();await expect(panel.getByText(/已归入项目周报，成果编号/)).toBeVisible();const receipt=fixture("state",id).receipt!;
  32 |  await slice(id,{kind:"finish",outputId:receipt.outputId});await expect(panel.getByText("委托条件已验收",{exact:true}).first()).toBeVisible();
  33 |  const readback=panel.getByRole('region',{name:'原任务与完成回执'});
> 34 |  await readback.getByText(/^本次用量 · 模型/).click();
     |                                         ^ Error: locator.click: Test timeout of 120000ms exceeded.
  35 |  await expect(readback.getByText('费用尚不能核算：这些记录未绑定费率与账单。',{exact:true})).toBeVisible();
  36 |  await expect(readback.getByText(/已记录输入 .* token · 输出 .* token/)).toBeVisible();
  37 |  // S2 第二批：调用覆盖说明哪些调用有回执、哪些用量未知，仍不是账单。
  38 |  await expect(readback.getByText(/^可核对调用：模型已检查 \d+ 次/)).toBeVisible();
  39 |  await expect(readback.getByText(/费用与估算保持未知/)).toBeVisible();
  40 |  await readback.screenshot({path:'evidence/s2-usage-coverage/20261102/web-1280.png',animations:'disabled'});
  41 |  await page.setViewportSize({width:390,height:844});
  42 |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  43 |  await readback.screenshot({path:'evidence/s2-usage-coverage/20261102/web-390.png',animations:'disabled'});
  44 |  await page.setViewportSize({width:1280,height:900});
  45 |  await page.screenshot({path:"test-results/pre-r4-mission-continuation-adoption.png",fullPage:true,animations:"disabled"});
  46 |  const missionPath=new URL(page.url()).pathname;
  47 |  await panel.getByRole("link",{name:"打开已归入的成果版本"}).click();
  48 |  await expect(page).toHaveURL(new RegExp(`artifact=${receipt.artifactId}`));
  49 |  await expect(page.getByRole("article",{name:"Markdown 渲染预览"})).toContainText("10月汇报");
  50 |  await page.goto(`${missionPath}?mission=${id}`);await expect(panel.getByText("委托条件已验收",{exact:true}).first()).toBeVisible();
  51 |  await panel.getByText("委托新目标",{exact:true}).click();await panel.getByRole("textbox",{name:"想推进什么"}).fill("引用已归入成果准备后续汇报");const nextCreated=page.waitForResponse(r=>r.url().endsWith("/api/missions")&&r.request().method()==="POST");await panel.getByRole("button",{name:"创建委托",exact:true}).click();const nextResponse=await nextCreated;expect(nextResponse.status()).toBe(202);const next=(await nextResponse.json()).mission;
  52 |  await slice(next.id,{kind:"tool",tool:"search_memory",args:{query:"10月汇报",limit:8},summary:"复用项目成果"});const step=fixture("state",next.id).steps.find(s=>s.toolName==="search_memory")!;expect(step.resultJson?.sources?.some(s=>s.id===`artifact:${receipt.artifactId}`)).toBe(true);
  53 |  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"项目首页",exact:true}).click();
  54 |  await page.locator(`a[href$="mission=${next.id}"]`).first().click();
  55 |  await expect(page).toHaveURL(new RegExp(`/missions\\?mission=${next.id}`));await panel.getByText(/执行详情与回执（/).click();await expect(page.getByText(`任务编号：${next.id}`,{exact:true})).toBeVisible();
  56 |  await page.getByText("项目功能",{exact:true}).click();
  57 |  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"});});
  58 |  await page.screenshot({path:"test-results/pre-r4-mission-desktop.png",fullPage:true,animations:"disabled"});
  59 |  await page.setViewportSize({width:390,height:844});
  60 |  await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"});});
  61 |  await expect(panel.getByRole("heading",{name:"引用已归入成果准备后续汇报",exact:true})).toBeInViewport();
  62 |  await page.screenshot({path:"test-results/pre-r4-mission-mobile.png",fullPage:true,animations:"disabled"});
  63 | });
  64 | 
  65 | 
  66 | 
  67 | 
```