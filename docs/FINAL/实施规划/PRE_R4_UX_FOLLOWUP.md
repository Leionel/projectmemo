# Pre-R4 UX 补齐与复查

日期：2026-10-22。工作树：`D:/Projects/hongmen-r3-release-merge`，分支 `codex/pre-r4-ux`，起点 `4da0183`。原目录 `D:/Projects/hongmen` 有用户未提交修改，继续保留。用户 Demo 只作为设计参考，不修改原文件。

## 实施约定

用户任务：重新进入项目时知道发生什么、需要自己做什么，并能继续原委托。当前缺陷是双端焦点不统一、同一事项重复占位、首次资料到委托缺少连续引导、项目演进只展示快照差异。

目标：一个焦点、一个待处理队列、真实进展和就近来源。导航使用链接，完整任务继续进入原页面；不建立新Runtime、不加入R4影响或Scenario后端，不用固定百分比描述Agent进展。权限与业务写入沿原服务。规则：`rule/one-primary-action`、`rule/structure-before-containers`、`rule/navigation-vs-action`、`rule/cover-reachable-states`、`rule/empty-state-action`、`rule/preserve-user-input`。

## 工作包与关闭条件

| 包 | 范围 | 完成证据 | 状态 |
| --- | --- | --- | --- |
| F1 | 双端统一焦点顺序；高风险/待回应/截止/运行任务/行动；排除演示提醒；减少重复；重要行动移出高级区 | 跨端优先级11场景；真实浏览器桌面/390宽/320大字；unsigned HAP | 本地验证通过，设备待验 |
| F2 | 冷启动：真实资料→已有状态/记忆→可编辑首委托；已有资料不重复教学；原功能入口兼容 | E2E实际创建→资料→模板/只读约束→两项等待任务→回原任务；模板不代勾云模型许可 | 本地验证通过，用户走查待验 |
| F3 | 现有Ledger决策演进、来源/确认时间/取代关系；已发布Episode入口；状态摘要部分失败降级 | 真实DTO/授权失败测试；浏览器演进页；native源码定位与HAP | 本地验证通过，设备待验 |
| F4 | Mission最近进展置前，旧输出按需；重试/输入/401/版本冲突核查；双端语义、触达和焦点收口 | 父面板超时读回/稳定请求编号通过；材料/成果子流程再复审 | 复审中 |
| F5 | 原方案P00–P40逐项对账，记录已实现/待验证/R4依赖及每阶段commit | 本文与总实施记录一致 | 待实施 |

## 验证边界

Web本地隔离mock、原生契约/构建、模拟器/真机、真实模型和在线服务分别记录。没有设备不代表代码不做，但不能标设备验收通过。每阶段检查通过后commit；不push、不部署。原Demo未获得可渲染读取权限，本轮不绕过浏览器限制。

### F1/F2 阶段检查

23项既有/新增检查与2项引导检查通过，TypeScript通过。unsigned HAP SHA256：`6c0b90d526bcb7a9d7ba25110a761785f6a45e9af5afeecee39f09056150af20`。日志位于 `evidence/pre-r4/20261022-followup/f12-*`、`f2-guide-tests.log`；首次引导测试后缀未纳入仓库Vitest匹配规则，已改成`.test.ts`并单独实际执行，不把未运行项计入通过。没有设备/在线验收。

### F1–F3 与父面板阶段验收

75文件632项单元/集成、13项E2E、lint、TypeScript、隔离生产构建通过。E2E开启现有State与Episode开关，不再只覆盖关闭状态。鸿蒙60项检查和unsigned HAP通过；SHA256：`82b2e7b55b5ae70996eeb001e9c4459a7f674f18282e98cc7a64597429d2ada6`。

首轮E2E的旧入口断言和测试写入Origin问题已修正；第二次未重建隔离库导致演示提醒被上一轮消耗，未计为最终通过。最终使用完整`test:e2e`重建独立库，13项无失败/重试通过。ArkTS新增字段enabled与系统组件方法冲突，改为relationsEnabled并重新编译。失败日志保留，不删改为PASS。

### 用户原目录修改

原目录commit `3c46a6d` 保存会议空变化提示、删除system_core通知控制权限声明、ESLint tmp排除和测试类型修正；发布工作树接入为`4fcdbf7`。仅测试断言冲突，保留发布分支更完整的对象断言。SDK本地PermissionDefinitions.json核对该权限为system_core，应用通知沿原requestEnableNotification授权。原目录测试首轮在并行构建负载下超过5秒，单独重跑3项2.97秒通过；发布树对应3项亦通过。签名配置、next-env和散落本机日志不提交。
