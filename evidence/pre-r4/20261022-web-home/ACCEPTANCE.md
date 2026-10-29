# Web 首页：个人项目 Agent 宣传页

日期：2026-10-22。

## 设计与实现

- 首页定位为“忆程，你的个人项目 Agent”。首屏用中文身份标题与 Manrope 大字 Agent 建立层级，保留青绿品牌色和暖白底色。
- 首屏交互示例围绕同一个项目展示记录、记忆、提醒、行动。内容明确标为示例，不读取用户项目、不调用模型、不写业务数据。
- 新增长期委托、成果来源追溯和项目状态变化展示，补齐竞赛、科研、课程场景及 Web/鸿蒙接续说明。
- 首页采用宣传导航；登录后仍可查看首页，通过“回到我的工作台”进入焦点。工作区导航仍走原组件。
- Manrope 字体从 Google Fonts 官方仓库获取并本地托管，附 Manrope-OFL.txt；运行时不访问外部字体服务。
- 首屏入场 550–650ms；卡片阶段切换 220ms；滚动揭示 550ms；按钮反馈 150ms。无循环播放，未引入动画库。减少动态效果时关闭动画/过渡，并显示所有章节；无 JS 时内容默认可见。

## 验证

- TypeScript、ESLint：通过，见 types-release.log、lint-release.log。
- 隔离生产构建与全量 E2E：14 passed，0 unexpected，0 flaky；见 e2e-release.log、e2e-summary.json。用例已适配首页保留与显式进入工作台的导航行为。
- Chromium 生产预览：1440 / 768 / 390 / 320px 均无水平溢出；点击切换、End 和方向键切换、唯一选中标签、匿名入口转登录均通过。
- 动效：生产浏览器检测到阶段切换动画；减少动态效果下 animation=none、transition=0s。
- 截图：desktop-release.png、desktop-full-release.png、mobile-release.png。脚本 home-qa.pw.txt，结果 browser-qa-production.log。
- 原开发服务的 HMR WebSocket 握手失败，点击示例没有完成更新；最终交互验收改用隔离生产预览 33322，全部通过。未改写既有开发服务的进程或环境。

本轮没有部署或向用户真实项目写入数据。
