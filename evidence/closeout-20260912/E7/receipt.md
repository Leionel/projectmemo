# E7 收尾回执：C1 简报证据可点开 + 七项统一回归

日期：2026-09-12。起点 HEAD `a743079`。

## C1 改动

1. 简报句子携带可点开的证据引用（entityKind + entityId，来自 Diff 的 evidenceRefs）；每句渲染最多 3 个"📎 记忆/行动/交付物"芯片，点击关闭简报并跳转到对应 Tab（记忆/待办/成果），来源 V1 为页签级定位（非条目级滚动，如实记录）。
2. 无证据句不渲染芯片；"已了解"游标、失败重试、不自动建行动等既有行为不变。

## 统一回归（命令与退出码）

| 命令 | 结果 |
|---|---|
| `npm.cmd exec tsc -- --noEmit` | 0 |
| `npm.cmd test`（独立库 prisma/test-vitest.db） | 28 文件 / 201 测试全部通过，0 |
| `npm.cmd run lint` | 0 错误（7 条未使用变量警告） |
| `npm.cmd run build` | Next 生产构建成功 |
| `npm.cmd run harmony:test` | BUILD SUCCESSFUL，27/27 |
| `npm.cmd run harmony:build` | HAP 成功，sha256 `9a1bfbdf5d11c082a62a8e484193bbe60656f0e58fbdcb6e79ef1210392874f1` |

## 七项最终状态

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| S1 | PASS | 尚未执行 | IN_PROGRESS |
| M1 | PASS | 尚未执行 | IN_PROGRESS |
| R1 | PASS | 尚未执行 | IN_PROGRESS |
| F1 | PASS | 尚未执行 | IN_PROGRESS |
| T1 | PASS | 尚未执行 | IN_PROGRESS |
| B1 | PASS | 尚未执行 | IN_PROGRESS |
| C1 | PASS | 尚未执行 | IN_PROGRESS |

设备矩阵（正常/空态/失败重试/重复点击/返回重进/大字号/深色/写入超时重进/重启追溯）尚未执行——全部七项的"设备验收"列如实为"尚未执行"，不得标 VERIFIED。

## 剩余限制

- 简报证据为页签级定位；条目级定位（滚动并高亮具体卡/行动）留待后续。
- C1 关闭条件要求的设备流程（旧游标→变更→简报→证据→已了解→重开无重复）需模拟器/真机执行。
