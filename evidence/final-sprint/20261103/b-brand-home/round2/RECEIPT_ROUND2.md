# Track B 第二批（收尾/真实性完善）回执

- 工作树：`D:/Projects/hongmen-final-b-brand-home` · 分支 `codex/final-b-brand-home`
- 主控检查点：`4b69614`（已快进同步；含 A/B 合入与主控复审修复）
- 本轮源码提交：`f06685d`（决赛演示本页播放，用户追加要求）、`2affe46`（Round 2 审计 F-R2-01/02 修复）
- **最终源码候选：`2affe4616ad2ef652a4bfdfdc032e1342f14b7db`**；未 push、未合 master、未部署。
- 证据绑定：大部分证据在 `f06685d` 上采集；`2affe46` 只改 `app/home.module.css` 两处声明（视频门面角标对比度/移动端字号），已由 Lead 定向复验（见 §6），其余截图/网络/性能/交互对该 delta 不敏感。

## 1. 继承主控修复（不重做、不回退；已复验）

- Hero 阶段状态 chip 随阶段：离开时「无需操作」、期间「核对示例」、回来后「等你确认」（`components/home/HomeHeroLens.tsx`）。
- `HomeMotion` 运行时 reduced-motion 热切换（matchMedia change → 停帧/清视差/进度归零，CSS 兜底；恢复后重新更新）。
- 本轮独立 a11y 主探针（15:16–15:21）与 Lead dev 复验均在 `f06685d` 干净树通过：3 个来回 on→reduced→on、shift/translate/progress/active 全归零、正文 1573 字不变，恢复后滚动重新更新。

## 2. 用户追加要求：决赛演示改“本页可播放”

用户 2026-11-03（UTC+8）原话：「b站那里可不可以直接把视频放在那里可以播放？不必要跳转b站」。据此新增 `components/home/DemoVideoPlayer.tsx`：

- **点击前**：本地深墨 16:9 门面（播放钮/标题/「点击加载播放器 · 在播放器内播放」/「公开视频 · Bilibili」），**加载期 0 外域、0 bilibili、无 iframe、无预连接、无封面预取**。
- **点击后**：仅用户主动操作才创建 `player.bilibili.com/player.html?bvid=BV1Qaxb6PE7G&page=1&high_quality=1&danmaku=0&autoplay=1` iframe（allow autoplay/fullscreen/PiP/encrypted-media、allowFullScreen、lazy、有 title）；焦点在 iframe 加载后进入播放器（180/900/1800ms 兜底，实测 activeElement=IFRAME）。
- **收起/退路**：新增「收起播放器」卸载 iframe、恢复门面并把焦点送回门面按钮；保留「在 Bilibili 打开（新窗口）」外链（`target=_blank`、`rel=noopener noreferrer`、aria-label 含“新窗口”）。
- **播放策略**：`autoplay=1` 仍可能被浏览器拦截（自动化 headed Edge 实测 `video.paused=true`、readyState=0）；页面文案明确“在播放器内播放”，**不宣称自动播放成功**。用户本人已实际查看并确认可播放（不再做额外取证）。
- 决定与实现细节：`round2/EMBED_DECISION.md`；专项截图/网络：`round2/video/`。

## 3. 实际检查（本机，实际执行）

| 检查 | 结果 |
|---|---|
| `tsc --noEmit`（2affe46） | **exit 0** |
| 定向 `eslint -- app/page.tsx components/home components/HomeJourney.tsx components/SiteHeader.tsx tests/finalBHomepageInteraction.test.ts` | **exit 0**（0 error） |
| 主控 B 组件回归 `tests/finalBHomepageInteraction.test.ts` | **3/3 pass**（阶段 chip / 热 reduced-motion） |
| 官网定向 E2E `PROJECTMEMO_E2E_PORT=33411 npm.cmd run test:e2e -- e2e/demo.spec.ts` | **10 expected / 0 unexpected / 0 flaky / 0 skipped，exit 0**（隔离库；含真实登录态首页 CTA → `/focus`）；其内生产构建通过。结果：`round2/e2e-demo-spec-results.json` |
| 生产构建（`.next-build`，Start-Track 同款 mock/隔离库 env） | **exit 0**，93.4s，43 页，产物 267.05MB/3761 files，无 OOM；`round2/build/` |
| 生产 `next start` 性能（生产模式，非 dev） | `round2/perf/prod-perf.json`：1440 light / 390 light / 1440 dark 各 3 次（cold+warm）。1440 light：cold FCP/LCP 924/924ms、CLS **0**；warm median FCP/LCP 92/92ms、DCL 93.45ms、TTFB 26.1ms；24 请求、加载期外域 **0**、`/api` 写 **0**、bilibili **0**；cold 传输 1.21MB（其中 `/logo.png` 830KB 为全站共享资产）、warm 传输 6.95KB；字体全部 loaded |
| 生产模式视频区专项（门面/点击/收起） | `round2/video/video-area-summary.json`：门面 16:9（1440: 574×323，390: 354×199，无溢出）；点击后 iframe 出现并加载；收起后 iframe=0、门面恢复、焦点回按钮；点击前 0 外域，点击后外部请求单独列为“用户主动加载” |
| 网络口径（独立 claims 在 f06685d） | `round2/claims/json/network-audit.json`：用户操作前外域 **0**、bilibili **0**、iframe **0**、无预连接/预取；`/api` 写 **0**、模型调用提示 **0**；点击播放器后出现的外部请求单列 |
| Bilibili 元数据（只读 API 核验） | `api.bilibili.com/x/web-interface/view?bvid=BV1Qaxb6PE7G` HTTP 200/code 0：title=`2026 C4-AI 决赛演示视频 万卷siu 忆程ProjectMemo 演示视频`（与用户提供标题一致）、duration=277s（4:37）、1920×1080、pubdate=2026-11-01 22:24:50 +08；原始响应/哈希见 `round2/claims/json/bilibili-link-verification.json` |
| dev-mode 数据 | 单列于既有 `after/`、`b3/` 与 Round 2 采集日志；不与生产数据混合 |

## 4. 独立审计（本轮被用户要求停止，如实标注）

- **a11y（已产出最终报告，绑定 f06685d）**：`round2/a11y/A11Y_ROUND2.md` —— BLOCKER 0；发现 **MAJOR F-R2-01**（深色主题门面角标对比度 4.03:1）与 **MINOR F-R2-02**（同一元素移动端 12.16px）；其余（热 reduced-motion、阶段 chip、视频专项焦点/收起/点击前 0 外域、键盘/skip link/dialog/锚点/断点/账号页/对比度/溢出）PASS。
  - **两项均已在最终候选 `2affe46` 修复**：角标改 `--paper 82%` 混合 + 桌面 13.6px/mobile 12.8px；Lead 按 alpha 合成实测对比度 **浅 9.62:1 / 深 7.77:1**，移动端字号 **12.8px**（见 `round2/a11y/` 报告 §6 与 Lead 复验记录）。因审计会话已停止，未做“修复后全量重跑”，只做定向复验并如实标注。
- **claims（未产出最终 markdown，按用户要求停止）**：已产出 `round2/claims/json/{network-audit,claims-check,cta-audit,bilibili-link-verification,asset-inventory}.json` 与日志（绑定 f06685d）；Lead 已复核关键断言（用户操作前 0 外域/0 写/0 bilibili、CTA、文案与 Bilibili 元数据）。资产清单结论：`PM Editorial` 有 NOTICE+OFL、`Manrope` 有 OFL（本轮新增使用、已随 @font-face 声明）、`PM Brand` 缺独立 NOTICE、`logo.png` 830KB/来源说明属仓库既有共享资产——**均未擅自修改全局资产**，列为主控待决。
- **证据轨（按用户要求停止）**：after/断点/Hero 三态/rail/热 reduce-motion/closing/视频区/性能/build/网络/媒体片段均已产出并绑定 f06685d；标志性 **16.4s 可重放片段** `round2/media/interaction-round2.webm` + 关键帧 + `MEDIA_MANIFEST.json`（含公开合成身份、SHA、viewport/theme、加载期 0 外域、点击后用户主动外部请求分列），供 F 角色接收，未上传/未发布。

## 5. 设计/资源结论

- 生产模式 CLS **0**、字体加载正常；未为“分数”换空白首屏或裁掉可读产品内容。首载最大资源是**全站共享的 `/logo.png` 830KB（显示约 28px）**，不是官网局部资源；按任务书要求先出准确资产清单与消费者说明（layout header/账号页/品牌链接）交主控，不擅自换全站资产或编许可证。
- 官网局部字体（PM Editorial/Manrope）的预载/subset 属候选优化，但 PM Editorial 同时被账号页使用，需要主控确认消费者后再授权；本轮不动。

## 6. 最终候选与复验

- `2affe46` = `f06685d` + `app/home.module.css` 两处声明（视频门面角标对比度与字号）。tsc/eslint exit 0；Lead 定向复验：门面角标/说明/标题在浅/深、1440/390 的 alpha 合成对比度 5.48–13.66，移动端最小 12.8px；其余页面状态与截图不受该 delta 影响（网络/交互/布局不变）。
- 证据目录：`round2/{after,breakpoints,hero,rail,reduced-motion,closing,video,media,perf,build,server,metrics,states,a11y,claims}`；`superseded-4b69614/` 为已作废的第一版采集（本地保留、未提交）；`media/page@*.webm` 为 Playwright 原始分段，仅提交最终 `interaction-round2.webm`。

## 7. NOT_RUN / 残余

| 项 | 状态 |
|---|---|
| 3 名非开发者 10 秒理解与操作 | **NOT_RUN**：操作脚本与计分表见 `round2/HUMAN_UNDERSTANDING_PROTOCOL.md`；未用模型/开发者自评替代。 |
| 读屏人工验证 / 无障碍认证 | NOT_RUN（自动化 DOM/计算样式/键盘/网络取证，不宣称认证）。 |
| Bilibili 播放器的真实播放/Autoplay/音频策略 | 用户本人已确认页面内可播放；自动化只证明 iframe 加载、焦点/收起、network 分界，不宣称自动播放成功。 |
| 线上部署 / HTTPS / CDN / Lighthouse | 未做（任务明确不部署）；性能为本机生产构建 + 本地回环单次测量。 |
| 全局共享资产（logo 体积、PM Brand NOTICE、字体 subset/预载、账号页字体消费者） | 未改；需主控批准后另行处理。 |
| claims 最终 markdown、a11y 修复后全量重跑 | 因用户要求停止 Agent 而未完成；原始 JSON/日志与 Lead 定向复验已保留。 |
