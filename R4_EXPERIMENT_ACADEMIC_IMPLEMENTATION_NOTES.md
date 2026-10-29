# CT-5 / CT-6 实施检查点 · 2026-10-29

分支：`codex/ct5-ct6-research`，基于 CT-4 `f1256b9`。**本批是基础增量，CT-5 与 CT-6 均未完整交付。** 原计划中的真实固定脚本回执、双端交互、论文调查与实验对照仍是完成条件。

## 已实施

CT-5 增加 `compare_experiment_metrics`，接入原 Mission Runner；默认 flag `EXPERIMENT_OBSERVER_ENABLED=false`。用户可通过原 Capture 记录粘贴 CSV/JSON，模型使用原 sourceId/hash 定向比较。尚无附件 CSV 上传入口，不将粘贴支持称为文件上传支持。

复用原 `gaps.ts` 的指标名、单位、时间窗口约束，增量记录 runId、方法、dataset、split、seed、evaluationCode、environment、phase、batchSize、方向与数值。比较只做同条件算术：缺条件或条件/单位/时间窗口不同返回 NOT_COMPARABLE，不换算单位、不做显著性推断；保留持平与下降，标明 REPORTED_INPUTS_NOT_REPRODUCED。方法可以不同，评估协议须相同。

没有新表、新记忆或执行器。输入只读本项目原 Capture，不接受路径、URL、命令。复用原 Mission lease、持续调查工具许可、累计工具预算与 source-use；读取前后校验，提交时再核对结果来源。沿原待确认 Action 链测试源修订后旧审批拒绝。原受限自动接续/持续调查许可没有自动增加新工具。

CSV 使用 [node-csv / csv-parse](https://github.com/adaltas/node-csv)（MIT，约4.3k star，持续维护），没有手写分隔符解析器。库级64KB/100条上限，Mission入口另受原12k可引用文本范围限制；拒绝重复表头、重复run/metric、非法数字及缺字段。

CT-6 增加独立可测试的 Crossref metadata adapter 基础：规范 DOI、固定 api.crossref.org 目标、禁止重定向、15秒请求界限、128KB响应界限、请求与响应DOI一致。保留不完整发表日期、类型、版本关系、更正/撤稿通知，摘要限长，始终标注 METADATA、未读全文、项目结果未知。参考 [Crossref官方REST文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api)。adapter强制由调用方传入dispatch，不提供独立发网CLI。本批测试全部注入合成响应，没有真实联网请求。

## 本批验证

证据：`evidence/r4-experiments/20261029/`。新测试2文件6项通过：CSV引用/重复/非法数值、条件不一致/未知、零差值/下降、原Mission持久Step、待确认行动与换版失效、DOI/响应限额/身份一致、metadata与全文边界。类型和定向lint结果见对应回执；不是全量发布验收。

## 接续顺序与未关闭门槛

1. CT-5：原 Conversation Investigation adapter、指标来源/条件比较的Web与ArkTS展示、附件CSV/JSON副本入口、同条件负例与真实用户数据验收。此阶段不把本批工具暴露给旧持续委托。
2. CT-5 固定核算：接原提案/确认/版本校验与真实job effectId/幂等/UNKNOWN核对。使用固定脚本、固定镜像、无网、只读输入副本及CPU/内存/时间限制。需先恢复Docker daemon；之前本机启动命令返回但daemon不可用。普通Node子进程不算安全沙箱，不开发绕过实现。参考 [Docker安全边界](https://docs.docker.com/engine/security/)。
3. CT-6：将metadata adapter接原公开研究scope、原Turn/Step HTTP账本、预算、撤权与迟到结果保护，再加入动态工具选择、持久来源及双端来源查看。当前尚未接这些入口，不能宣称Agent已能自主论文调查。
4. DOI只能来自合法用户输入或已获准的公开来源，不能由模型任意发送私有字符串。metadata不能升级为全文、用户授权或本项目实测；全文沿PR-6/OA与CT-4附件读取，再与CT-5原指标对照。
5. 运行完整回归、双端构建、真实模型旅程及设备验收后，才可给出阶段完成结论。本批没有训练、付费模型调用、外部写入、真实库迁移或部署。
