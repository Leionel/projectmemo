# 切片 C：把闭环接入正常产品入口

日期：2026-11-16。入口：项目页 `V2DelegationStarter` → 成果工作台。隔离演示 CLI（`scripts/v2-local-demo.ts`）保持独立，未作为本切片依赖。

## 用户路径

1. 在正常项目页导入文本材料，填写这次要完成的目标；
2. 预览一次有界持续范围：本项目资料（含本次导入）、私有工作稿更新、有效期、模型/工具上限；
   明确排除联网检索、公开研究、业务写入、自动外发；
3. 一次确认后原子创建：材料 Capture、v2 Mission、BOUNDED_INVESTIGATION 许可、确认回执；
4. 跳转 `/v2/workbench?missionId=…`，沿用已有成果工作台读取版本、差异、原始依据与过程事件；
5. 加入新材料后，既有扫描器唤醒同一 Mission 产出第 2 版；
6. 自然语言改道（“今天先核对第二版交付依据”）后同一 Mission 产出第 3 版并回到 `await_event`；
7. 工作台顶部保留“暂停跟进 / 结束跟进”，暂停后不再派发，已交付版本与依据仍可读。

## 实现

- `lib/mission/v2DelegationService.ts`：预览（只读、无业务写入）与确认（单事务、requestId 幂等）。
- `app/api/projects/[id]/v2-delegation/{preview,confirm}/route.ts`：会话身份 + 原错误映射。
- `components/v2/V2DelegationStarter.tsx`：项目页入口；`app/projects/[id]/page.tsx` 在 V2/持续许可/工作台三个开关都开启时渲染。
- `components/v2/OutcomeWorkbench.tsx`：新增暂停/结束跟进；控制绑定当前持久 version（不是轮询快照），成功后重新读取。
- `lib/mission/missionService.ts`：`editContinuationPolicy` 支持传入原事务，使确认与许可原子提交。
- `lib/mission/workbenchService.ts` / `lib/types/workbench.ts`：只读快照追加 `version`，供控制绑定。

## 验证

- 浏览器（本机 127.0.0.1 回环模型，正常 `LLM_*` 环境选择，产品 API 无测试 provider 开关）：
  `evidence/v2-first-loop/slice-c-entry/browser-check.log` 与 `browser/receipt.json`，六项检查通过，桌面/预览/360px 截图齐备。
- 服务测试：`tests/v2DelegationEntry.test.ts` 4 条（预览不写、原子确认与幂等、改预览拒绝、开关关闭、暂停/取消）。
- 全量回归、tsc、scoped eslint、Next webpack 构建结果见同目录 `checks.json` 与日志。

## 迁移与双端

- 无新增 Schema/Migration。
- 本切片无 API 契约破坏；Web 使用新增窄接口。鸿蒙未改，仍可忽略新增字段。

## 未验证

- 真实模型下的完整托付质量（需授权后 `--provider=live`）。
- HarmonyOS/HAP 构建与真机；生产滚动升级与旧 Worker 混跑；V2 仍保持关闭。
