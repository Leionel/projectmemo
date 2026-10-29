# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pre-r4-ux.spec.ts >> first material leads to an explicitly authorized Mission; multiple waiting tasks remain reachable
- Location: e2e\pre-r4-ux.spec.ts:8:1

# Error details

```
Test timeout of 150000ms exceeded.
```

```
Error: locator.click: Test timeout of 150000ms exceeded.
Call log:
  - waiting for getByRole('region', { name: '问忆程', exact: true }).getByRole('button', { name: '核对阶段汇报的资料范围', exact: true }).last().locator('..').getByRole('button', { name: '在此协作', exact: true })

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
    - generic [ref=e47]:
      - generic [ref=e48]:
        - generic [ref=e49]:
          - paragraph [ref=e50]: 我的工作台 / 焦点
          - heading "今日项目焦点" [level=1] [ref=e51]
        - link "全部项目" [ref=e52] [cursor=pointer]:
          - /url: /projects
          - text: 全部项目
          - img [ref=e53]
      - generic [ref=e55]:
        - complementary "项目焦点" [ref=e56]:
          - generic [ref=e57]:
            - generic [ref=e58]:
              - generic [ref=e59]: 等待补充信息
              - generic [ref=e60]: 端侧视觉实验：长标题与跨天委托接续验证项目
            - heading "核对阶段汇报的资料范围" [level=2] [ref=e61]
            - paragraph [ref=e62]: 请确认本次汇报覆盖的时间范围
            - generic [ref=e63]:
              - button "和忆程讨论" [ref=e64]:
                - img [ref=e65]
                - text: 和忆程讨论
              - link "查看原始依据" [ref=e67] [cursor=pointer]:
                - /url: /projects/cmvsx59op009gvg8ohaopl5ml/missions?mission=cmvsx5d9d009qvg8o8m5wziso
                - text: 查看原始依据
                - img [ref=e68]
          - generic [ref=e70]:
            - generic [ref=e71]:
              - paragraph [ref=e72]:
                - img [ref=e73]
                - text: 需要回应
              - strong [ref=e76]: "2"
            - generic [ref=e77]:
              - paragraph [ref=e78]:
                - img [ref=e79]
                - text: 主动提醒
              - strong [ref=e81]: "5"
            - generic [ref=e82]:
              - paragraph [ref=e83]:
                - img [ref=e84]
                - text: 正在接续
              - strong [ref=e87]: "2"
          - generic [ref=e88]:
            - generic [ref=e89]:
              - heading "项目焦点" [level=2] [ref=e90]
              - generic [ref=e91]:
                - button "全部" [pressed] [ref=e92]
                - button "待回应" [ref=e93]
                - button "推进中" [ref=e94]
            - article [ref=e95]:
              - img [ref=e97]
              - generic [ref=e99]:
                - paragraph [ref=e100]:
                  - text: 端侧视觉实验：长标题与跨天委托接续验证项目
                  - generic [ref=e101]: 需要你判断
                - heading "核对阶段汇报的资料范围" [level=3] [ref=e102]
                - paragraph [ref=e103]: 请确认本次汇报覆盖的时间范围
                - button "与忆程讨论" [ref=e104]:
                  - text: 与忆程讨论
                  - img [ref=e105]
            - article [ref=e107]:
              - img [ref=e109]
              - generic [ref=e111]:
                - paragraph [ref=e112]:
                  - text: 端侧视觉实验：长标题与跨天委托接续验证项目
                  - generic [ref=e113]: 需要你判断
                - heading "根据本项目已有材料，形成带来源的阶段汇报草稿，包括已完成事项、当前风险和下一步建议。缺少依据的内容列为信息缺口，不编造实验指标。本次只读取、分析和保存草稿，不搜索网络，不创建或修改行动。" [level=3] [ref=e114]
                - paragraph [ref=e115]: 请补充实验设备与统计口径
                - button "与忆程讨论" [ref=e116]:
                  - text: 与忆程讨论
                  - img [ref=e117]
            - article [ref=e119]:
              - img [ref=e121]
              - generic [ref=e123]:
                - paragraph [ref=e124]:
                  - text: 人工智能创意赛 忆程 ProjectMemo 作品开发
                  - generic [ref=e125]: 主动提醒
                - heading "交付物【参赛答辩 PPT 与材料大纲】存在证据缺口" [level=3] [ref=e126]
                - paragraph [ref=e127]: 里程碑【初赛作品材料提交与证据锁定】中的关键交付物要求具备相应支撑证据，目前尚缺少：requirement、reflection。建议立即补充相应记录。
                - button "与忆程讨论" [ref=e128]:
                  - text: 与忆程讨论
                  - img [ref=e129]
            - article [ref=e131]:
              - img [ref=e133]
              - generic [ref=e135]:
                - paragraph [ref=e136]:
                  - text: 人工智能创意赛 忆程 ProjectMemo 作品开发
                  - generic [ref=e137]: 主动提醒
                - heading "交付物【理论背景与文献创新点沉淀】存在证据缺口" [level=3] [ref=e138]
                - paragraph [ref=e139]: 里程碑【初赛作品材料提交与证据锁定】中的关键交付物要求具备相应支撑证据，目前尚缺少：paper_note。建议立即补充相应记录。
                - button "与忆程讨论" [ref=e140]:
                  - text: 与忆程讨论
                  - img [ref=e141]
            - article [ref=e143]:
              - img [ref=e145]
              - generic [ref=e147]:
                - paragraph [ref=e148]:
                  - text: 人工智能创意赛 忆程 ProjectMemo 作品开发
                  - generic [ref=e149]: 主动提醒
                - heading "交付物【算法方案与消融实验记录】存在证据缺口" [level=3] [ref=e150]
                - paragraph [ref=e151]: 里程碑【初赛作品材料提交与证据锁定】中的关键交付物要求具备相应支撑证据，目前尚缺少：experiment_log、code_issue。建议立即补充相应记录。
                - button "与忆程讨论" [ref=e152]:
                  - text: 与忆程讨论
                  - img [ref=e153]
            - article [ref=e155]:
              - img [ref=e157]
              - generic [ref=e161]:
                - paragraph [ref=e162]:
                  - text: E2E Mission 1793240549914
                  - generic [ref=e163]: 正在接续
                - heading "引用已归入成果准备后续汇报" [level=3] [ref=e164]
                - button "与忆程讨论" [ref=e165]:
                  - text: 与忆程讨论
                  - img [ref=e166]
            - article [ref=e168]:
              - img [ref=e170]
              - generic [ref=e174]:
                - paragraph [ref=e175]:
                  - text: F2 方案接续 1793240541549
                  - generic [ref=e176]: 正在接续
                - heading "核对部署证据" [level=3] [ref=e177]
                - button "与忆程讨论" [ref=e178]:
                  - text: 与忆程讨论
                  - img [ref=e179]
            - article [ref=e181]:
              - img [ref=e183]
              - generic [ref=e186]:
                - paragraph [ref=e187]:
                  - text: 人工智能创意赛 忆程 ProjectMemo 作品开发
                  - generic [ref=e188]: 下一步行动
                - heading "提炼本条记录中的关键决策" [level=3] [ref=e189]
                - paragraph [ref=e190]: 来自知识卡片《已完成演示闭环并记录验证结果》
                - button "与忆程讨论" [ref=e191]:
                  - text: 与忆程讨论
                  - img [ref=e192]
            - article [ref=e194]:
              - img [ref=e196]
              - generic [ref=e199]:
                - paragraph [ref=e200]:
                  - text: E2E Mission 1793240549914
                  - generic [ref=e201]: 下一步行动
                - heading "核对实验条件后确认汇报" [level=3] [ref=e202]
                - button "与忆程讨论" [ref=e203]:
                  - text: 与忆程讨论
                  - img [ref=e204]
        - region "问忆程" [ref=e207]:
          - generic [ref=e208]:
            - generic [ref=e209]:
              - img [ref=e211]
              - generic [ref=e214]:
                - heading "与忆程协作" [level=2] [ref=e215]
                - paragraph [ref=e216]: 项目记忆 · 对话与接续
            - generic [ref=e217]:
              - combobox "选择讨论" [ref=e218]:
                - option "选择讨论" [disabled]
                - option "F2 方案接续 17 · 查已有证据"
                - option "先处理“Focus 协作 1793240535609”最重要的待办。" [selected]
                - option "新讨论"
                - option "新讨论"
                - option "当前有哪些待办？"
                - option "文件指引测试 179 · 实验部署记录还需要核对什么？"
                - option "人工智能创意赛 忆程 · 当前进展如何？"
              - button "新讨论" [ref=e219]:
                - img [ref=e220]
          - generic [ref=e221]:
            - article [ref=e222]:
              - generic [ref=e223]:
                - strong [ref=e224]: 你
                - generic [ref=e225]: 我
              - paragraph [ref=e226]: 帮我先处理“Focus 协作 1793240535609”最重要的待办。
            - article [ref=e227]:
              - generic [ref=e228]:
                - generic [ref=e229]: 忆
                - strong [ref=e230]: 忆程
                - generic [ref=e231]: 规则观察
              - paragraph [ref=e232]: Focus 协作 1793240535609：当前有 0 项未完成行动、0 项待回应委托。 当前是规则观察，尚未进行模型优先级判断。可选择项目继续，或明确补充重要性与投入。
              - group [ref=e233]:
                - generic "优先级依据与取舍" [ref=e234] [cursor=pointer]
              - group [ref=e235]:
                - generic "来源与观察范围（1）" [ref=e236] [cursor=pointer]
              - generic [ref=e238]:
                - button "Focus 协作 1793240535609" [ref=e239]
                - link "查看项目 ↗" [ref=e240] [cursor=pointer]:
                  - /url: /projects/cmvsx44sr007bvg8off222hlg/knowledge?conversation=cmvsx45hy007dvg8o40gkdcg7&originMessage=cmvsx45ur007jvg8o0iek0bf5
              - region "行动提案" [ref=e241]:
                - generic [ref=e242]:
                  - generic [ref=e243]: 已写入原项目
                  - generic [ref=e244]: Focus 协作 1793240535609
                - strong [ref=e245]: 核对“Focus 协作 1793240535609”的下一步
                - paragraph [ref=e246]: 帮我先处理“Focus 协作 1793240535609”最重要的待办。
                - paragraph [ref=e247]:
                  - text: 已创建行动 · 已完成
                  - link "查看原结果" [ref=e248] [cursor=pointer]:
                    - /url: /projects/cmvsx44sr007bvg8off222hlg/actions?conversation=cmvsx45hy007dvg8o40gkdcg7&originMessage=cmvsx45ur007jvg8o0iek0bf5#action-cmvsx463f007kvg8oijj3a49i
                  - button "记录与查看结果" [ref=e249]
                  - generic [ref=e250]: 复盘已保存 · 5cd4f299-fe56-4fce-a9f6-ec7a11449fe3
              - button "追问" [ref=e251]:
                - img [ref=e252]
                - text: 追问
            - article [ref=e255]:
              - generic [ref=e256]:
                - generic [ref=e257]: 忆
                - strong [ref=e258]: 忆程
                - generic [ref=e259]: 项目记录
              - paragraph [ref=e260]: 请核对后确认。
              - region "行动提案" [ref=e261]:
                - generic [ref=e262]:
                  - generic [ref=e263]: 已写入原项目
                  - generic [ref=e264]: Focus 协作 1793240535609
                - strong [ref=e265]: 完成行动并保存复盘：核对“Focus 协作 1793240535609”的下一步
                - paragraph [ref=e266]: 核对了实验资料与部署条件，本轮检查通过，真机测试仍待补充。
                - paragraph [ref=e267]:
                  - text: 已提交原操作 · 已完成
                  - link "查看原结果" [ref=e268] [cursor=pointer]:
                    - /url: /projects/cmvsx44sr007bvg8off222hlg/actions?conversation=cmvsx45hy007dvg8o40gkdcg7&originMessage=cmvsx486m007svg8os5uoufla#action-cmvsx463f007kvg8oijj3a49i
                  - button "记录与查看结果" [ref=e269]
                  - generic [ref=e270]: 复盘已保存 · 5cd4f299-fe56-4fce-a9f6-ec7a11449fe3
              - button "追问" [ref=e271]:
                - img [ref=e272]
                - text: 追问
            - article [ref=e275]:
              - generic [ref=e276]:
                - generic [ref=e277]: 忆
                - strong [ref=e278]: 忆程
                - generic [ref=e279]: 项目记录
              - paragraph [ref=e280]: 行动已完成，复盘已保存：5cd4f299-fe56-4fce-a9f6-ec7a11449fe3
              - button "追问" [ref=e281]:
                - img [ref=e282]
                - text: 追问
            - article [ref=e285]:
              - generic [ref=e286]:
                - strong [ref=e287]: 你
                - generic [ref=e288]: 我
              - paragraph [ref=e289]: 请先调查“核对阶段汇报的资料范围”的依据和下一步。
            - article [ref=e290]:
              - generic [ref=e291]:
                - generic [ref=e292]: 忆
                - strong [ref=e293]: 忆程
                - generic [ref=e294]: 规则观察
              - paragraph [ref=e295]: 端侧视觉实验：长标题与跨天委托接续验证项目：当前有 0 项未完成行动、2 项待回应委托。 当前是规则观察，尚未进行模型优先级判断。可选择项目继续，或明确补充重要性与投入。
              - group [ref=e296]:
                - generic "优先级依据与取舍" [ref=e297] [cursor=pointer]
              - group [ref=e298]:
                - generic "来源与观察范围（2）" [ref=e299] [cursor=pointer]
              - generic [ref=e300]:
                - generic [ref=e301]:
                  - button "核对阶段汇报的资料范围" [ref=e302]
                  - link "查看委托 ↗" [ref=e303] [cursor=pointer]:
                    - /url: /projects/cmvsx59op009gvg8ohaopl5ml/missions?mission=cmvsx5d9d009qvg8o8m5wziso&conversation=cmvsx45hy007dvg8o40gkdcg7&originMessage=cmvsx5hzf00a1vg8obaluols6
                  - button "在此协作" [ref=e304]
                - generic [ref=e305]:
                  - button "端侧视觉实验：长标题与跨天委托接续验证项目" [ref=e306]
                  - link "查看项目 ↗" [ref=e307] [cursor=pointer]:
                    - /url: /projects/cmvsx59op009gvg8ohaopl5ml/knowledge?conversation=cmvsx45hy007dvg8o40gkdcg7&originMessage=cmvsx5hzf00a1vg8obaluols6
                - generic [ref=e308]:
                  - button "根据本项目已有材料，形成带来源的阶段汇报草稿，包括已完成事项、当前风险和下一步建议。缺少依据的内容列为信息缺口，不编造实验指标。本次只读取、分析和保存草稿，不搜索网络，不创建或修改行动。" [ref=e309]
                  - link "查看委托 ↗" [ref=e310] [cursor=pointer]:
                    - /url: /projects/cmvsx59op009gvg8ohaopl5ml/missions?mission=cmvsx5blu009ovg8o279eu1bh&conversation=cmvsx45hy007dvg8o40gkdcg7&originMessage=cmvsx5hzf00a1vg8obaluols6
                  - button "在此协作" [ref=e311]
              - button "追问" [ref=e312]:
                - img [ref=e313]
                - text: 追问
          - generic [ref=e316]:
            - region "当前工作与接续" [ref=e317]:
              - button "调整当前方向" [ref=e318]
              - paragraph [ref=e319]:
                - button "核对阶段汇报的资料范围" [ref=e320]
                - text: · 等你接续
              - paragraph [ref=e321]:
                - button "根据本项目已有材料，形成带来源的阶段汇报草稿，包括已完成事项、当前风险和下一步建议。缺少依据的内容列为信息缺口，不编造实验指标。本次只读取、分析和保存草稿，不搜索网络，不创建或修改行动。" [ref=e322]
                - text: · 等你接续
            - button "联网研究" [ref=e324]
            - textbox "与忆程讨论项目" [ref=e326]:
              - /placeholder: 问忆程：先做什么？或请帮我继续…
            - generic [ref=e327]:
              - generic "长按查看资料使用说明" [ref=e328]:
                - checkbox "允许云模型使用本次授权项目资料" [disabled] [ref=e329]
                - text: 本地整理
              - generic [ref=e330]:
                - combobox "讨论项目范围" [ref=e332]:
                  - option "跨项目"
                  - option "Focus 协作 1793240535609"
                  - option "端侧视觉实验：长标题与跨天委托接续验证项目" [selected]
                - button "项目偏好" [ref=e333]
              - button "发送" [disabled] [ref=e334]:
                - img [ref=e335]
  - alert [ref=e337]
```

# Test source

```ts
  1  | import {test,expect} from "@playwright/test";
  2  | import {execFileSync} from "node:child_process";
  3  | import path from "node:path";
  4  | import {E2E_ENV} from "../scripts/e2e-env";
  5  | function ask(id:string,question:string){
  6  |  execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-mission-fixture.ts","slice",id,JSON.stringify({kind:"ask",question,missing:"PRIVATE"})],{env:{...process.env,...E2E_ENV},timeout:30000,stdio:"pipe"});
  7  | }
  8  | test("first material leads to an explicitly authorized Mission; multiple waiting tasks remain reachable",async({page})=>{
  9  |  test.setTimeout(150000);
  10 |  await page.goto("/projects/new");
  11 |  await page.getByLabel("项目名称").fill("端侧视觉实验：长标题与跨天委托接续验证项目");
  12 |  await page.getByLabel("项目描述").fill("验证真实资料、证据边界和持续委托的隔离测试项目。");
  13 |  await page.getByLabel("项目目标").fill("核对性能实验口径，准备阶段汇报");
  14 |  await page.getByRole("button",{name:"创建项目并开始沉淀"}).click();
  15 |  await expect(page).toHaveURL(/\/projects\/(?!new)[^/?#]+$/);const base=new URL(page.url()).pathname;
  16 |  const focus=page.getByRole("region",{name:"当前最重要的事项"});
  17 |  await expect(focus.getByRole("link",{name:"记录第一条资料"})).toBeVisible();
  18 |  await page.screenshot({path:"test-results/pre-r4-followup-empty.png",fullPage:true,animations:"disabled"});
  19 |  await focus.getByRole("link",{name:"记录第一条资料"}).click();
  20 |  await page.getByLabel("碎片内容").fill("实验记录：今天完成一次端侧推理测量，P95 为118ms；设备和热机条件仍待补充。这是原始观察，尚未确认能否与目标45ms直接比较。");
  21 |  await page.getByRole("button",{name:"保存记录并生成知识卡"}).click();await expect(page.getByText(/已生成/)).toBeVisible();
  22 |  await page.goto(base);await expect(page.getByRole("region",{name:"从资料继续推进"})).toBeVisible();
  23 |  await page.getByRole("link",{name:"委托下一个目标"}).click();
  24 |  await page.getByRole("button",{name:"使用阶段汇报模板"}).click();
  25 |  await expect(page.getByRole("checkbox",{name:/仅允许读取、分析和保存草稿/})).toBeChecked();
  26 |  await expect(page.getByRole("checkbox",{name:/允许配置的云模型/})).not.toBeChecked();
  27 |  const created=page.waitForResponse(r=>r.url().endsWith("/api/missions")&&r.request().method()==="POST");
  28 |  await page.getByRole("button",{name:"创建委托",exact:true}).click();const first=(await(await created).json()).mission.id;
  29 |  ask(first,"请补充实验设备与统计口径");
  30 |  await page.getByText("委托新目标",{exact:true}).click();
  31 |  await page.getByRole("textbox",{name:"想推进什么"}).fill("核对阶段汇报的资料范围");
  32 |  const secondCreated=page.waitForResponse(r=>r.url().endsWith("/api/missions")&&r.request().method()==="POST");
  33 |  await page.getByRole("button",{name:"创建委托",exact:true}).click();
  34 |  const second=(await(await secondCreated).json()).mission.id;ask(second,"请确认本次汇报覆盖的时间范围");
  35 |  await page.goto(base);
  36 |  await expect(page.getByRole("region",{name:"当前最重要的事项"})).toHaveCount(1);
  37 |  await expect(page.getByRole("region",{name:"需要你处理"})).toBeVisible();
  38 |  await expect(page.getByRole("region",{name:"从资料继续推进"})).toHaveCount(0);
  39 |  await expect(page.getByRole("region",{name:"当前最重要的事项"}).getByRole("link").first()).toHaveAttribute("href",new RegExp("mission="));
  40 |  await page.setViewportSize({width:1440,height:980});await page.screenshot({path:"test-results/pre-r4-followup-home-desktop.png",fullPage:true,animations:"disabled"});
  41 |  await page.setViewportSize({width:390,height:844});await expect(focus.getByRole("link").first()).toBeInViewport();
  42 |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  43 |  await page.screenshot({path:"test-results/pre-r4-followup-home-mobile.png",fullPage:true,animations:"disabled"});
  44 |  await focus.getByRole("link").first().focus();await expect(focus.getByRole("link").first()).toBeFocused();
  45 |  await focus.getByRole("link").first().press("Enter");await expect(page.getByRole("region",{name:"待补充信息"})).toBeVisible();
  46 |  await page.screenshot({path:"test-results/pre-r4-followup-mission-mobile.png",fullPage:true,animations:"disabled"});
  47 |  await page.goto(`${base}/health#project-evolution`);await page.getByRole("button",{name:"查看结论与关系记录"}).click();
  48 |  await expect(page.getByRole("region",{name:"项目结论演进"}).getByText("实验记录",{exact:false}).first()).toBeVisible();
  49 |  await page.setViewportSize({width:1440,height:980});await page.screenshot({path:"test-results/pre-r4-followup-evolution.png",fullPage:true,animations:"disabled"});
  50 |  await page.goto("/focus");
  51 |  if(process.env.FOCUS_AGENT_ENABLED==="true"){
  52 |    const waitingFocus=page.getByRole("complementary",{name:"项目焦点",exact:true});
  53 |    const item=waitingFocus.locator("article").filter({has:page.getByRole("heading",{name:"核对阶段汇报的资料范围",exact:true})});
  54 |    await expect(item.getByText("需要你判断",{exact:true})).toBeVisible();
  55 |    await item.getByRole("button",{name:"与忆程讨论",exact:true}).click();
  56 |    const discussion=page.getByRole("region",{name:"问忆程",exact:true});
  57 |    await expect(discussion.getByText("正在读取讨论…")).toHaveCount(0);
  58 |    if(await discussion.getByRole("button",{name:"开始讨论",exact:true}).isVisible())await discussion.getByRole("button",{name:"开始讨论",exact:true}).click();
  59 |    const input=discussion.getByRole("textbox",{name:"与忆程讨论项目"});
  60 |    await expect(input).toHaveValue(/核对阶段汇报的资料范围/);
  61 |    const send=discussion.getByRole("button",{name:"发送",exact:true});await expect(send).toBeEnabled();await send.click();
  62 |    await expect(input).toHaveValue("");
  63 |    const source=discussion.getByRole("button",{name:"核对阶段汇报的资料范围",exact:true}).last();await expect(source).toBeVisible();
> 64 |    await source.locator("..").getByRole("button",{name:"在此协作",exact:true}).click();
     |                                                                            ^ Error: locator.click: Test timeout of 150000ms exceeded.
  65 |    await expect(discussion.getByRole("region",{name:"原任务协作",exact:true})).toContainText("核对阶段汇报的资料范围");
  66 |  }else{
  67 |    const waitingFocus=page.getByRole("region",{name:"需要回应的委托"});
  68 |    await expect(waitingFocus.getByText("等待补充信息",{exact:true}).first()).toBeVisible();
  69 |    await expect(waitingFocus.getByRole("link",{name:"补充委托资料"}).first()).toHaveAttribute("href",/\/missions\?mission=/);
  70 |    await expect(page.getByRole("region",{name:"当前范围概览"})).toBeVisible();
  71 |    await expect(page.getByRole("region",{name:"最近保存的资料"})).toBeVisible();
  72 |    await expect(page.getByRole("complementary",{name:"有效提醒"})).toBeVisible();
  73 |  }
  74 |  await page.screenshot({path:"test-results/projectmemo-focus-desktop.png",fullPage:true,animations:"disabled"});
  75 |  await page.getByRole("button",{name:"切换深浅色主题"}).click();
  76 |  await page.screenshot({path:"test-results/projectmemo-focus-dark.png",fullPage:true,animations:"disabled"});
  77 |  await page.setViewportSize({width:390,height:844});
  78 |  await page.getByLabel("打开全局导航").click();
  79 |  const globalMenu=page.locator("header").first();
  80 |  await expect(globalMenu.getByRole("link",{name:"焦点",exact:true})).toHaveAttribute("aria-current","page");
  81 |  await globalMenu.getByRole("link",{name:"焦点",exact:true}).click();
  82 |  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  83 |  await page.screenshot({path:"test-results/projectmemo-focus-mobile.png",fullPage:true,animations:"disabled"});
  84 |
  85 | });
  86 |
```
