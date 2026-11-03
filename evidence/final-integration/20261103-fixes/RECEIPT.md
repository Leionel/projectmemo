# A/B/C/D 集成修复回执

日期：2026-11-03 UTC+8。工作树 D:/Projects/hongmen-final-integration，分支 codex/final-integration。
业务修复：`05b5dc8203cdf44eb0ebec8b9c104fa4ee8e2cd2`；最终待审候选：`b8028e3ddb84c5b4ab7e11502a1abf042c4b4cf2`；父提交 3e5292e。测试及构建开始时为该源码的未提交内容，期间未继续修改业务源码；提交只是固定已有修改。SOURCE_MANIFEST.json 记录本次 23 个变更文件的内容哈希。

## 修改

- A：回答必须绑定仍未解决、确实存在的同 Mission QUESTION；resolved、null/缺失 waitState 及观察冒充问题返回 409。保留后续观察不覆盖原问题的合法回答。
- C：按原 questionId 定位；在途重读/外层版本推进禁用旧包；保留 generation 围栏。有效边界定时失效并只读重查，已过期回包不循环请求。重读提示改为发起状态。
- D：原始来源谱系不再显示为独立支持成果；Capture 返回同项目，按 captureId 精确展开已有原记录卡，缺失时不指向另一张卡。用户查看原文不改变委托许可。
- B：用户激活视频后只交接一次焦点，移除延迟定时及 onLoad 抢焦点。
- 集成兼容：C 测试 fixture 补 sourcePolicyChecks；perf 脚本补明确读取类型，旧并发脚本 let 改 const，消除阻断 lint 的既有错误。未改变测试断言门槛。

## 实际验证

| 检查 | 结果 | 证据 |
|---|---|---|
| 服务端+E 独立反例 | 9 文件，119 PASS，exit 0 | 本轮工具实际输出，未另捕获原始日志 |
| Web C/B 定向组件 | 4 文件，28 PASS，exit 0 | web-targeted.log |
| tsc --noEmit | exit 0，无诊断 | types.log（空文件仅代表无诊断；退出码来自工具） |
| 全库 lint | exit 0，0 error / 26 warning | lint-final.log；首次失败另保留 lint.log |
| 鸿蒙 Hypium | 135 项，Failure 0 / Error 0 / Ignore 0 | harmony-test.log |
| 鸿蒙 HAP | 构建 exit 0，unsigned，8,284,254 bytes | harmony-build.log |
| HAP SHA256 | 5a713c26d213fce90ce45932177817e1f3e97152c82578eb2aa9e74222f89029 | 集成树当轮产物 |
| Web 生产构建 | 两轮均成功；见后述版本绑定 | e2e.log / e2e-final.log |
| 全 E2E 首轮 | setup1 + 业务35 PASS / 2 SKIP / 1 FAIL，exit1 | e2e-first-results.json |
| 全 E2E 第二轮 | setup1 + 业务35 PASS / 2 SKIP / 1 FAIL，exit1 | e2e-second-results.json |
| 全量 Vitest | 本轮 NOT_RUN | 不能用历史 checkpoint 的 1702 PASS 代替 |

独立测试库由现有 Vitest 配置与 E2E 隔离脚本创建，不使用用户库。模型为测试规则/mock；本轮未付费调用、未启动真实 Worker、未改真实数据库、未外部写入。

## 合同迁移

E 原作者提供的迁移经核对接受。legacy observedAt 是读取时刻，不要求恒定；成功观察改验 observation.lastSuccessfulAt。迁移后 E 套件 6 文件/49 项，是上表 119 的子集，不能重复相加。旧 33 项与红断言没有被改写为“原样全绿”：原副本保存在 e-test-migration/*.before.txt；更早红日志保留在 20261103-review 与 E 原树。迁移申请全文随本回执保存。

Web 28 + 服务端119共147项为两组不重叠定向用例；135是原生测试，单独统计。

## 尚待验收与风险

- 当前 unsigned 不能当作候选签名安装；未复用主目录签名或旧设备包。模拟器/真机交互 NOT_RUN。
- 原记录入口复用项目现有 KnowledgeCard；Capture 若无卡或未被项目接口返回，仍显示未找到，不能宣称所有 Capture 原文均可达。需在独立审查中检查实际覆盖与必要补全。
- 真实后台 Worker、真实模型、自然日三日责任与独立用户价值验收，本轮均未启动。
- 本轮不合 master、不 push、不部署。合并须等待独立审查、全量回归及已声明 Gate 的裁决。
- 主目录 build-profile.json5 / next-env.d.ts / tsconfig.json 的前后 hash 一致，见 main-protected-before/after.json。其他 Track 工作树和历史证据保留。

下一步使用本目录 INDEPENDENT_REVIEW_PROMPT.md。主目录本地任务书也存有同文副本 `17_修复后独立审查Prompt.md`。后续审查不创建 subagent。

## 邮箱账号链路状态（用户补问）

代码具备注册、邮箱验证、重发、找回密码和 SMTP/Resend 发送实现。登录端点仍按 username 精确查 User，不支持邮箱作为登录标识。真实 ECS 邮件配置、投递、收取、激活和重置尚未核验；本轮不修改线上配置或发送邮件。不能称邮箱登录完整交付。

## 首轮 E2E 失败与修复

首轮总39项：setup1 PASS + 业务35 PASS / 2 SKIP / 1 FAIL / 0 flaky，exit1。失败为旧用例定位已更名的读回 region；9a28dd3 仅同步名称，保留所有费用/结果/接续断言。原结果和错误上下文已另存，重跑不覆盖首轮证据。最终结果待补。

## 补充兼容修复与账号回归

b8028e3 增加部分 workPacket 缺 next/authority 时的空值保护。注册测试先通过 continuityDatabase 在临时目录重放全部迁移，退出后只清理经前缀校验的该临时目录；未升级默认测试库或真实库。

新增检查：5文件40项 PASS（account-readback-final.log），包含前述新鲜度5项，不能和147直接相加；本轮去重共182项定向通过。首次补跑15失败/20通过及空值异常保留在 account-readback-tests.log，不能抹掉。最终 tsc exit0（types-final.log），补改文件 ESLint exit0（followup-lint.log）。账号模块真实发信仍 NOT_RUN。

第二轮完整 E2E 的业务源码为9a28dd3，包含八项业务修复和定位器同步，但早于 b8028e3 的空值防御；不要把它写成最新候选全套通过。第二轮 Mission 完整旅程通过；固定指标核算失败，页面显示 APPROVAL 阶段 EXECUTION_FAILED 并暂停，步骤 UNKNOWN。该用例首轮通过、第二轮失败，根因未定，不能称纯负载问题或靠增加 timeout 放行。定向复现另记 e2e-experiments.log。此问题仍阻断回归放行。

两轮各自总39：setup1、业务38。跳过的两条均来自 legacy E2E 的 Focus review/follow 功能旗标关闭，不代表相关能力验收。没有配置自动重试（retries=0）。

## 最终定向 E2E 与收尾

最新 b8028e3 的隔离生产构建成功；experiments 定向 E2E exit0，setup1 + 业务1 PASS / 0 skip / 0 unexpected / 0 flaky。完整回归中的间歇失败仍保留为待查，不用这次定向通过替代完整放行。全量 Vitest 本轮未跑；候选没有合主干、push 或部署。

E2E 脚本覆盖的历史截图已先留存新副本，再从本树原提交恢复；脚本产生的 untracked 浏览器证据移动到 tmp/final-integration-artifacts/20261103-fixes，映射见 GENERATED_ARTIFACTS.json。没有改写旧验收图。next-env.d.ts 仅恢复本轮构建生成的改动；主目录三份配置未改。
