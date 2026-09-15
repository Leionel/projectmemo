# 模拟器复查 2026-09-15 23:04–23:08

设备：HarmonyOS 模拟器，`hdc list targets` = `127.0.0.1:5555`，x86_64。
后端：`npm run harmony:backend`（`next dev`，127.0.0.1:4400，NODE_ENV=development）。
安装包：`entry-default-unsigned.hap`，sha256 `d54037edeb2342b23109f87830859238cba54850057b70e0251412a55d28dd2d`，
以 `hdc install -r` 覆盖安装，未卸载、未清除登录数据。
真实数据：登录会话与项目「1232242424」来自此前保留的会话；未调用付费模型。

| 文件 | 内容 |
|---|---|
| 01-cold-start-session-projectlist.jpeg | 保留会话冷启动不闪退；列表带 dashboard（进度/下一步），底栏贴底、未选中标签为次级墨色 |
| 02-index-memory-tab.jpeg | 一级 Tab 切换正常；全局记忆为空时内容区空白（无空态，见报告） |
| 03-projecthome-appbar-tabs.jpeg | 统一顶栏（返回胶囊/两行标题/右侧文字动作与更多图标）与五项底栏渲染正常 |
| 04-dialog-scrim-flat-on-x86.jpeg | 弹层遮罩可读；x86 模拟器上 blur 不可见，仅呈现半透明压暗 |

结论：本轮 Web 鉴权改动未破坏鸿蒙端登录与主流程。
限制：blur 材质在该模拟器上不可观测，仍需在真机确认；截图为静态帧，动效与帧率未测。
