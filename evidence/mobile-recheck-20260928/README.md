# ProjectMemo 移动端模拟器复核（2026-09-28）

## 环境与范围

- 设备：DevEco Pura 90 模拟器，`hdc` 目标 `127.0.0.1:5555`。安装的是临时 `development` 配置的 unsigned HAP，访问本机 `10.0.2.2:4400`；源码已恢复为 `review` 配置。评审地址的真实设备可达性未由此验证。
- 后端：`npm.cmd run harmony:backend`，显式使用从 `prisma/dev.db` 复制的独立临时数据库 `tmp/mobile-recheck-20260928.db`；未执行迁移、seed、数据清空或真实模型调用。为避开已有 `.next` 路由缓存异常，使用独立 `NEXT_DIST_DIR=tmp/next-mobile-recheck-20260928`。截图数据来自本地已有的复赛演示项目，不代表平台提交验收。
- 临时数据库与独立 Next 构建缓存位于忽略的 `tmp/` 下。清理临时数据库的精确文件删除命令被自动审批拦截，文件目前保留；未触碰 `prisma/dev.db`。
- 截图保留了操作过程，以下列出可直接核对的关键画面。`05-action-preview.jpeg` 停留在确认前，未创建行动。

| 截图 | 核对点 |
|---|---|
| `02-post-login.jpeg` | 全局项目列表入口 |
| `06-global-memory.jpeg` | 全局「记忆」跨项目记录，带项目归属 |
| `10-project-memory.jpeg` | 进入项目后的项目内记忆空态与底部导航 |
| `04-readiness.jpeg` | 六项「项目内准备项」、逐项口径及非 HAP/PDF/MP4 提交验收说明 |
| `05-action-preview.jpeg` | 创建行动前的预览与确认操作 |
| `09-severity-fixed.jpeg` | 3 级提醒显示为「中优先级」，工作台不再同时称其为高风险 |
| `11-stale.jpeg` | 后端中断后项目页保留旧快照，并提示同步失败 |
| `20-health-fixed-stale.jpeg` | 体检请求失败时，明确显示上次结果而非当前结论 |
| `21-health-recovered.jpeg` | 后端恢复且重新检查成功后，旧结果警示消失 |

## 本轮优化与验证

- 模拟数据不计入全局/项目行动和提醒统计、不触发系统通知；若在项目行动列表中展示，则标为「演示情境」。
- 空准备项清单显示「暂无可计算清单」，避免 `0 ÷ 0`；风险等级文案与颜色统一到现有等级口径；弱网旧快照保留可见并明确标注。
- 风险类「最近闭环」状态变化须有行动/结果记忆之外的独立证据引用，才在该链条显示状态变化。
- `npm.cmd run harmony:test`：56/56 通过。`npm.cmd run harmony:build`：成功，review 配置 unsigned HAP 的 SHA-256 为 `a08ea8af78208f3cab7a0ee6d35ac80ea4578320bc6254a459b2736e72bcdbab`，大小 4,136,319 字节。构建仍有项目既有的 ArkTS 废弃 API 警告，未配置签名。
- 提交前复验（2026-09-28）：当前源码再次通过 `harmony:test`（56/56）与 `harmony:build`。本次构建输出的 unsigned HAP 为 4,147,931 字节，SHA-256 `e4860042cd9d2ae08f30ac94630b086c6df423168d4fdf794f2dc3c9fe54a119`。上述两组哈希对应不同时间的构建产物；本机新增的签名配置包含本地路径和口令，未纳入版本控制，也未据此认定评审设备可安装。

模拟器截图证明了所列页面的可见行为，不等于真机、评审网络、字体放大、完整安装签名或 HAP/PDF/MP4 提交验收。评审配置 HAP 尚未在设备安装；真实设备与平台验收仍待完成。
