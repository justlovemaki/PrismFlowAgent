import { getRandomUserAgent, sleep, isDateWithinLastDays, stripHtml, formatDateToChineseWithTime, escapeHtml } from '../helpers';

const NewsAggregatorDataSource = {
    type: 'news-aggregator',
    async fetch(env, foloCookie) {
        const listId = env.NEWS_AGGREGATOR_LIST_ID;
        const fetchPages = parseInt(env.NEWS_AGGREGATOR_FETCH_PAGES || '1', 10);
        const allNewsItems = [];
        const filterDays = parseInt(env.FOLO_FILTER_DAYS || '3', 10);

        if (!listId) {
            console.warn('NEWS_AGGREGATOR_LIST_ID is not set in environment variables. Skipping news aggregator fetch.');
            return {
                version: "https://jsonfeed.org/version/1.1",
                title: "Aggregated News",
                home_page_url: "https://example.com/news",
                description: "Aggregated news from various sources",
                language: "zh-cn",
                items: []
            };
        }

        let publishedAfter = null;
        for (let i = 0; i < fetchPages; i++) {
            const userAgent = getRandomUserAgent();
            const headers = {
                'User-Agent': userAgent,
                'Content-Type': 'application/json',
                'accept': 'application/json',
                'accept-language': 'zh-CN,zh;q=0.9',
                'baggage': 'sentry-environment=stable,sentry-release=5251fa921ef6cbb6df0ac4271c41c2b4a0ce7c50,sentry-public_key=e5bccf7428aa4e881ed5cb713fdff181,sentry-trace_id=2da50ca5ad944cb794670097d876ada8,sentry-sampled=true,sentry-sample_rand=0.06211835167903246,sentry-sample_rate=1',
                'origin': 'https://app.follow.is',
                'priority': 'u=1, i',
                'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'x-app-name': 'Folo Web',
                'x-app-version': '0.4.9',
            };

            if (foloCookie) {
                headers['Cookie'] = foloCookie;
            }

            const body = {
                listId: listId,
                view: 1,
                withContent: true,
            };

            if (publishedAfter) {
                body.publishedAfter = publishedAfter;
            }

            try {
                console.log(`Fetching News Aggregator data, page ${i + 1}...`);
                const response = await fetch(env.FOLO_DATA_API, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    console.error(`Failed to fetch News Aggregator data, page ${i + 1}: ${response.statusText}`);
                    break;
                }
                const data = await response.json();
                if (data && data.data && data.data.length > 0) {
                    const filteredItems = data.data.filter(entry => isDateWithinLastDays(entry.entries.publishedAt, filterDays));
                    allNewsItems.push(...filteredItems.map(entry => ({
                        id: entry.entries.id,
                        url: entry.entries.url,
                        title: entry.entries.title,
                        content_html: entry.entries.content,
                        date_published: entry.entries.publishedAt,
                        authors: [{ name: entry.entries.author }],
                        source: entry.entries.author ? `${entry.feeds.title} - ${entry.entries.author}` : entry.feeds.title,
                    })));
                    publishedAfter = data.data[data.data.length - 1].entries.publishedAt;
                } else {
                    console.log(`No more data for News Aggregator, page ${i + 1}.`);
                    break;
                }
            } catch (error) {
                console.error(`Error fetching News Aggregator data, page ${i + 1}:`, error);
                break;
            }

            await sleep(Math.random() * 5000);
        }

        return {
            version: "https://jsonfeed.org/version/1.1",
            title: "Aggregated News",
            home_page_url: "https://example.com/news",
            description: "Aggregated news from various sources",
            language: "zh-cn",
            items: allNewsItems
        };
    },

    transform(rawData, sourceType) {
        if (!rawData || !rawData.items) {
            return [];
        }

        return rawData.items.map(item => ({
            id: item.id,
            type: sourceType,
            url: item.url,
            title: item.title,
            description: stripHtml(item.content_html || ""),
            published_date: item.date_published,
            authors: item.authors ? item.authors.map(author => author.name).join(', ') : 'Unknown',
            source: item.source || 'Aggregated News',
            details: {
                content_html: item.content_html || ""
            }
        }));
    },

    generateHtml: (item) => {
        return `
            <strong>${escapeHtml(item.title)}</strong><br>
            <small>来源: ${escapeHtml(item.source || '未知')} | 发布日期: ${formatDateToChineseWithTime(item.published_date)}</small>
            <div class="content-html">${item.details.content_html || '无内容。'}</div>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">阅读更多</a>
        `;
    }
};

export default NewsAggregatorDataSource;
