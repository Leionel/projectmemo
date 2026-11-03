# A/B 集成审查与额度收尾交接

日期：2026-11-03 UTC+8。原主干 485d485；A 3824a96（服务 d428314），B abc8bf8（源码 9bae926）。本轮只进入 codex/final-integration，master 不动，不推送、不部署、不迁移用户库、付费调用 0。

## 实际修复

- 来源当前许可未知/抑制时，普通 readback 对旧消费者返回 UNAVAILABLE 和空摘录；revisionAvailability 保留真实修订匹配，历史 facts/源身份不删。availabilityMeaning 更新为 REVISION_MATCH_AND_CURRENT_USE_POLICY；C/D 须兼容旧服务缺字段。
- 来源 CHANGED、UNKNOWN 或许可缺失不得继续沿用无变化结论。许可掩蔽后仍保留修订变化阻断。
- 正常暂停、取消、预算和模型格式错误不推断成观察失败。runner 仅为明确的声明观察失败追加审计 purpose/stepId；不改调度、权限或执行器。
- readback 第二只读事务重新鉴权并核对 controlVersion；连续控制变化重读后仍不收敛返回 WORK_PACKET_AUTHORITY_CHANGED/409，避免旧消费者读到已知撤权快照。仅 Mission version/updatedAt 变化仍可 VERSION_ADVANCED。发布时重新计算时间边界。
- 官网 Hero 状态跟随阶段；运行中切换 reduced-motion 可取消帧/监听/视差，CSS 同步兜底。

## 验证与未通过项

修复代理实际执行最终定向：7 文件 67 项，66 PASS/1 FAIL，退出 1。分项 A 服务/真实双连接并发 24/24，E 新独立观察合同 10/10，E 原套件 32/33。B 新增真实组件 jsdom 回归 3/3，定向 ESLint 退出 0。源码差异格式检查通过。类型结果见 types-final.exit/log；首次类型失败来自本轮归档原测试相对 helper 路径失效，已把历史副本保存为 .ts.txt，原内容不改。

剩余红例是 E-F03：原断言要求 legacy readback.observedAt 恒定，但原 Web/鸿蒙均标“读取于”。A 保留该兼容语义，成功观察改读 observation.lastSuccessfulAt。两组独立源码复核同意这是字段合同误判；原 E 树、33 例和原红日志保留，不写成原套件全绿。新增独立用例验证无观察 null、成功时间稳定、后续失败与控制停止等真实合同。

E 原报告针对 485d485，其“A/B 尚未提交”是历史状态，不适用于当前。E-F04 原 P0 泄漏定性证据不足（本人读取历史），但旧客户端不识别抑制确有信任风险；本轮提供兼容默认保护，C/D 仍要补历史/当前许可的清晰呈现。

浏览器实测见 homepage-followup.log：三个阶段标题正确；normal→reduce→normal 热切换，translate=none/shift=0；1440/390 无水平溢出；记录全部本次浏览器请求，非读取请求和外域请求均为 0。服务端到 provider 流量未单独仪表化，不能由浏览器推断模型调用数。已关闭本次预览与浏览器。

## 准备证据裁决 E-EV01/02

旧准备窗口只作为 485d485 的工程/UI 基线。旧 modelCalls:0 是未仪表化的声明，应视为 UNKNOWN_FROM_BROWSER，不作为动态联网证据；privateWrites 监听面有限。旧空 tsc 日志配退出码只说明当时记录无诊断，不是日志本身证明通过。D 树原生109/unsigned与E树定向测试分开；主目录保护hash不能拿来核对E的文件。

旧日志不追加伪造运行头，不改写历史。新候选验收由 E 在开始/结束记录真实 SHA、dirty/源码hash、工作树、UTC+8、DB/provider、命令、退出码、分母及产物归属。规划目录被忽略是有意的本地文档边界，不等于产品缺陷；对外证据须另脱敏并按精确文件提交。

## 下一步与 Gate

C/D 可以从本集成检查点同步源码后并行实施；本检查点不是最终放行。不得直接合 master。完整集成 Vitest/lint/生产 build/E2E、C/D 新客户端与旧服务兼容、签名安装、真实 Worker、实模、自然日及独立用户仍待各自验收。

集成树 tests/final-e/ 为本轮从 E 原树原样复制的未提交审查套件，含上述已裁决旧断言；不要误当为已提交全绿测试。不可删除/skip/悄悄放宽换绿。E 应保留原红证据，并单独审批测试合同迁移、补更强新合同断言及新的准确分母。

主目录原 build-profile/next-env/tsconfig 不覆盖。A/B 原树及 E 未提交工作保留。资源不足收尾，不继续新增功能；后续 Prompt 在主目录本地规划的 06_Codex任务书/16_第二批ABCDE收尾Prompts.md。
