import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedNewspicAssetIds, renderNewspicContent, renderWechatMarkdown } from '../core/publishing/WechatPublisher.js';

const ASSET_ID = 'a'.repeat(64);

test('newspic destination presentation owns the approved image order over unrelated remote Markdown images', () => {
  const rendered = renderWechatMarkdown('正文 ![来源图片](https://source.example/unbound.avif)');
  const presentation = { publisherId: 'wechat-draft:newspic', cover: { assetId: ASSET_ID, crops: [] }, imageOrder: [ASSET_ID] };
  assert.deepEqual(orderedNewspicAssetIds(rendered, presentation, 20), [ASSET_ID]);
});

test('newspic pure text keeps preview-significant blank lines, numbering, bullets, and spaces', () => {
  const markdown = '## 今日摘要\n\n1. 第一条  保留双空格\n2. 第二条\n\n- 补充内容\n';
  const rendered = renderWechatMarkdown(markdown);
  assert.equal(renderNewspicContent({ title: '简报', markdown } as never, undefined, rendered), '今日摘要\n\n1. 第一条  保留双空格\n2. 第二条\n\n• 补充内容');
});

test('newspic without an exact presentation still rejects unpersisted Markdown images', () => {
  const rendered = renderWechatMarkdown('正文 ![来源图片](https://source.example/unbound.avif)');
  assert.throws(() => orderedNewspicAssetIds(rendered, undefined, 20), /approved persisted media assets/);
});
