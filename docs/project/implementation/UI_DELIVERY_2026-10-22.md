# 2026-10-22 Web 与 HarmonyOS UI 交付

## 提交内容

- Web：今晚的工作台、焦点、项目分区、资料/附件预览、委托、行动、成果与共享样式修改；个人项目 Agent 宣传首页及其字体、滚动与交互动效。
- HarmonyOS：B1–B4 视觉统一、附件原件查看/保存、项目概览减重、行动/资料工具区比例调整，以及长期委托入口与表单重做。
- 测试：Web/E2E 文案及导航适配；鸿蒙新增展示逻辑测试；附件服务测试加载真实展示依赖并覆盖原件下载鉴权、路径编码、字节与请求释放。

## 验证记录

| 检查 | 实际结果 |
| --- | --- |
| Web 单元/集成 | 82 files / 658 tests passed，见 action-mission-form/commit-unit-final.log；此轮完成后新增的首页展示另做下列构建和浏览器检查 |
| 最终 TypeScript / lint | 通过，见 web-home/types-release.log、lint-release.log |
| 最终生产构建 / E2E | 通过；14 expected、0 unexpected、0 flaky，见 web-home/e2e-release.log、e2e-summary.json |
| HarmonyOS 测试 / 构建 | 70/70；ArkTS 与 HAP 构建通过，见 action-mission-form/harmony-test.log、build-final.log |
| 模拟器 | 最新签名包已增量安装；项目行动、资料、委托入口与表单、全局记忆分类已截图核对 |
| 首页浏览器 | 320/390/768/1440px 无横向溢出；点击、键盘、减少动态效果、登录入口核对通过 |

路径前缀均为 evidence/pre-r4/20261022-。详细边界见各目录 ACCEPTANCE.md。首页开发服务的 HMR 异常与最终生产预览分别记录。

## 本地保留

签名配置、签名私钥、数据库、HAP、工程备份与本地工具目录不纳入提交。临时 native-fixture 工程移至仓库外保留，避免 Web 工具扫描鸿蒙生成依赖。历史验收数据不清空。本次只做本地 commit，没有 push 或公开部署。
