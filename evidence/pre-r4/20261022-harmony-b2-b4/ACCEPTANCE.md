# B2–B4 本轮验收记录

日期：2026-10-22。模拟器：Pura 90，`127.0.0.1:5555`，1320×2856px，浅色。HDC 使用用户已有的 18710 端口。没有清空应用、项目或数据库，没有部署后端。

## 构建、测试与安装

- 最终正常包：`projectmemo-final-signed.hap`。SHA-256 `6805c1a477e2df294b02d93a88260bbb5d1426af5ef3f71e6fb9dacdfd1b50e1`。覆盖安装成功，见 `final-install.log`，测试完成后已恢复正常包。
- 最终源码构建：`build-release-candidate.log`，成功。unsigned SHA-256 `8721fe033627842decc9b83368dc8ec7edd0be037ec0240d8ee9e8b681c9e487`。
- 鸿蒙测试 `harmony-test-release.log`：70/70，通过。
- 独立测试库 `web-attachment-regression.log`：6/6，通过。当前原件路由由 Web 已有实现提供，本轮只增加鸿蒙调用方，没有改写其他任务的 Web 修改。
- `git diff --check`：通过。签名配置未改写，未提交或推送。

## 尺寸与字体

临时副本仅在 EntryAbility 增加 `WindowStage.setCustomDensity(1320 / width)` 和 `ApplicationContext.setFontSizeScale(scale)`。API 声明来自已安装 API 24 SDK，日志 `viewport-metrics.log` / `viewport-metrics-final.log` 记录实际 customDensity。正式源码没有这些测试参数。

尺寸测试签名包：`viewport-final-test-signed.hap`，SHA-256 `14be94fef7a6e3bf737342d2c51c10be602d33512fa5a35b8eaf3b301ed4bb9b`。它与正常包的业务页面相同，测试入口差异见 `viewport-harness.patch`。

| 宽度 | 字体 | 最终概览证据 | 结论 |
|---|---|---|---|
| 360vp | 1.0 | `matrix-360-font100-overview.jpeg/json` | 主事项、最近记录、底栏可读；内容可纵向滚动 |
| 390vp | 1.0 | `matrix-390-font100-overview.jpeg/json` | 正常 |
| 430vp | 1.0 | `matrix-430-font100-overview.jpeg/json` | 正常 |
| 360vp | 1.3 | `matrix-360-font130-overview.jpeg/json` | 文本换行，底部记录入口位于滚动区域下方，未横向越界 |
| 390vp | 1.3 | `matrix-390-font130-overview.jpeg/json` | 正常换行 |
| 430vp | 1.3 | `matrix-430-font130-overview.jpeg/json` | 正常换行 |

成果页的 360vp/1.3 字体反例在 `viewport-360-font130-outcomes.jpeg`：旧操作越界。修复后见 `qa-final-outcomes.jpeg/json`，阅读与复制/生成操作均位于卡片内；`qa-final-reader.jpeg/json` 为进入阅读页的结果。没有触发成果生成或付费模型请求。

## 附件隔离验证

测试原件从本机隔离 HTTP 样例服务读取，临时测试入口只在进程内设置固定测试 token，不设置持久化会话上下文，未替换用户账号偏好。真实项目没有上传样例。服务已停止，临时转发已移除。测试副本的签名配置已脱敏。

- 图片原件：`attachment-image-portable.jpeg`。PNG 原件真实请求后写入应用缓存并显示。
- PDF：`attachment-pdf.jpeg`。取得原始字节后提供系统打开与保存。
- 系统无阅读器：`attachment-pdf-open.json` 中显示“暂无可用打开方式”，未引导安装应用或把提取文本冒充原件。
- 系统保存：`attachment-save-picker-ready.jpeg`。选择保存后接收文件 `saved-fixture.pdf`，628 字节，与 `expected-fixture.pdf` SHA-256 同为 `dcbbb0fc4d1380cd437c8db6f5d9edbec59a0dcb80591ac6882a55f0eb476f3f`，详见 `save-byte-verification.json`。
- 404：`attachment-missing.jpeg`，独立错误和重新读取入口；403：`attachment-denied.jpeg`，显示账号无权查看。
- 提取失败仍能打开原件：`attachment-failed.jpeg`。提取文本与原件分开呈现。
- 最初的 PDFKit 静态导入在此模拟器缺少系统模块，导致整个原件页空白；现已去掉 PDFKit 依赖。最早空白截图保留为反例，不算通过证据。

## 17 视图覆盖范围

| 视图 | 当前证据 / 状态 |
|---|---|
| focus | B1 用户已认可；本轮 `balanced-projects.jpeg` 实际为焦点页，文件名沿用采集时命名 |
| projects | 最终测试包 `qa390-projects.jpeg/json`，恢复 B1 筛选外观 |
| memory | `balanced-overview.jpeg` 实际为全局记忆页；该页面本轮后续未再变更 |
| actions | 源码与编译覆盖；本轮未补最终版独立截图 |
| settings | 源码与编译覆盖；本轮未补完整设置/权限状态截图 |
| overview | 最终 6 组矩阵，精简为简介、一个主事项、最近记录 |
| delegate | B1 用户认可的委托页；本轮该布局未变 |
| chat | 编译覆盖，来源入口已连接资料；未发起真实模型问答 |
| materials | `balanced-materials-final.jpeg/json`、`viewport-360-font130-materials.jpeg/json`；原件库用隔离入口验证 |
| projectActions | `viewport-360-font130-actions.jpeg/json`；后续未修改行动布局 |
| outcomes | `qa-final-outcomes.jpeg/json`，修复越界后再验 |
| reminder | 本轮按钮和证据元信息换行编译通过；未补最终版全流程截图 |
| changes | 原/当前状态分区、全部来源入口编译通过；未在真实项目提交确认 |
| actionDetail | ActionBoard 及回执操作编译通过；未向真实项目创建、排程或完成行动 |
| mandateDetail | B1 运行证据；本轮该布局未变 |
| memoryDetail | 保留 Capture、时态与来源、关联原件入口，编译覆盖；未补最终版关联附件截图 |
| outcomeDetail | `qa-final-reader.jpeg/json`，360vp/1.3 字体下进入阅读页 |

## 仍未完成的设备验收

物理真机、已安装阅读器设备上的 PDF 实际打开、深色主题、全量 17 视图在六组尺寸字体下的交互矩阵、键盘/权限全状态及平台联调未完成。B4 只有上面列出的覆盖可报告通过，其余不提升为已验收。

部分早期自动截图期间用户也在导航，导致 `final-overview.jpeg` 等截图与同名布局 JSON 不对应。它们保留为过程记录，不用作最终通过证据；最终概览以 `matrix-*` 和 `qa390-overview` 为准，成果以用户交还控制后采集的 `qa-final-outcomes/reader` 为准。
