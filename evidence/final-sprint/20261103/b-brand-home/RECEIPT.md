# Track B 官网回执：两款 Hero 原型 → 选定落地 → 移动/动效/无障碍收口

日期：2026-11-03（UTC+8）· 工作树 `D:/Projects/hongmen-final-b-brand-home` · 分支 `codex/final-b-brand-home`
基线：`485d485378637e1da3280ed092739d441c8cf749` · **最终候选：`9bae926e9475cedef118deedf5e002ec8365a23b`**

> 本 Track 只改官网专用文件：`app/page.tsx`、`app/home.module.css`、`components/HomeJourney.tsx`、`components/HomeJourney.module.css`、`components/SiteHeader.tsx`、`components/SiteHeader.module.css`、`components/home/*`。未改全局 `app/layout.tsx`、全局 token/CSS、`package.json`/lock、共享业务组件与 API。不 push、不合并 master、不部署、无付费模型调用、无外部写入。

## 1. 提交序列（每个阶段独立提交）

| 阶段 | SHA | 内容 |
|---|---|---|
| 基线 | `485d485` | 准备阶段确认的源码基线 |
| B1 | `4be7a4b` | 两款隔离 Hero 原型 + 基线/原型证据 + 信息结构裁决 |
| B2 | `0a09a2e` | 选定方案合入生产首页：Hero 四问工作包、因果/五步/双端/场景/演示外链/终局 CTA；删除原型路由并归档源码 |
| B3 | `216cf05` | 滚动动效与进度指示、a11y 修复、审计 provisional 事实/文案修复 |
| B3 | `cc7c19f` | 可见文本字号 ≥12.8px、终局链接 44px |
| **B3 终验** | **`9bae926`** | F-01 首页作用域字号修复 + 两个 `role="group"`；**最终候选** |

回滚：按提交逐个 `git revert` 即可；本轮未改 schema/API/权限，回滚不涉及数据迁移。

## 2. 用户得到的改变

1. **首屏即可看懂持续委托**：主张“人可以下线，项目别掉线。”左侧主张/CTA，右侧“忆程参赛作品开发 · 整理阶段汇报”四问工作包（原委托/依据/变化/等你），默认“回来后”，可切换离开时/期间/回来后；依据可展开原文。
2. **离开以后的因果被讲清楚**：来源 → 变化（缺回执）→ 判断改变（先补演示结果）→ 等你；滚动时进度线随阅读点亮，桌面横向、移动纵向。
3. **原有五步公开示例保留**：来源/判断/确认门槛/模拟回执/回到依据/重置全部保留，仅重排版式并把“参赛要求”更正为“比赛材料”；Hero 与 Demo 共用同一份公开素材（`components/home/homeExample.ts`）。
4. **同一任务双端**：Web 看依据、鸿蒙回应，明确“界面示意 · 实际可用范围取决于部署与授权”。
5. **决赛演示视频外链**：`2026 C4-AI 决赛演示视频`（Bilibili，用户提供）以新窗口外链呈现，不嵌入、不自动播放、加载不请求 Bilibili。
6. **主题与设备**：浅/深主题、390/360/320 移动端、1024/768、200% 缩放均可用；减少动画、键盘、图片/字体失败降级完整。

## 3. 实际检查（本机、实际执行）

| 检查 | 结果 |
|---|---|
| `npm.cmd exec tsc -- --noEmit` | **exit 0**（9bae926，10–11s） |
| `npm.cmd run lint` | **exit 0**（0 error；9 条既有 warning，均不在首页文件） |
| `npm.cmd run build`（独立审计） | **exit 0**（cc7c19f，52.9s，43 页，TypeScript 通过，无 OOM；CSS/role delta 后由 e2e 生产构建再次通过） |
| 隔离 E2E（`e2e/demo.spec.ts`，独立测试库/端口 33411） | **PASS**：生产构建通过，Playwright 10 expected / 0 unexpected / 0 flaky，37.6s，exit 0；覆盖登录态首页 CTA → `/focus` 与既有用户路径。见 `b3/e2e-demo-spec.md` |
| 独立宣传事实/网络/CTA 审计 | **0 产品性 FAIL / 全部 PASS**（报告绑定 9bae926；cc7c19f 浏览器实测经非行为性静态 delta 继承） |
| 独立无障碍审计 | 最终候选 9bae926：**BLOCKER 0 / MAJOR 0 / MINOR 0**，A11Y-01…46 全部 PASS 或 NOT_SUPPORTED（无 JS 为框架级，非本轮回归）；F-01 复验 1440/390/320/深色均清零 |
| 证据采集 | after 6 图 + 27 张状态/断点图 + 20.52s 录屏 + 资源/性能/网络 JSON（cc7c19f） |

关键实测值（dev server，1440×900）：Hero bottom 719（1440） / 706（1280×720，viewport 720）；`#experience` 锚点落点 80px > sticky header 57px；展开依据时左栏 top 恒 112（无位移）；顶部阅读进度线 y=56、`scaleX` 随滚动变化；rail `--rail-progress` 0→1 且圆点按顺序点亮；移动端全页可见文本最小计算字号 **12.80px**；320/360/390/768/1024/1440 及 200% 等效 720/640 全部无水平溢出；浅色对比度最低 4.72:1、深色最低 6.22:1。

## 4. before / after 截图

- before（基线 485d485，6 图）：`before/homepage-{1440,1280,390}-{light,dark}-before.png`（此前准备阶段另有 6 图在总控 `preparation-20261103/screenshots/`）。
- after（候选，6 图）：`after/homepage-{1440,1280,390}-{light,dark}-after.png`。
- B1 原型对照 8 图 + 5 张交互图：`b1/screens/`；基线对比证据：`b1/B1_COMPARISON.md`。
- 动效/状态/断点：`b3/hero-states/`、`b3/rail-1440-mid.png`、`b3/rail-390-mid.png`、`b3/breakpoints/`、`b3/states/`；录屏 `b3/interaction-20s.webm`。
- 采集说明与异常：`CAPTURE_REPORT.md`；逐图清单/哈希：各目录 `MANIFEST.json`。

> 截图左下角的“N”为 Next dev 开发覆盖物，before/after 同环境一致；所有截图均为本地 mock 环境、公开示例数据，不含私人项目。

## 5. 公开示例与数据边界

- Hero 与五步 Demo 的所有交互只改本页 React state；不调用模型、不创建/批准/完成真实任务、不写数据库、不请求 `/api`、不请求任何外部域名（Bilibili 仅点击外链后离开本站）。
- 页面无 `<img>` 请求（旧工作区大图已不再引用，文件保留在 `public/home/` 未删除）；字体为本地 `PM Editorial`（Noto Serif SC 子集，OFL）与 `Manrope`（OFL）。
- 展示状态均为冻结/模拟示例，页面内可见“公开示例 · 不调用模型 · 不写入你的项目”“冻结示例”标识；不出现实时 Worker/后台自动执行/效率数字/虚构用户。

## 6. 未做与残余

| 项 | 状态 |
|---|---|
| 3 位非开发者 10 秒理解测试 | **NOT_RUN**（没有真人受试者；未用模型冒充；B1 选择理由为设计评审，不是用户研究结论） |
| 读屏人工验证 / WCAG 认证 | NOT_RUN（仅自动化 DOM/计算样式/键盘路径取证；未宣称合规认证） |
| 线上部署、HTTPS、真实域名 | 未做（本任务明确不部署） |
| 真实账号登录态 CTA | 隔离 E2E 覆盖（见 e2e 结果；不使用真实账号、不写真实库） |
| Bilibili 视频内容/时长/播放量 | 未核验（页面只呈现用户提供的标题与链接，未做 iframe/embed，避免反爬与隐私问题）；外部站点可用性不受本站控制 |
| 性能数字 | 仅本机 dev + 本地回环（FCP 276ms、load 304.5ms，注明环境）；不代表线上或生产构建体积 |
| PM Brand 字体 NOTICE、`/logo.png` 体积与来源说明 | **仓库既有问题**，不在 Track B 范围；未改动全局资产 |
| 旧 `public/home/*.jpg` | 首页不再引用，未删除（保留其他用途/避免影响其他轨） |
| `audit/a11y/invalidated/`、`b3/video-frames/` | 未纳入提交：前者为已隔离的作废运行，后者为录屏派生帧；保留在本地 |

## 7. 证据目录

```
evidence/final-sprint/20261103/b-brand-home/
  RECEIPT.md                 本回执
  CAPTURE_REPORT.md          证据采集报告（Phase 0/1/2）
  before/ after/             改造前后 6+6 图与指标
  b1/                        B1 对照图、指标、比较与裁决、原型源码归档
  b3/                        动效/断点/状态/录屏/性能/网络/资源
  audit/claims/              独立宣传事实/网络/CTA/构建审计
  audit/a11y/                独立无障碍与交互审计
  tools/                     可重跑的采集/探针脚本
```
