# 单项目首页与功能子页面（2026-10-21）

## 用户目标与设计决定

用户要求单个项目从功能长页改成“首页只看重要信息、各功能进入子页面”。用户需要快速知道当前状态、待处理事项与下一步；导航到另一功能只改变页面位置，不改变项目事实或确认状态。

- `rule/navigation-vs-action`：功能入口使用真实路由链接，可直接访问、刷新、前进后退；桌面侧栏、窄屏两行入口，同一项目标题与设置保持上下文。
- `rule/smallest-intervention`：复用原Capture、Attachment、会议、Action、Knowledge、Mission、Artifact、Temporal Ledger与相关授权，不新建工作流或事实表。
- `rule/cover-reachable-states` / `rule/error-states-recovery`：保留空状态、错误与重试、功能开关；匿名回登录，非项目成员404。私有委托摘要和入口进一步沿用OWNER要求。
- `rule/preserve-user-input`：Capture原草稿持久化仍有效；跨页来源链接保留项目、查询条件和具体实体ID。

## 页面

`/projects/:id`：目标、关键状态、下一步、最多3条重要提醒/行动/当前委托/最近记录。再入场详情按需展开。

子页：`missions`长期委托、`records`记录与附件、`meetings`会议更新、`actions`行动/提醒/安排、`knowledge`知识/问答/归档整理、`health`体检/变化/检查点/准备度、`generate`成果文档。

共用布局先校验session/membership再读项目元数据；页面授权先于项目评估。React cache仅用于请求内去重。首页不加载长表单和全部功能组件，知识详细来源和Temporal数据在知识页读取。

旧根页锚点继续转到对应功能页，包括具体card/action/attachment实体。Capture结果、会议确认、阶段证据、Mission行动回执、成果逐句审阅均指向对应子页。首页可精确打开同一Mission。

## 验证与边界

全量测试、E2E、类型、lint与独立审查结果见results.json及日志。4项将所有组件固定在根页的源码快照断言已由导航/授权行为测试与跨页E2E替代，原业务不变量检查保留。并发构建时旧的自动接续集成用例触发5秒测试超时；停止并发构建后全量605项通过。匿名RSC流式重定向可能返回HTTP200，因此E2E检查最终登录URL与私有导航未出现，而非固定HTTP状态码。

独立审查发现附件实体锚点缺失，已补映射并回归；同步修复成果审阅的旧卡片链接。独立导航/授权17项通过，没有新增阻断项。

截图来源：本地隔离E2E库、mock与UI_TEST_FIXTURE。桌面1280px、手机390px；手动记录新资料后首页显示最近记录，手机可直接切换功能，页面无横向溢出。不是ECS线上数据。

无数据库迁移，未修改主工作区的未提交内容，未更新ECS、未发起真实模型付费调用。部署后仍需在线验收原Mission与实际配置。
