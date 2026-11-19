# 来源信息可读性修正

- 工作台来源改为名称、原记录时间、本稿引用时间和版本状态；修订/来源/校验标识保留在默认折叠的“技术信息”中，重复的修订哈希不重复展示。
- 稿件版本增加时间与时钟图标，过程按实际事件类型显示读取/交接/产稿/等待图标。时间取原持久记录，未记录时明确降级；不把哈希或当前刷新时间冒充版本时间。
- 旧委托稿件、成果归入预览、文档原页、对话来源抽屉和鸿蒙成果页同步去除默认裸 ID/哈希，增加名称、时间或引用数量与图标。身份、版本守卫、来源权限和引用定位仍使用原值。
- 只读工作台 DTO 增加可选 `observedAt`/事件 `kind`；无 Schema/Migration，无新依赖，无部署。

验证：5 文件 / 55 条定向回归通过，含历史引用时间保持原值与来源停用回归；类型、scoped ESLint、Web 生产构建通过。鸿蒙测试 160/160，ArkTS/unsigned HAP 构建通过；未做真机安装。本轮为展示与附加只读字段变更，未重复全量套件。

```powershell
npm.cmd test -- tests/v2FirstSlice.test.ts tests/v2SkillArtifacts.test.ts tests/missionPanel.test.ts tests/missionArtifactAdoptionPanel.test.ts tests/missionNativeContract.test.ts
npm.cmd exec tsc -- --noEmit
$env:NEXT_DIST_DIR='.next-readable-sources'
npm.cmd run build -- --webpack
npm.cmd run harmony:test
npm.cmd run harmony:build
```

浏览器实测：来源与稿件时间显示、技术标识默认隐藏/可展开、360px 展开与收起无横向溢出、旧委托稿件无裸来源 ID。截图与结果见 `evidence/v2-first-loop/readable-sources-20261117/`。

预览使用新隔离合成库和本机 mock，原演示数据库保持不动。直接复用运行中临时库的预览启动被自动审查拒绝、未执行；已换成新建隔离样例完成验收。新预览地址见 `preview.json`。无真实项目写入或付费调用。
