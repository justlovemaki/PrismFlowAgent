import { XMLParser } from 'fast-xml-parser';

export interface OPMLFeed {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
  category?: string;
}

export function parseOPML(xmlContent: string): OPMLFeed[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
  });
  
  const jsonObj = parser.parse(xmlContent);
  const feeds: OPMLFeed[] = [];

  function traverse(outline: any, category?: string) {
    if (!outline) return;
    
    const outlines = Array.isArray(outline) ? outline : [outline];
    
    for (const node of outlines) {
      if (node.xmlUrl) {
        // This is a leaf node (feed)
        feeds.push({
          title: node.title || node.text || 'Unknown Feed',
          xmlUrl: node.xmlUrl,
          htmlUrl: node.htmlUrl,
          category: category
        });
      } else if (node.outline) {
        // This is a folder node
        traverse(node.outline, node.title || node.text);
      }
    }
  }

  if (jsonObj.opml && jsonObj.opml.body && jsonObj.opml.body.outline) {
    traverse(jsonObj.opml.body.outline);
  }

  return feeds;
}
