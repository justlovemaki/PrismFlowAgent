---
name: prismflow-ai-selection
description: Create an immutable all-source PrismFlow AI Selection for generation. Use when recent stored material must be reviewed, clustered, ranked, and frozen before a Generation Request.
license: GPL-3.0-only
compatibility: Requires @prismflow/dsh
metadata:
  owner: prismflow
  builtin: "true"
---

# PrismFlow AI Selection

1. 默认调用 `prismflow_create_ai_selection`，保持全来源选择。
2. 不得自行缩小来源、时间窗口或质量预算。
3. 只有用户明确指定单一来源并完成确认时，才能使用受限单来源入口。
4. Selection ID 必须原样传给 Generation Request。
