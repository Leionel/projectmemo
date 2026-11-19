# M3 原生材料选择与系统分享入口（2026-11-17）

工作树基线 `95fcc4f`。复用既有 Mission/Material/Attachment 权限链，无新 Agent 引擎、无新依赖、无 Schema/Migration。

## 本轮实现

- **服务端统一预览**：`POST /api/projects/[id]/material-extract` 从仅 DOCX 扩展为 TXT/Markdown/普通 CSV/DOCX；严格 UTF-8、64KB 文本/2MB DOCX、20,000 字上限，拒绝二进制与 DOCX 以外格式；CSV 明确“不是实验指标”。`POST /api/missions/[id]/materials/preview` 校验 Owner、V2 协议、目标 Mission 后只返回预览，不写 Capture、不调模型、不唤醒委托。
- **鸿蒙原生入口**：`NativeMaterialContract.ets`（格式/MIME/大小/分享 URI/稳定 requestId/预览）、`NativeMaterialService` 方法（multipart 解析 + Mission 预览）、工作台“从手机补材料/确认加入/取消/重试”流程。选择器只接受 TXT/MD/CSV/DOCX；先复制到应用缓存再上传，完成后删除；预览与确认同一目标 Mission。
- **系统分享**：`module.json5` 注册 `ohos.want.action.send` 与四种 MIME；`EntryAbility` 冷/热启动解析 `Want.uri` 或分享参数，只取一个 `file://` URI，不接受 http/目录/相对路径；重复分享用递增 `pm.shareSeq` 只消费一次；新 Want 清空旧分享意图；登录失效沿用 `SessionStore` 的清除与跳转。
- **失败保留**：确认失败保留 draft 与同一 requestId；预览/解析失败保留用户可重新选择；请求不因页面隐藏或回包不确定被静默换对象。

## 代码入口

| 层 | 文件 |
|---|---|
| 文本边界/解析 | `lib/intake/plainText.ts` |
| 服务端预览 | `app/api/projects/[id]/material-extract/route.ts`、`app/api/missions/[id]/materials/preview/route.ts`、`lib/mission/materialService.ts` |
| 鸿蒙合约 | `harmonyos/entry/src/main/ets/common/NativeMaterialContract.ets`、`models/NativeMaterial.ets` |
| 鸿蒙服务/页面 | `services/MissionService.ets`、`pages/OutcomeWorkbench.ets`、`entryability/EntryAbility.ets`、`module.json5` |
| 测试 | `tests/v2NativeMaterials.test.ts`、`harmonyos/entry/src/test/NativeMaterialContract.test.ets` |

## 验证命令与实际结果

```powershell
npm.cmd test -- tests/v2NativeMaterials.test.ts     # 3/3 通过
npm.cmd run harmony:test                            # 165/165 通过（新增 5 条原生材料合约）
npm.cmd run harmony:build                           # BUILD SUCCESSFUL；unsigned HAP 8,930,233 字节，SHA256 `90e26d8d739a9fb1c92fe6a47656a856293be64fefa6ea0cead86223e58af86f`
npm.cmd exec tsc -- --noEmit                        # 通过
```

- `backend-tests.log`、`harmony-test.log`、`harmony-build.log` 为本目录原始输出；最终回归全量 281 文件/2179 条通过。
- HAP 未签名；未做真机安装、系统分享实际唤起、URI 授权/失效的真实场景验证。
- 已有挑战浏览器回归（`m3-challenge-replay-20261117/browser`）证明 Web 同一 Mission 的暂停/材料限制，但非双设备同时操作。

## 兼容与未验

- 旧 Web/鸿蒙请求不受影响：解析接口仍是原路径，DOCX 行为保留；新预览接口仅新客户端使用；工作台模型字段未变。
- 分享注册依赖系统及 HAP 安装；没有真机时**不得**把合约/编译结果写成“系统分享可用”。
- 真机、真实分享、通知点击、弱网、登录过期后的端到端行为：UNVERIFIED。
