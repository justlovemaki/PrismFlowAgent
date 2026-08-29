---
name: prismflow-draft-revision
description: Inspect and revise an unapproved PrismFlow Draft, or derive an image-bound revision from an approved Draft, with exact version and SHA-256 concurrency checks.
license: GPL-3.0-only
compatibility: Requires @prismflow/dsh
metadata:
  owner: prismflow
  builtin: "true"
---

# PrismFlow 草稿修订

1. 使用 `prismflow_drafts` 找到 Draft。
2. 通过 `prismflow_edit_draft` 的 inspect 动作读取正文。
3. 保存时携带当前版本和 SHA-256。
4. 已批准或已发布 Draft 的正文和原 Artifact 不可原地编辑；如用户要求补充图片，先使用 `prismflow_image_generation`、`prismflow_ingest_production_image`，或针对已有 `assetId` 调用 `prismflow_get_production_image_claim` 获得完整 Production Media Claim，再调用 `prismflow_create_draft_image_revision`。该工具必须自动创建新的未审批 Draft，不得改变源 Draft。
5. `placement` 只能按用户意图选择：图文首图通常使用 `cover-and-first`，追加图片使用 `append`，只更换封面使用 `cover-only`。
6. 发布中的 Draft 和已删除 Draft 不可派生；已发布 Draft 可以作为只读来源创建新的未审批图片修订稿。
7. 所有派生图片稿仍须在 Dashboard 重新审批；Chat 不得审批或删除。
8. `prismflow_set_draft_presentation` 只用于 `draft`/`rejected` 状态；`approved`/`published` 必须调用 `prismflow_create_draft_image_revision`。对未审批图片稿执行正文编辑时，既有 Media Claim 和 Presentation 必须保留并重新计算 Artifact Binding，不得声称“可能仍在”，应以工具返回的 `mediaAssets`、`destinationPresentations` 和 `artifactBindingSha256` 为准。
