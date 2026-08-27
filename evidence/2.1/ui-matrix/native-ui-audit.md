# W01 native UI audit

日期：2026-08-27

本次审视以 HarmonyOS/ArkUI 设计规范、可访问性检查项和网页端已有视觉语言为参考，目标代码是鸿蒙应用端。网页端 `GlobalSettings`、`CaptureBox`、`ActionBoard` 提供了以下可迁移模式：图标 + 标题/说明的卡片头、分组字段、明确的状态文案、突出主操作、失败后的恢复入口。

## 已落地

| 发现 | 原问题 | 鸿蒙端处理 |
|---|---|---|
| 设置栏层级 | 设置卡片只有标题，在线/离线字段边界不清 | 增加图标 tile、标题与说明；在线模式才展示 URL/模型/API Key；离线模式明确显示“无需网络配置” |
| 模式选择 | 仅依赖颜色表达当前模式 | 选中项同时使用勾号、边框和无障碍 selected 语义 |
| 状态真实性 | “网络正常”是静态文案，容易误导 | 改为“数据同步”，展示“尚未同步/同步中/已同步/同步失败” |
| 反馈可恢复 | 上传失败或需要 OCR 时没有下一步 | 保留真实失败/NEEDS_OCR 状态，并提供“重试提取”入口；不生成伪造记忆 |
| 触达尺寸 | 关键按钮高度不统一 | 主要操作、上传、重试、取消/确认和错误/空态 CTA 统一补足 44–48vp；底部导航使用 56vp 点击区 |
| 读屏语义 | 来源胶囊和状态反馈缺少上下文 | 来源项增加 accessibilityText/Selected，附件反馈以“附件状态”前缀播报 |
| 信息保护 | 项目设置对已有数据的影响不够明确 | 增加说明：只修改项目基本信息，不改变已有记忆、提醒或行动 |

## 保持不虚构的边界

- 四类 AVD 的实际截图与 `uitest dumpLayout` 尚未生成：启动命令失败且 `hdc list targets` 返回 `[Empty]`，见 `W01-emulator-blocked.txt`。
- 深色模式尚未验收。当前页面仍主要使用固定的 `PMColors`，暗色 token 尚未全面资源化接线；不能把暗色资源存在写成深色通过。
- 大字体、键盘遮挡、折叠态/横屏和慢网/乱序返回仍待目标设备回执。代码没有通过写死 `sleep` 伪造慢网。
- S05 图片/PDF 各 5 份与 S07 通知权限、去重、点击深链、冷/热启动、Snooze、重启矩阵没有被模拟器运行结果覆盖。

## 离线可复核结果

- `npm.cmd test`：12 files / 85 tests PASS。
- `npm.cmd exec tsc -- --noEmit`：PASS。
- `npm.cmd run lint`：PASS。
- `npm.cmd run harmony:test`：23/23 PASS。
- `npm.cmd run verify:s08-adapter`：8/8 PASS。
- `npm.cmd run harmony:build`：PASS；最新产物 hash 在最终回归后记录到实施笔记。
