# CT-9A 浏览器只读工程证据（2026-10-30）

工作树：`D:\Projects\hongmen-ct8`  
分支：`codex/ct9-browser-read`  
BASE_SHA：`108bbeb`

## 已执行检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm.cmd exec tsc -- --noEmit` | 通过 |
| Lint | `npm.cmd run lint` | 通过 |
| 全量测试 | `npm.cmd test` | 159 文件 / 1295 项通过 |
| Web 构建 | `npm.cmd run build` | 通过 |
| E2E | `npm.cmd run test:e2e` | 通过（隔离库 44 迁移重放、seed、生产构建、浏览器 E2E） |
| 鸿蒙单测 | `npm.cmd run harmony:test` | 86/86 通过 |
| 鸿蒙构建 | `npm.cmd run harmony:build` | 通过 |
| HAP | `harmonyos/entry/build/default/outputs/default/entry-default-unsigned.hap` | 6,751,363 bytes；sha256 `8aa75cab90075835405ad6cf9bf26eddd4ce99447be075a01ae79959bb24bc9a` |

## 浏览器运行证据

`tests/browserReader.test.ts` 使用本机 Playwright Chromium，对 `127.0.0.1` 上临时 HTTP 受控站点读取（测试 seam 仅在 Vitest 且显式 `BROWSER_TEST_ALLOW_ORIGINS` 下生效）：

- JS 渲染后取得动态正文、heading、可见文本 hash、截图 hash。
- 空页面返回 `EMPTY`，不冒充读取成功。
- 异步正文未完成返回 `PARTIAL`，保留已见片段且 `coverage.complete=false`。
- 页面注入文本只作为内容；弹窗、dialog、表单 POST、WebSocket、私网 iframe/图片被拦截，`/post` 服务端命中 0。
- 重定向到 `169.254.169.254` 被阻断为 `BLOCKED`。
- 闭合 `<details>` 正文不进入可见正文；`READ_DETAILS` 仅展开原生 disclosure。
- 单次观察子请求预算生效，超出后阻断并标记 `BROWSER_BUDGET_EXCEEDED`。

## 数据与凭据

- 未复制主工作树 `.env`、真实数据库、OAuth token、登录浏览器 profile 或签名私钥。
- 未访问真实公网站点，未使用付费模型，未向任何真实外部账号写入。
- 测试只使用临时 SQLite 库、本地受控 HTTP 站点和测试 Provider/Fixture。

## 未关闭 Gate

- 真实模型 + 真实公网受控 JS 页面动态选择与 GoalGap 改变。
- 鸿蒙真机/模拟器联调。
- DNS 检查与浏览器实际连接之间的 TOCTOU 残余风险未宣称网络级沙箱。
- 截图仅保存 hash，不持久化截图字节。
- CT-9B/CT-10 未开始。
