请针对关键词 "{{keyword}}" 进行深入检索。

结果必须严格以 JSON 数组的形式返回，不要包含任何 Markdown 代码块包裹（如 ```json ），也不要包含任何解释性文字。
数组中的每个对象应包含以下字段：
- title: 资讯标题
- url: 相关链接（如果没有真实链接就移除当前条目，不要生成一个假的）
- description: 资讯简要描述
- content: 更详细的描述，需要完整的描述内容，不要有任何编造，在230字左右，可以包含图片链接，但是不能包含任何代码块，有英文引号需要加转义符号
- author: 作者或来源机构（可选）
- published_date: 发布日期（ISO 格式或 YYYY-MM-DD hh:mm:ss）
- metadata: 额外信息（对象格式）。对于来自 x.com (Twitter) 的内容，必须在 metadata 中包含 views (浏览量), likes (点赞量), retweets (转发量), replies (评论量) 等字段。
