# 2026-09-12 更改验收

基准：HEAD ea2fa19，工作树已有 next-env.d.ts 修改。结论：实现有实质进展，但 P0/P1 和参赛 HAP 交付均不能整体通过。未修改业务代码；新增隔离探针和本报告。

## 本轮实测

- npm.cmd test：28 文件、186 测试通过。
- npm.cmd exec tsc -- --noEmit：退出码 0。
- npm.cmd run harmony:build：成功，但明确提示无 signingConfigs，跳过签名。
- HAP：entry-default-unsigned.hap，2442876 bytes，SHA-256 d7c700160eacdce929476dd180c9978009318c4f092f1783d2957a883bed1da3。
- 自建独立 SQLite，重放迁移后运行 evidence/acceptance-20260912/probe.ts，结果保存在同目录 results.json；不以现有单测通过替代负向验收。
- 本轮未执行设备安装、模拟器交互、小艺平台调用或真实用户验证；旧日志不作本轮通过证据。

## 必须修复

### P1：状态回退复用了历史行，最新状态仍停在旧值

`lib/services/projectStateService.ts` 的 refreshProjectState 按 sourceHash/policy/evaluation 搜索所有历史快照，找到就返回 reused，不判断它是否为当前最新行。

实测同一项目 goal=A → B → A：第三次返回第一次 A 的 ID、reused=true，但 getLatestProjectState 仍返回 B。用户看到的“当前状态”和数据库事实不一致。现有往返测试通过新增卡片制造不同 sourceHash，没有覆盖原字段恢复原值。

修复方向：仅当最新快照对应当前源版本时复用；回到旧内容也须产生新的状态发生记录。相应调整唯一键/版本方案，补原字段往返测试，不能只删除检查而保留会冲突的历史唯一键。

### P1：快照没有复用 Ledger，矛盾关系被当成支持

`lib/projectState/buildSnapshot.ts` 将所有非 SUPERSEDES 的已确认关系视为 hasConfirmedRelation，包括 CONTRADICTS。实测两张卡建立已确认 CONTRADICTS 后，两条事实均输出 truth=TRUE、文本“当前有效结论”，同时 temporalStatus=PENDING，自相矛盾。

此外源输入未携带 validFrom/validTo，构建器也未检查 confirmedAt 的时间边界；不能与现有 Ledger 保持一致。

修复方向：复用统一时态计算，明确冲突/待确认/撤销/未来生效的结论规则；补 CONTRADICTS、有效期和独立事实确认用例。

### P1：行动可行性将证据不足视为前提满足

`lib/services/actionFeasibilityService.ts` 的 card 分支只特殊处理 SUPERSEDED、PENDING、CONFLICT，其余均返回 MET。

实测创建一张没有确认和支持关系的 idea 卡并作为硬依赖，评估返回 READY，依赖文案“当前有效”。INSUFFICIENT、REVOKED 或缺状态不应通过兜底成为 MET。

修复方向：明确 MET 的允许状态；证据不足返回 UNKNOWN，撤销按依赖语义返回 UNKNOWN/UNMET，补负向测试。

### P2：内容哈希包含观察时间

`buildSnapshot.ts` 把 evidenceRefs.observedAt 放入 payloadCore 后计算 contentHash。实测相同事实仅 now 相差一秒，contentHash 就不同。当前 sourceHash 命中可暂时掩盖，但重建/时间边界/源顺序变化时会把观察时间当作业务变化。

修复方向：用于比较的业务投影排除观察时间；历史审计仍保留时间。另将源数组规范排序后散列。

### P2：源数据读取不在快照事务中

projectStateService 在 db.$transaction 之前 loadSourceInput，并以多次查询读取源数据；事务仅保护快照写入。与实施记录“源读取一致”的目标有差距，并发写入时可能拼接不同版本的数据。本轮为代码证据，未进行并发故障注入。

修复方向：让源读取接受同一事务客户端，或采用可验证的版本重读机制；事务内不调用外部服务。

## 功能完成度

源码和提交已覆盖 M1/S1/B1/C1/F1/T1 的服务与部分界面，认可实施进展。实施记录也如实标 IN_PROGRESS。

- T1：记录明确会议粘贴、逐项勾选、确认的鸿蒙界面未完成。
- F1：依赖和估时编辑界面未完成，仅有 API 与查看结果。
- B1：曝光上报未接入，不能形成完整曝光/反馈分母。
- R1：成果引用仍是上下文卡片粒度，不是逐句 claim 绑定，不能宣传完整逐句核验。
- R3/R4：平台对账和用户验证未在本轮完成。

以上记录中的缺口不能仅靠后端测试通过关闭；新增界面还需设备交互验收。

## HAP 交付关口

当前构建脚本固定 buildMode=debug；harmonyos/build-profile.json5 的 signingConfigs 为空。实际产物只有 unsigned HAP，且 Constants.ets 的 BASE_URL 是 http://10.0.2.2:4400。

因此本轮只通过“可编译打包”，没有通过“评审设备可安装并独立联网使用”。交付前需要：按主办方安装/签名要求确定交付方式，配置相应签名；将后端切换为评审设备可访问的部署地址；在目标设备安装该最终包并验证录入、状态、证据、行动闭环；再保存最终 HAP 哈希与安装说明。不要将当前 unsigned 开发包直接标为已验收参赛包。

建议先修三个 P1，再补 UI 收尾及交付配置。以上为有界验收，不代表未阅读的所有代码均无问题。
