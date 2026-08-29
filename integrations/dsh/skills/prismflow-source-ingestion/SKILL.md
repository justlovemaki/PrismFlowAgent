---
name: prismflow-source-ingestion
description: Discover configured PrismFlow sources and synchronize their content into the durable Content Store. Use when source material must be refreshed or ingested before selection.
license: GPL-3.0-only
compatibility: Requires @prismflow/dsh
metadata:
  owner: prismflow
  builtin: "true"
---

# PrismFlow 来源同步

1. 调用 `prismflow_sources` 获取已配置来源 ID。
2. 只使用返回的真实 ID 调用 `prismflow_sync_source`。
3. 不得编造来源 ID，也不得把同步结果当作已生成稿件。
4. 需要多个来源时逐项同步，并明确报告失败来源。

详细约束见 [references/workflow.md](references/workflow.md)。
