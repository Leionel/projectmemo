# 项目页比例与长期委托表单复改（2026-10-22）

## 实际改动

- 项目工作区行动页：移除两张大数字卡，标题、新增和安排时间合并一行，真实数量改为文字摘要，筛选紧随其后。保留原行动、演示标记、完成回执与日历路径。
- 项目工作区资料页：移除重复标题；项目记忆、附件原件和新增同排；搜索与类型筛选合成紧凑工具区，减少工具区对白色卡片列表的挤占。保留类型代码 experiment_log 等契约。
- 项目工作区委托页：增加直接“新建长期委托”入口，问忆程改为较小卡片。列表页也保留新建入口。
- 新建长期委托：固定必填目标、执行方式、模型资料授权；时间与限制、公开网络研究默认折叠。展开后提供固定标题、单位、留空含义和示例；截止时间使用系统日期/时间选择器，优先级使用选择列表。编辑模式继续回填原值，折叠不清除字段。模型和搜索授权仍分开保存，不自动授权；版本校验和提交幂等沿用原服务。
- 全局记忆：按用户后续要求，仅扩大搜索框下方分类文字的横向内边距和点击高度，四种分类可同时完整显示。

## 验证

- `npm.cmd run harmony:build`：通过（build-final.log）。首次构建暴露 Select 字体属性不匹配，改为原生 font 属性后通过。
- `npm.cmd run harmony:test`：70/70（harmony-test.log）。
- 受影响四个源码文件 `git diff --check`：通过。
- 使用已有签名增量安装成功，未卸载或清空应用。
- 已在模拟器项目工作区确认行动页顶部、已完成筛选空态、资料页工具区、委托页直接新建入口、默认表单、可选约束展开和系统日期选择器；返回路径正常。
- 已确认全局记忆四类筛选的更宽间距。截图与布局 JSON 保存在本目录。
- 本轮没有提交有效委托、调用模型或修改真实行动。创建写入、真机、其他字号和完整设备矩阵未重验。

## 安装包

- projectmemo-refinement-signed.hap
- SHA256: 57da83374ae712ed464c9e4f4b09d892709f82b7d04e775108fc22c15c09e1dc
- unsigned 构建 SHA256: b5d181fadb1be1462a0c34355be7d0f406aea194b613d1e732ee3d77049d3926
- 设备目标：127.0.0.1:5555；bundle：xyz.luojiatutor.projectmemo。

## 关键截图

- project-actions.jpeg / final-project-actions.jpeg：具体项目行动页。
- project-actions-done.jpeg：已完成筛选。
- project-materials.jpeg：具体项目资料页。
- project-missions.jpeg：新建委托入口。
- mission-create.jpeg：新建委托首屏。
- mission-limits-fields.jpeg：展开后的约束字段。
- mission-date-picker.jpeg：系统日期选择器。
- global-memory.jpeg：全局记忆的分类间距。
