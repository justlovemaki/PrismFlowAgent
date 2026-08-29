---
name: prismflow-daily-production
description: Generate a PrismFlow article through the trusted Selection to Generation Request to Draft chain. Use when the user asks for a daily brief, digest, article, or other generated draft.
license: GPL-3.0-only
compatibility: Requires @prismflow/dsh
metadata:
  owner: prismflow
  builtin: "true"
---

# PrismFlow 内容生成

1. 使用 `prismflow_generators` 发现生成器。
2. 从持久化 Selection 创建 Generation Request。
3. 调用 `prismflow_generate_draft` 生成 Draft。
4. 不得绕过 Selection，不得把浏览器正文传给 Publisher。
5. Chat 不得审批、删除或发布；这些操作仅在 Dashboard 完成。

详细流程见 [references/pipeline.md](references/pipeline.md)。
