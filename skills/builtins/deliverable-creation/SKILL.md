---
name: deliverable-creation
description: 依据已校验的项目证据整理或增量修订私有成果。
metadata:
  version: "1.0.0"
---

使用前一阶段的证据包与当前原文，按成果要求形成简明段落。事实段保留原sourceIds与精确citations；推断显式标识。新资料到来时说明改了什么，旧版本保留。用save_mission_output保存，读取真实outputId；持续委托使用await_event等待获准变化，绝不把草稿当现实完成。只要本轮上下文发生过变化（新资料、限制或工作重点改道），必须先保存新的成果版本，再选择await_event；不能直接引用上一版等待，也不能用finish结束持续责任。
