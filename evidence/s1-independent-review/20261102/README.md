# S1 独立复核证据

原候选：`24e58e9`。修复源码：`63e19bb`；尾修复：`fd4f754`。

`failures/initial-five-before.log` 是原候选上的五项失败；`negative-baseline.test.ts.txt` 保存这五例测试，其他后来新增用例没有伪称在原候选都跑过红灯。`validation-before.json` 是 `63e19bb` 上的词边界及日期纯函数负例。其余首轮环境/断言失败和 E2E watchdog 超时保留在 logs 中。

所有测试使用独立合成数据，模型为 mock、注入替身或假 HTTP。真实 provider adapter 链被实际调用，HTTP 被拦截；这不是真实模型质量证据。真实模型调用、设备、首次用户、自然日和现实结果的完成状态见 `ACCEPTANCE.json`。

完整单元/集成回归绑定 `63e19bb`；尾修复只复跑受影响的五文件及类型/lint，另跑最终生产构建/E2E。不得把两批记录描述成最终提交全量重跑。HAP 的原生源码与两修复提交一致，unsigned，只证明构建，未安装。

历史截图由原 E2E 写到旧路径；本轮结果另存 screenshots，旧路径还原。未收录真实 `.env`、数据库、附件原件、auth state、含 cookie 的 trace 或签名文件。HAP 只记录本地产物 hash，不提交二进制。

`FILE_MANIFEST.json` 校验归档文件的 Git blob 字节；本目录关闭文本换行转换。清单自身不递归计算自身 hash。证据提交可另加文档，不改变被验证的业务源码。
