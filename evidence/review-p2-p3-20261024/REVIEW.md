# P2 / P3 只读复查（2026-10-24）

结论：P3-B 的公开仓库读取、候选展示、用户采纳和普通顺序重试链路已实现，并有生产验收记录；本轮复查确认 7 类缺陷，另有 1 项来源修订契约需要澄清，暂不能把这轮功能整体标记为验收通过。优先修复下面四项 P1，再扩大试用。

## 版本与范围

- 功能代码基线：`49da9fe3d6a0117bd50cb03360e97d44d3e3271a`。
- 收尾时 HEAD：`c92d52096eea222611240dc2c1896c044e57e224`；相对功能基线仅新增生产验收证据与文档，没有应用代码变化。
- 本轮线上只读 `/health` 返回 `status=ok`、`release=49da9fe3d6a0117bd50cb03360e97d44d3e3271a`。未使用生产账号或执行生产写入。
- 重点检查 P3-A、P3-B、P2-C；抽查 P2 与早期 Mission / Copilot 确认、来源校验边界及低内存部署脚本。没有重新完成 P0–P3 的全部设备与真实模型验收。
- 业务复现使用全新独立 SQLite 库，在导入 Prisma 之前指定路径并重放迁移。GitHub 响应是注入 fixture，模型为 mock；没有真实模型调用、没有 GitHub 外呼。
- 保留已有 `harmonyos/build-profile.json5`、`next-env.d.ts` 修改；没有修改应用代码、提交、推送或部署。

## 发现

### F1 / P1：同项目其他用户的私有委托目标进入经验接口和模型上下文

位置：`lib/experience/service.ts:39`、`lib/experience/injection.ts:23`、`:68`、`lib/experience/extract.ts:118`。

经验的轨迹索引按 `ownerUserId` 读取，但列表与注入仅按 `projectId` 读取，模式唯一键也只有 `projectId + kind + patternHash`。只要两个用户同属一个项目，项目权限检查便不能保护原本按用户隔离的 Mission 内容。

复现 R4：A、B 同属一个项目；由 A 的两条合成成功且已采用轨迹，经真实提炼及显式激活产生经验。持有效 B 会话调用真实 GET 路由，返回 200，正文含 A 的私有目标标记；B 的新 Mission 上下文也包含同一标记。没有调用真实模型，已经在发送前的上下文中确认泄露。

建议：列表、详情建议、上下文注入和提炼去重统一到用户归属边界。调整唯一约束时保留已有历史和 Use 记录，验证同项目两位成员，不仅验证不同项目。

### F2 / P1：采纳缺少原子事务与并发幂等约束

位置：`lib/sensing/repoSource.ts:224–230`。

代码先读取 CANDIDATE，再独立创建 Capture，最后更新信号；请求中的 `requestId` 未作为持久幂等依据。顺序重试能通过，并发和中途失败不能保证一次采纳对应一条资料。

- R1：同信号、同 requestId 的两个并发调用，创建 **2 条 Capture**，返回不同 ID。
- R2：用 SQLite trigger 注入信号更新失败，请求失败、信号仍为 CANDIDATE，却已经留下 **1 条 Capture**。

建议：短事务内重新校验信号归属、状态和关联行动，原子提交 Capture、采纳状态与回执；以持久约束/CAS 保证只成功一次。补充不同 requestId 竞争、相同 requestId 异载荷及响应丢失重试。

### F3 / P1：连接撤销后，已发请求的迟到响应仍写入新信号

位置：`lib/sensing/repoSource.ts:87–89`、`:115–138`。

只在请求之前检查 REVOKED。复现 R3：启动刷新并挂起 fixture 响应，撤销连接，再释放 200 响应。连接最终仍为 REVOKED，但新增 **1 条 ExternalSignal**，刷新状态还写成 OK。

建议：网络请求留在事务外；提交时在同一短事务内重新核对 ACTIVE、当前授权与连接版本/fence。撤销后历史继续可读，迟到结果不能新增信号或推进游标。覆盖撤销、撤权和刷新重叠场景。

### F4 / P1：生产验收脚本会在执行期间把 accessToken 明文写入文件

位置：`evidence/p3b/prod-acceptance/runner.mjs:15`、`:67–69`、`:257–259`。

`login()` 将令牌赋给 `state.token` 后调用 `saveState()`，而该函数序列化整个 state。finally 才删除 token。README 的“从未落盘”与实际实现不符，异常终止时还可能遗留令牌。

本轮只检查当前 state.json 的属性存在性：**当前没有 token**，没有证据证明有效令牌已被提交到仓库。使用原 runner 的副本、合成登录响应及拦截所有 fetch 的本地探针，确认 `persistedBeforeFinally=true`、`cleanedAfterFinally=true`。未读取真实令牌。

建议：令牌存放在独立进程变量；持久 state 使用字段白名单，不能序列化认证对象。更正验收说明。检查历史提交和遗留文件时只输出命中布尔值/路径，不能打印令牌；如发现仍有效的遗留凭据，撤销对应会话。

### F5 / P2：刷新未完整持久化时仍推进游标与 ETag

位置：`lib/sensing/repoSource.ts:107–135`。

- R8：旧游标之后新增 40 条 commit，接口第一页只取 30 条，未遇到旧游标就推进到最新 SHA 并报告 OK；后续 304 无法补齐被跳过的 10 条。
- R9：用 SQLite trigger 注入其中一条信号保存失败，catch 将其当作去重吞掉，仍报告 OK、推进 cursor 并保存 ETag。

单次 30 条可以保留为最小范围；问题是未区分“截断/缺口”与完整刷新。建议明确 partial/gap 与可续取游标；仅吞已知唯一约束错误，其他持久化失败不确认消费对应区间。

### F6 / P2：新任务第一步绕过协议版本兼容检查

位置：`lib/mission/contextBuilder.ts:67–69`、`lib/experience/injection.ts:31–35`。

兼容版本来自已经执行的步骤；新 Mission 的步骤为空时协议为 null，条件直接跳过。复现 R6：经验仅支持协议 99，零步骤的新任务仍注入该经验。工具兼容判断同样依赖过去已经使用过的工具。

建议：对照当前运行时协议和工具注册表判断，不能等待第一次工具调用之后才判断；未知或不支持的版本应停止注入并说明原因。

### F7 / P2：修改无关资料，会重新弹出用户已选择“不知道”的问题

位置：`lib/decision/questions.ts:105–108`。

`changedRoots` 不按当前问题或 Mission 的影响路径过滤。复现 R7：用户对 Dice 问题选择 UNKNOWN 后问题隐藏；随后把完全无 Dice 内容的“周末课程安排”改为“周末课程调整为周一晚课”，原问题再次出现。

建议：只用与当前问题/Mission 相关的来源和影响路径生成上下文指纹；无关编辑不清除 UNKNOWN/SNOOZE 等抑制，新相关证据到来才重新评估。

## 待澄清：经验是否依赖来源事实的当前版本

R5 探针观察到：样本步骤/成果引用的卡片被修订后，旧经验仍注入。这里不能仅凭“发生修订”判定缺陷：当前 WORKFLOW 提炼的是历史工具顺序与用户采用记录，卡片内容变化未必推翻这条历史方法。路线图写了“修订/冲突时不再新注入”，但尚未明确指经验修订，还是所有样本来源修订。

因此 R5 仅记录行为，不计入已确认缺陷。后续应区分历史方法与依赖当前来源事实的建议，再决定是否引入来源失效检查；不能将任何卡片编辑一律当作经验无效。`results.json` 中 R5 的 `expectedInvariant=false` 是探针自设假设未成立，不代表该假设已成为产品契约。

## 执行过的验证

| 检查 | 本轮结果 |
|---|---|
| P2/P3/部署针对性单元测试 | 7 文件、73 项通过 |
| 全量 `npm.cmd test` | 107 文件、870 项通过，257.82 秒 |
| `npm.cmd exec tsc -- --noEmit` | 通过 |
| `npm.cmd run lint` | 通过 |
| 独立库边界探针 | R1–R4、R6–R9 复现缺陷；R5 仅为上述待澄清项；详见 results.json |
| 合成令牌生命周期探针 | 复现执行期间落盘；finally 正常结束后清除 |
| 线上 `/health` | status=ok，release=49da9fe |

现有 870 项通过，说明现有回归未被破坏；没有覆盖上述新边界。缺陷探针不是已通过的产品验收用例；`expectedInvariant=false` 表示探针设定的不变量未成立，R5 的契约解释见上文。

生产 14/14 的既有记录覆盖普通接口流程；本轮没有重跑这些外部写入。未重跑 Web E2E、HAP 构建或设备验收，未运行真实模型或真实项目效果对照。低内存部署拆分类型检查和 build 的路径已有针对性测试，本轮未发现可复现的新阻断问题。

## 重现与材料

在仓库根目录执行，脚本只向新建 `tmp/p3-readonly-review/<timestamp>/` 独立库写数据：

```powershell
node --import tsx evidence/review-p2-p3-20261024/repro.ts
node evidence/review-p2-p3-20261024/token-persistence-probe.mjs
```

`repro.ts` 中的功能 commit 标记是本次复查基线；后续修复后再运行应在新报告中绑定实际 HEAD。脚本保留 SQLite fixture 库在 tmp，不应提交该库。

- `results.json`：9 个业务边界探针结果，只含合成 ID 与观测值。
- `token-results.json`：合成令牌生命周期探针布尔结果。
- `unit-full.log`、`targeted.log`、`types.log`、`lint.log`：本轮检查日志。
- `HANDOFF_PROMPT.md`：按上述优先级修复的交接指令。
