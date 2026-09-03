---
name: prismflow-source-ingestion
description: Discover and synchronize configured PrismFlow sources only when the user explicitly requests a refresh, synchronization, re-fetch, or latest-source ingestion. Do not use for selecting already captured recent data.
license: GPL-3.0-only
compatibility: Requires @prismflow/dsh
metadata:
  owner: prismflow
  builtin: "true"
---

# PrismFlow 来源同步

1. 只有用户明确要求同步、刷新、重新抓取或获取最新来源时才执行本 Skill；“筛选最近两天已抓取数据”不是同步授权。
2. 调用 `prismflow_sources` 获取已配置来源 ID。
3. 只使用返回的真实 ID 调用 `prismflow_sync_source`。
4. 不得编造来源 ID，也不得把同步结果当作已生成稿件。
5. 需要多个来源时逐项同步，并明确报告失败来源。

详细约束见 [references/workflow.md](references/workflow.md)。
