# P3 复查修复与 GitHub 入口（2026-10-24）

基线 `c92d52096eea222611240dc2c1896c044e57e224`，本轮为未提交工作区修改。对应发现见 `evidence/review-p2-p3-20261024/REVIEW.md`。

## 修改

F1–F4：经验同项目用户隔离；采纳持久幂等及事务回滚；刷新撤销/撤权/版本栅栏；验收 runner 令牌不落盘。

F5–F7：超页数使用 PARTIAL 持久续取，保存失败不确认游标；新 Mission 按当前工具注册表及协议检查兼容性；无关资料不重开 UNKNOWN 问题。历史方法在任意卡片修订后是否仍适用的 R5 契约问题没有强行扩大成自动失效。

Web 项目概览新增「GitHub 仓库」，直接进入并展开连接表单；表单明确区分 `owner/repo` 与分支。鸿蒙项目概览与资料页均提供入口，可绕过空记忆状态直接管理连接。没有新增一级导航。

迁移 `20261024120000_p3_review_boundaries`：经验唯一键增加 owner；清理异主样本且保留历史 Use；新增连接 revision、分页续取字段和信号命令回执。已用旧库 fixture 验证增量升级，不对真实开发库或 ECS 执行迁移。

## 验证

| 检查 | 结果 |
| --- | --- |
| 全量 Vitest | 108 文件、882 项通过（含新增 12 项边界测试） |
| tsc / ESLint | 通过，最终 lint 无警告 |
| Web 生产构建 + E2E | 构建成功；14/14 通过，无 flaky/skipped |
| 鸿蒙 Hypium | 83 项通过 |
| HAP | 构建通过，unsigned，5,385,959 bytes |
| 浏览器布局 | 概览与连接面板在 1440 / 1280 / 768 / 390px 均无横向溢出，入口可见并直接展开 |
| 浏览器操作（route fixture） | 连接、继续同步、采纳及读回回执展示通过，真实 GitHub 请求 0 |
| 数据迁移 | 空库重放与旧库 fixture 增量升级通过，历史使用/仓库信号保留 |

HAP SHA-256：`c9c4998d54ac288c4d3f16c0ef2c0fe5b48edf0a13ae85add6e648387f6d9a06`。路径：`harmonyos/entry/build/default/outputs/default/entry-default-unsigned.hap`。

首次全量有一项既有 `missionEvaluationBudget.test.ts` 遇到 Windows 临时账本 rename 的 EPERM（881 通过、1 失败）。未修改预算代码，保留 `unit-first-run.log`；完整重跑 882/882 通过，见 `unit-final.log`。HAP 首次编译暴露原仓库服务的内联对象类型错误，改为具名 ArkTS 模型后构建通过。

新增边界测试包含两个独立 OS 进程同时采纳、注入 SQLite 写失败、网络挂起后撤销/撤权、40 条跨页与 160 条续取、同项目两个有效身份、零步骤协议/工具不兼容、UNKNOWN 抑制、进程强制退出后的凭据文件检查，以及旧库增量升级。

浏览器画面使用独立 E2E 库。若交互回执以浏览器 route fixture 验证，则只证明客户端展示与请求，不计作真实 GitHub 同步或生产采纳证据。后端真实数据库/路由边界由 Vitest 覆盖。

截图：

- [桌面项目入口](overview-1440.png) / [手机项目入口](overview-390.png)
- [桌面连接面板](repo-1440.png) / [手机连接面板](repo-390.png)
- [手机采纳状态（浏览器 fixture）](repo-mobile-fixture.png)

`ui-qa.js` 与 `ui-qa.log` 记录布局和操作断言；`e2e-stats.json` 保存最终 E2E 汇总。未复制测试登录 storageState、令牌或 SQLite 数据库。

GitHub 匿名条件请求不承诺免配额，参见 [GitHub 条件请求说明](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)。当前仅支持公开仓库 commits，首次最近 30 条；后续按需追踪新增提交，无周期订阅。

## 交付边界

未提交、推送或部署；未调用真实模型、未使用生产凭据、未执行生产写入。HAP 构建不代表设备安装或平台联调完成。原有 `harmonyos/build-profile.json5` 与 `next-env.d.ts` 修改保留。
