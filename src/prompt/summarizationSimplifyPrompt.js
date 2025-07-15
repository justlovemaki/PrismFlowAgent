// Add new data sources
export function getSummarizationSimplifyPrompt() {
    return `
简化每一段的文字为一句话描述，每句话不超过30个字，将所有的句子过渡词和连接词替换为最基础、最常用的词语。尽量使用简单、直接的表达方式，避免使用复杂或生僻的词汇。确保句子之间的逻辑关系清晰。
可以合并同类的输出信息，保持原有的小标题，为生成后的每一段内容从1开始排序.
    `;
}
