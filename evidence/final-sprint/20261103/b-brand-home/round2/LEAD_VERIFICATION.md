# Track B 第二批收尾：Lead 执行与验证记录（候选 `4b69614`）

- 工作树：`D:/Projects/hongmen-final-b-brand-home` · 分支 `codex/final-b-brand-home`
- 同步方式：从 `abc8bf8` **快进**到主控检查点 `4b696141435825a3582816e8e449c0e0cf013f29`（含 A/B 合入与主控复审修复）；本轮**默认不改官网源码**，候选源码 SHA = `4b69614`。
- 主控已修且本记录复验、不回退：Hero 阶段 chip 随阶段（离开时=无需操作 / 期间=核对示例 / 回来后=等你确认）；HomeMotion 运行时 reduced-motion 热切换 + CSS 兜底。
- 源码冻结：`git status --porcelain -- app components` 为空（仅证据目录与本地录屏派生帧未跟踪）。

## 1. 定向检查（本机实际执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm.cmd exec tsc -- --noEmit` | **exit 0**（同步后） |
| 定向 lint | `npm.cmd exec eslint -- app/page.tsx components/home components/HomeJourney.tsx components/SiteHeader.tsx tests/finalBHomepageInteraction.test.ts` | **exit 0**（0 error；CSS 文件不参与 eslint） |
| 主控 B 组件回归 | `npm.cmd test -- tests/finalBHomepageInteraction.test.ts` | **3/3 pass**（阶段 chip 跟随内容、热切换 reduced-motion 停帧/清视差/恢复） |
| 官网定向 E2E | `PROJECTMEMO_E2E_PORT=33411 npm.cmd run test:e2e -- e2e/demo.spec.ts` | **10 expected / 0 unexpected / 0 flaky / 0 skipped**，exit 0，100.3s；含真实登录态首页 CTA → `/focus`。结构化结果：`round2/e2e-demo-spec-results.json` |

E2E 首次使用默认 33321 端口时发现被同机其他进程占用（未 kill 他人进程），改用 33411 成功。生产构建在 E2E 流程内再次通过（43 页，TypeScript 通过）。

## 2. 浏览器复核（dev 34111，公开示例、mock、无 Worker）

- Hero 三阶段 chip：`离开时 → 无需操作`、`期间 → 核对示例`、`回来后 → 等你确认`（实测 header 文本包含对应状态）。
- 热切换 reduced-motion：`normal → reduce` 后 `main[data-motion]="reduced"`、`--hero-shift=0`、copy/lens `translate: none`、顶部进度线 `scaleX(0)`；`reduce → normal` 后 `data-motion="on"`，滚动后 `--hero-shift` 恢复（0.533）。主控修复有效。
- 页面标题仍为「忆程 ProjectMemo｜人可以下线，项目别掉线。」；Tab 结构含 Hero 3 阶段与五步 5 个 tab。

## 3. 生产模式初步测量（Lead；正式记录由证据轨复核）

环境：`.next-build` 生产构建 + `next start` 本机回环、Chromium headless、1440×900 / 390×844；数字仅本机口径。

| 指标 | 1440 light（cold→warm） | 390 light（warm） | 1440 dark（warm） |
|---|---|---|---|
| TTFB | 1473ms → 55ms | 55ms | 88ms |
| FCP | 1976ms → 596ms | 596ms | 196ms |
| LCP | 3084ms → 684ms | 684ms | 196ms |
| CLS | **0**（0 次 layout-shift） | **0** | **0** |
| 首载请求 | 24 | 24 | 24 |
| 外域 / `/api` 写 | 0 / 0 | 0 / 0 | 0 / 0 |

- 最大首载资源：`/logo.png` **811KB**（显示尺寸约 28px）、JS chunk 224KB(decoded)、Manrope 161KB、PM Editorial 158KB、CSS 70KB。字体均 `loaded`，无字体失败。
- CLS 为 0，未发现字体 swap 引起的布局跳动；因此本轮**不做**为“稳定性”而改版/裁内容，也不为打分换空白首屏。
- 资源结论：`/logo.png`、`pm-serif-brand.ttf` 等为**全站共享资产**（layout header / 账号页 / 品牌链接消费者），按任务书要求先形成资产清单与消费者/许可说明交主控，不擅自改全局资产或编造许可证。官网局部字体（PM Editorial/Manrope）的 subset/预载优化列为候选建议，需与主控确认消费者（账号页也使用 PM Editorial）后另行授权。

## 4. 操作性与说明

- 同步检查点后首次启动 dev 曾出现 Turbopack 缓存导致的 CSS 模块转换 500（`Selector "*" is not pure`），清空本树 `.next` 开发缓存后恢复 200，属于缓存/迁移操作问题，不是产品代码缺陷；生产构建与 E2E 同一源码均通过。
- 本轮未改 `app/layout.tsx`、全局 tokens/CSS、`package.json`/lock、服务端契约；未 push、未合 master、未部署。

## 5. 未完成/外部输入项

- 真人 10 秒理解测试：**NOT_RUN**（未组织到 3 名非开发者；操作脚本与评分表见 `HUMAN_UNDERSTANDING_PROTOCOL.md`，不使用模型/开发者自评替代）。
- Bilibili 外链内容/标题核验：由独立 claims 审计尝试只读网络核验，取不到则 NOT_RUN，不据链接猜时长。
- 正式生产性能/资源记录、候选状态重拍、15–20 秒可重放片段与素材 manifest：由证据轨在 `4b69614` 上产出。
- 独立 a11y 复验（热 reduced-motion、移动/键盘/账号页）：由 a11y 轨产出。

## 6. Bilibili 外链内容核对（Lead 只读核验；独立复核由 claims 轨重取）

- 通道：`GET https://api.bilibili.com/x/web-interface/view?bvid=BV1Qaxb6PE7G` → HTTP 200，`code:0`（无验证码风控）。
- 平台元数据（作为外部数据记录，不作为本站证明）：`title = 2026 C4-AI 决赛演示视频 万卷siu 忆程ProjectMemo 演示视频`；`pages[0].part` 同义；`owner.name = 鲁昂萘尔`；`duration = 277s`（4:37）；`dimension 1920×1080`；`videos=1`；`pubdate = 2026-11-01 22:24:50 UTC+8`。
- 对照用户提供的标题：【2026 C4-AI 决赛演示视频 万卷siu 忆程ProjectMemo 演示视频】→ **标题一致**（空格归一化）。
- 页面现有文案只写“2026 C4-AI 决赛演示视频”+“Bilibili · 新窗口打开 / 点击后在新窗口打开外部站点”，不展示时长/播放量，不据链接猜“全部展示能力”；外链不嵌入、不预连接、加载不请求 B 站。该项核验结论：**标题与视频身份已核验**；独立 claims 轨将保存原始响应与时间/哈希。

## 7. 用户追加要求后的新候选：`f06685d`（决赛演示改为本页可播放）

- 用户 2026-11-03 直接要求「b站那里可不可以直接把视频放在那里可以播放？不必要跳转b站」；据此新增 `components/home/DemoVideoPlayer.tsx`，05 区改为“本地门面 + 点击后内嵌 Bilibili 官方播放器”，保留新窗口外链退路。完整决定/实现/核验见 `EMBED_DECISION.md`。
- 新候选 SHA：`f06685d84b85c523595f2950b07b07dcdbf4271d`（= `4b69614` + 该功能）；本轮源码以此为准，先前针对 `4b69614` 的 after/网络/无障碍证据需按新 SHA 复核或改绑（“加载期 0 外域”不变；“点击后”外部请求为**用户主动加载官方播放器**，不属自动播放）。
- Lead 对新候选已执行：`tsc` exit 0、定向 eslint exit 0、主控 B 组件回归 3/3；Edge headed 实测门面点击前外域 0、点击后 iframe 加载且焦点进入 IFRAME、收起后 iframe 卸载并把焦点送回门面、1440/390 无溢出；官网定向 E2E 与独立审计/证据重跑进行中。
- 交接：独立的定向 E2E（隔离库/端口 33411）、正式构建/start 性能记录、候选截图与 15–20 秒片段均绑定 `f06685d`。
