# 决赛集成与邮箱登录独立复核

开始日期：2026-11-03 UTC+8。候选 884378b8c18740be883ae403186c967b67c13470，原 master 485d485。

## 范围

复核 final-integration 到 final-auth 的新增认证代码，并检查 A/B/C/D/E 的祖先覆盖、原未闭合回归与主目录保护。未使用子代理。

## 源码审查

- 同一 username 请求字段兼容两类输入；用户名维持原精确匹配，邮箱复用 trim/小写且保留 +tag/点号。
- 用户名与邮箱冲突时按密码唯一命中，不随意选账号；多账号密码同时命中统一拒绝。
- 登录仍复用原密码、邮箱验证状态、Session/Cookie 和项目成员关系，切换标识共用 IP+账号限流桶。
- Web 与鸿蒙保留输入、区分未验证/服务不可用/网络失败，邮件验证不会被描述为 App 已自动登录。
- 候选包含现有 final A/B/C/D/E 以及前次修复。没有新增 schema/migration、依赖或签名配置；未将私钥、数据库或 HAP 纳入本次新增跟踪文件。
- 历史 s2-independent-audit 剩余独立审计文档不属于本次业务合并范围；不盲目合并所有历史分支。

## 独立验证

- tsc exit0；全库 lint exit0，0 error / 26 warning。
- 独立默认测试库明确指定为本工作树 prisma/test-vitest.db，先 migrate deploy，不触碰真实数据库。
- 修复前完整基线：229文件1820项 PASS，exit0，724.63秒（vitest-full.log）。最终修复后全量待执行。
- 全量 E2E：待执行。历史 fixed metric E2E 的一次 EXECUTION_FAILED 不会被定向通过记录抹去。
- 鸿蒙：复核当前候选已有 Hypium139项/零失败日志；当前 unsigned HAP 哈希与原回执 1bdd771f...4114d96d 一致。本轮未安装，不能冒充设备通过。

## 现场保护

main-protected-before.json 仅记录主目录三份未提交配置哈希，不读取签名内容。未跟踪文件冲突检查为0（untracked-collisions.json）。未发邮件、未调用付费模型、未启动真实 Worker、未部署或外部写入。

真实发信、签名设备、自然日和用户价值验收仍须分别开展；源码合入不改变这些状态。

## 本轮发现并修复：AUTH-RACE-01（P1）

原登录在密码校验后、会话创建前没有凭据提交围栏。两个真实路由反例稳定复现：密码重置已提交，旧密码在途登录仍200；邮箱验证资格被撤回，在途登录仍200。原红结果见 login-race-red.log。

ca0dea6 将已校验密码哈希作为服务端提交条件传入原 createSession。会话插入前在同一数据库事务复核密码哈希和当前邮箱资格；重置先提交则拒绝旧凭据，登录先提交则由原密码重置事务撤销其会话。密码计算仍在事务外，保留旧调用方的无凭据参数行为，不新增会话表、状态库或认证框架。

修复后真实路由反例及受影响认证测试9文件84项全通过（auth-targeted.log）；最终类型检查与改动文件lint均exit0。不存在新会话/无Cookie断言保留，新密码正常登录也通过。原生请求合同未变化。

## AUTH-E2E-02（P1，已修）

首次完整E2E为34通过/2跳过/6失败（含setup），原报告另存 e2e-first-results.json。认证分支给评审身份创建 AccountSecurity 后仍保留默认0额度，阻断PR6/UX的合成调用；失败夹具残留又触发后续 createRequestId 冲突。未将错误归因于模型质量或超时。

8c85959 仅给隔离E2E的已验证评审身份配置100次有界合成额度；真实注册和待验证身份保持0。cb0d089 进一步在导入lib/db.ts前检查数据库必须等于本工作树 E2E_DATABASE_URL 且 LLM_MODE 必须为mock，防止脚本被误用于真实账号。新增真实子进程反例通过，拒绝非隔离/非mock时不创建数据库。

重建干净隔离库后，完整E2E exit0：总42项，setup1+业务39通过、业务2跳过、0 unexpected、0 flaky，183.90秒；生产构建通过。两条跳过仍是原 legacy Focus review/follow 旗标关闭，未新增skip。源码为8c85959（cb0d089只增加种子入口保护及反例）；最新入口保护将在后续重复旅程实际经过。

最终全库lint exit0，0 error/26既有warning；当前尚在进行修复后完整Vitest与固定核算重复验证，尚未合master。

## 最终放行裁决

当前未发现剩余源码合并阻断项，允许将本次final A/B/C/D/E集成、邮箱登录与本轮修复合入本地master。安全与功能检查通过，设备/生产/真实模型/邮件投递/自然日轨不因此升级为PASS。

- 最终全量Vitest：231文件1823项PASS，exit0，872.45秒，见vitest-final.log。代码在运行前冻结为cb0d089，运行中d9655e1只整理文档，没有业务改动。
- 最终全量lint：exit0，0 error/26既有warning。类型检查exit0；两次后续E2E生产构建也经过类型检查。
- 完整Web E2E：42项，setup1+业务39通过，业务2跳过，0 unexpected/0 flaky。legacy旗标关闭的两条原skip单独记账。
- 固定核算重复：最新候选生产构建后setup1+业务3通过，0 skip/0 unexpected/0 flaky，44.94秒。实际经过最新测试身份入口保护。三次均使用fakeDocker合同夹具，不是实际Docker内核或生产实验复现。
- 既有原生139项/unsigned候选证据已复核，本轮未安装或重跑原生设备旅程。

历史固定核算曾出现一次EXECUTION_FAILED，原异常根因未定位；本轮完整和3次重复未再出现，保留为后续运行观察风险，不宣称已完成真实沙箱可靠性验收。原红日志未删。

## 文档整理

25份已跟踪根目录文档移入docs/project/{development,architecture,planning,implementation,protocols,audits}，新增索引，更新README及活跃Markdown引用。保留根README/AGENTS/CLAUDE；未跟踪本地文档未擅自搬动或提交。126个相对链接检查无新增断链，15个已有本地资料目标单列记录。docs整体忽略规则没有放开，只跟踪本次明确迁移的文件。

构建覆盖的历史截图已保存本次副本后恢复原提交，映射见GENERATED_ARTIFACTS.json。源码与回归证据分开提交；main三份未提交配置继续按哈希保护。未push、部署、发送真实邮件、运行付费模型或迁移用户库。
