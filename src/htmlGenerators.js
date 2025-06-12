// src/htmlGenerators.js
import { escapeHtml, formatDateToChinese, convertEnglishQuotesToChinese, replaceImageProxy} from './helpers.js';
import { dataSources } from './dataFetchers.js'; // Import dataSources

function generateHtmlListForContentPage(items, dateStr) {
    let listHtml = '';

    if (!Array.isArray(items) || items.length === 0) {
        listHtml += `<p>此日期无可用数据。抓取/筛选过程可能没有为此日期生成任何结果。</p>`;
        return listHtml;
    }

    listHtml += '<ul class="item-list">';
    items.forEach((item, index) => {
        let displayContent = '';
        let itemId = item.id;

        // Use the generateHtml method from the corresponding data source
        const dataSourceConfig = dataSources[item.type];
        // console.log("item.type:", item.type);
        // console.log("dataSourceConfig:", dataSourceConfig);
        if (dataSourceConfig && dataSourceConfig.sources && dataSourceConfig.sources.length > 0 && dataSourceConfig.sources[0].generateHtml) {
            displayContent = dataSourceConfig.sources[0].generateHtml(item);
        } else {
            // Fallback for unknown types or if generateHtml is not defined
            displayContent = `<strong>未知项目类型: ${escapeHtml(item.type)}</strong><br>${escapeHtml(item.title || item.description || JSON.stringify(item))}`;
        }

        listHtml += `<li class="item-card">
            <label>
                <input type="checkbox" name="selectedItems" value="${item.type}:${itemId}" class="item-checkbox">
                <div class="item-content">${displayContent}</div>
            </label>
        </li>`;
    });
    listHtml += '</ul>';
    return listHtml;
}

export function generateContentSelectionPageHtml(env, dateStr, allData, dataCategories) {
    // Ensure allData is an object and dataCategories is an array
    const data = allData || {};
    const categories = Array.isArray(dataCategories) ? dataCategories : [];

    // Generate tab buttons and content dynamically
    const tabButtonsHtml = categories.map((category, index) => `
        <div class="tab-buttons-wrapper">
            <button type="button" class="tab-button ${index === 0 ? 'active' : ''}" onclick="openTab(event, '${category.id}-tab')" ondblclick="confirmFetchCategoryData(this,'${category.id}')">${escapeHtml(category.name)}</button>
        </div>
    `).join('');

    const tabContentsHtml = categories.map((category, index) => `
        <div id="${category.id}-tab" class="tab-content ${index === 0 ? 'active' : ''}">
            ${generateHtmlListForContentPage(data[category.id], dateStr)}
        </div>
    `).join('');

    return `
        <!DOCTYPE html>
        <html lang="zh-Hans">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${formatDateToChinese(escapeHtml(dateStr))} ${env.FOLO_FILTER_DAYS}天内的数据</title>
            <style>
                :root { --primary-color: #007bff; --light-gray: #f8f9fa; --medium-gray: #e9ecef; --dark-gray: #343a40; --line-height-normal: 1.4; --font-size-small: 0.9rem;}
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; background-color: var(--light-gray); color: var(--dark-gray); padding: 1rem; }
                .container { max-width: 1200px; margin: 0 auto; background-color: #fff; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
                h1 { font-size: 1.8rem; color: var(--dark-gray); margin-bottom: 0.5rem; }
                .submit-button { background-color: var(--primary-color); color: white; border: none; padding: 0.6rem 1.2rem; font-size: 0.9rem; border-radius: 5px; cursor: pointer; transition: background-color 0.2s; white-space: nowrap; }
                .submit-button:hover { background-color: #0056b3; }
                .tab-navigation { display: flex; flex-wrap: wrap; margin-bottom: 1rem; border-bottom: 1px solid var(--medium-gray); }
                .tab-buttons-wrapper { display: flex; align-items: center; margin-right: 1rem; margin-bottom: 0.5rem; }
                .tab-button { background-color: transparent; border: none; border-bottom: 3px solid transparent; padding: 0.8rem 1rem; cursor: pointer; font-size: 1rem; color: #555; transition: color 0.2s, border-color 0.2s; }
                .tab-button.active { color: var(--primary-color); border-bottom-color: var(--primary-color); font-weight: 600; }
                .tab-button:hover { color: var(--primary-color); }
                .tab-content { display: none; animation: fadeIn 0.5s; }
                .tab-content.active { display: block; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                .item-list { list-style-type: none; counter-reset: item-counter; padding-left: 0; }
                .item-card { margin-bottom: 1rem; padding: 1rem; padding-left: 3em; border: 1px solid var(--medium-gray); border-radius: 6px; background-color: #fff; position: relative; counter-increment: item-counter; }
                .item-card::before { content: counter(item-counter) "."; position: absolute; left: 0.8em; top: 1rem; font-weight: 600; color: var(--dark-gray); min-width: 1.5em; text-align: right; }
                .item-card label { display: flex; align-items: flex-start; cursor: pointer; }
                .item-checkbox { margin-right: 0.8rem; margin-top: 0.2rem; transform: scale(1.2); flex-shrink: 0; }
                .item-content { flex-grow: 1; min-width: 0; }
                .item-content strong { font-size: 1.1rem; }
                .item-content small { color: #6c757d; display: block; margin: 0.2rem 0; }
                .content-html { border: 1px dashed #ccc; padding: 0.5rem; margin-top: 0.5rem; background: #fdfdfd; font-size: var(--font-size-small); line-height: var(--line-height-normal); max-width: 100%; overflow-wrap: break-word; word-break: break-word; overflow-y: hidden; transition: max-height 0.35s ease-in-out; position: relative; }
                .content-html.is-collapsed { max-height: calc(var(--font-size-small) * var(--line-height-normal) * 6 + 1rem); }
                .content-html.is-expanded { max-height: 3000px; overflow-y: auto; }
                .read-more-btn { display: block; margin-top: 0.5rem; padding: 0.3rem 0.6rem; font-size: 0.85rem; color: var(--primary-color); background-color: transparent; border: 1px solid var(--primary-color); border-radius: 4px; cursor: pointer; text-align: center; width: fit-content; }
                .read-more-btn:hover { background-color: #eef; }
                .item-content a { color: var(--primary-color); text-decoration: none; }
                .item-content a:hover { text-decoration: underline; }
                .error { color: #dc3545; font-weight: bold; background-color: #f8d7da; padding: 0.5rem; border-radius: 4px; border: 1px solid #f5c6cb;}
                hr { border: 0; border-top: 1px solid var(--medium-gray); margin: 0.5rem 0; }
                @media (max-width: 768px) {
                    body { padding: 0.5rem; } .container { padding: 0.8rem; } h1 { font-size: 1.5rem; }
                    .header-bar { flex-direction: column; align-items: flex-start; }
                    .submit-button { margin-top: 0.5rem; width: 100%; }
                    .tab-button { padding: 0.7rem 0.5rem; font-size: 0.9rem; flex-grow: 1; text-align: center; }
                    .item-card { padding-left: 2.5em; } .item-card::before { left: 0.5em; top: 0.8rem; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <form action="/genAIContent" method="POST">
                    <input type="hidden" name="date" value="${escapeHtml(dateStr)}">
                    <div class="header-bar">
                        <button type="button" class="submit-button" onclick="confirmFetchAndWriteData(this)">抓取并写入今日数据</button>
                        <h1>${formatDateToChinese(escapeHtml(dateStr))} ${env.FOLO_FILTER_DAYS}天内的数据</h1>
                        <button type="submit" class="submit-button" onclick="return confirmGenerateAIContent(event)">从选中内容生成 AI 日报</button>
                    </div>
                    <div class="cookie-setting-area" style="margin-bottom: 1rem; padding: 0.8rem; border: 1px solid var(--medium-gray); border-radius: 6px; background-color: #fefefe;">
                        <label for="foloCookie" style="font-weight: bold; margin-right: 0.5rem;">Folo Cookie:</label>
                        <input type="text" id="foloCookie" placeholder="在此输入 Folo Cookie" style="flex-grow: 1; padding: 0.4rem; border: 1px solid #ccc; border-radius: 4px; width: 300px; max-width: 70%;">
                        <button type="button" class="submit-button" onclick="saveFoloCookie(this)" style="margin-left: 0.5rem; padding: 0.4rem 0.8rem; font-size: 0.85rem;">保存 Cookie</button>
                        <p style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">此 Cookie 将保存在您的浏览器本地存储中，以便下次使用。</p>
                    </div>
                    <div class="tab-navigation">
                        ${tabButtonsHtml}
                    </div>
                    ${tabContentsHtml}
                </form>
            </div>
            <script>
                function openTab(evt, tabName) {
                    var i, tabcontent, tablinks;
                    tabcontent = document.getElementsByClassName("tab-content");
                    for (i = 0; i < tabcontent.length; i++) { tabcontent[i].style.display = "none"; tabcontent[i].classList.remove("active"); }
                    tablinks = document.getElementsByClassName("tab-button");
                    for (i = 0; i < tablinks.length; i++) { tablinks[i].classList.remove("active"); }
                    document.getElementById(tabName).style.display = "block"; document.getElementById(tabName).classList.add("active");
                    if (evt && evt.currentTarget) { evt.currentTarget.classList.add("active"); }
                }
                document.addEventListener('DOMContentLoaded', function() {
                    if (document.querySelector('.tab-button') && !document.querySelector('.tab-button.active')) { document.querySelector('.tab-button').click(); }
                    else if (document.querySelector('.tab-content.active') === null && document.querySelector('.tab-content')) {
                        const firstTabButton = document.querySelector('.tab-button'); const firstTabContent = document.querySelector('.tab-content');
                        if (firstTabButton) firstTabButton.classList.add('active');
                        if (firstTabContent) { firstTabContent.style.display = 'block'; firstTabContent.classList.add('active');}
                    }
                    document.querySelectorAll('.content-html').forEach(contentDiv => {
                        contentDiv.classList.add('is-collapsed');
                        requestAnimationFrame(() => {
                            const readMoreBtn = document.createElement('button'); readMoreBtn.type = 'button';
                            readMoreBtn.textContent = '展开'; readMoreBtn.className = 'read-more-btn';
                            contentDiv.insertAdjacentElement('afterend', readMoreBtn);
                            readMoreBtn.addEventListener('click', function() {
                                contentDiv.classList.toggle('is-expanded'); contentDiv.classList.toggle('is-collapsed', !contentDiv.classList.contains('is-expanded'));
                                this.textContent = contentDiv.classList.contains('is-expanded') ? '折叠' : '展开';
                            });
                        });
                    });
                });

                async function saveFoloCookie(button) {
                    const cookieInput = document.getElementById('foloCookie');
                    const cookieValue = cookieInput.value;

                    if (!cookieValue.trim()) {
                        alert('Folo Cookie 不能为空。');
                        return;
                    }

                    const originalButtonText = button.textContent;
                    button.textContent = '保存中...';
                    button.disabled = true;

                    try {
                        localStorage.setItem('${env.FOLO_COOKIE_KV_KEY}', cookieValue); // 直接保存到 localStorage
                        alert('Folo Cookie 已成功保存在本地存储！');
                    } catch (error) {
                        console.error('Error saving Folo Cookie to localStorage:', error);
                        alert(\`保存 Folo Cookie 到本地存储时发生错误: \${error.message}\`);
                    } finally {
                        button.textContent = originalButtonText;
                        button.disabled = false;
                    }
                }

                document.addEventListener('DOMContentLoaded', function() {
                    const savedCookie = localStorage.getItem('${env.FOLO_COOKIE_KV_KEY}');
                    if (savedCookie) {
                        document.getElementById('foloCookie').value = savedCookie;
                    }
                });

                function confirmFetchAndWriteData(button) {
                    if (confirm('确定要抓取并写入今日数据吗？此操作将更新今日数据。')) {
                        fetchAndWriteData(button);
                    }
                }

                async function fetchAndWriteData(button, category = null) {
                    const originalText = button.textContent;
                    button.textContent = '正在抓取和写入...';
                    button.disabled = true;

                    const foloCookie = localStorage.getItem('${env.FOLO_COOKIE_KV_KEY}'); // 从 localStorage 获取 foloCookie

                    try {
                        const response = await fetch('/writeData', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ category: category, foloCookie: foloCookie }), // 将 foloCookie 添加到请求体
                        });

                        if (response.ok) {
                            const result = await response.text();
                            alert('数据抓取和写入成功！' + result);
                            window.location.reload();
                        } else {
                            const errorText = await response.text();
                            alert('数据抓取和写入失败: ' + errorText);
                        }
                    } catch (error) {
                        console.error('Error fetching and writing data:', error);
                        alert('请求失败，请检查网络或服务器。');
                    } finally {
                        button.textContent = originalText;
                        button.disabled = false;
                    }
                }

                function confirmFetchCategoryData(button, category) {
                    if (confirm(\`确定要抓取并写入 \${category} 分类的数据吗？此操作将更新 \${category} 数据。\`)) {
                        fetchAndWriteData(button, category);
                    }
                }

                function confirmGenerateAIContent(event) {
                    const selectedCheckboxes = document.querySelectorAll('input[name="selectedItems"]:checked');
                    if (selectedCheckboxes.length === 0) {
                        alert('请至少选择一个内容条目来生成 AI 日报。');
                        event.preventDefault(); // Prevent form submission
                        return false;
                    }
                    if (confirm('确定要从选中内容生成 AI 日报吗？此操作将调用 AI 模型生成内容。')) {
                        return true; // Allow form submission
                    } else {
                        event.preventDefault(); // Prevent form submission
                        return false;
                    }
                }

            </script>
        </body>
        </html>
    `;
}


function generatePromptSectionHtmlForGenAI(systemPrompt, userPrompt, promptTitle, promptIdSuffix) {
    if (!systemPrompt && !userPrompt) return '';
    let fullPromptTextForCopy = "";
    if (systemPrompt) fullPromptTextForCopy += `系统指令:\n${systemPrompt}\n\n`;
    if (userPrompt) fullPromptTextForCopy += `用户输入:\n${userPrompt}`;
    fullPromptTextForCopy = fullPromptTextForCopy.trim();

    return `
        <div style="margin-top: 1rem; border: 1px solid #ddd; padding: 0.8rem; border-radius: 4px; background-color: #f9f9f9;">
            <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem; color: #333;">${escapeHtml(promptTitle)}</h3>
            <button type="button" class="button-link toggle-prompt-btn" onclick="togglePromptVisibility('promptDetails_${promptIdSuffix}', this)">显示提示详情</button>
            <button type="button" class="button-link copy-prompt-btn" onclick="copyToClipboard(this.dataset.fullPrompt, this)" data-full-prompt="${escapeHtml(fullPromptTextForCopy)}">复制完整提示</button>
            <div id="promptDetails_${promptIdSuffix}" class="content-box" style="display: none; margin-top: 0.5rem; background-color: #e9ecef; border-color: #ced4da; max-height: 400px; overflow-y: auto; text-align: left;">
                ${systemPrompt ? `<strong>系统指令:</strong><pre style="white-space: pre-wrap; word-wrap: break-word; font-size: 0.85rem; margin-top:0.2em; margin-bottom:0.8em; padding: 0.5em; background: #fff; border: 1px solid #ccc; border-radius: 3px;">${escapeHtml(systemPrompt)}</pre>` : '<p><em>本次调用无系统指令。</em></p>'}
                ${userPrompt ? `<strong>用户输入:</strong><pre style="white-space: pre-wrap; word-wrap: break-word; font-size: 0.85rem; margin-top:0.2em; padding: 0.5em; background: #fff; border: 1px solid #ccc; border-radius: 3px;">${escapeHtml(userPrompt)}</pre>` : '<p><em>本次调用无用户输入。</em></p>'}
            </div>
        </div>`;
}


export function generateGenAiPageHtml(env, title, bodyContent, pageDate, isErrorPage = false, selectedItemsForAction = null,
                                 systemP1 = null, userP1 = null, systemP2 = null, userP2 = null,
                                 promptsMd = null, dailyMd = null, podcastMd = null) {

    let actionButtonHtml = '';
    // Regenerate button for AI Content Summary page
    if (title.includes('AI日报') && selectedItemsForAction && Array.isArray(selectedItemsForAction) && selectedItemsForAction.length > 0) {
        actionButtonHtml = `
            <form action="/genAIContent" method="POST" style="display: inline-block; margin-left: 0.5rem;">
                <input type="hidden" name="date" value="${escapeHtml(pageDate)}">
                ${selectedItemsForAction.map(item => `<input type="hidden" name="selectedItems" value="${escapeHtml(item)}">`).join('')}
                <button type="submit" class="button-link regenerate-button">${isErrorPage ? '重试生成' : '重新生成'}</button>
            </form>`;
    }
    // Regenerate button for AI Podcast Script page
    else if (title.includes('AI播客') && selectedItemsForAction && Array.isArray(selectedItemsForAction) && selectedItemsForAction.length > 0) {
        actionButtonHtml = `
            <form action="/genAIPodcastScript" method="POST" style="display: inline-block; margin-left: 0.5rem;">
                <input type="hidden" name="date" value="${escapeHtml(pageDate)}">
                ${selectedItemsForAction.map(item => `<input type="hidden" name="selectedItems" value="${escapeHtml(item)}">`).join('')}
                <input type="hidden" name="summarizedContent" value="${escapeHtml(convertEnglishQuotesToChinese(dailyMd))}">
                <button type="submit" class="button-link regenerate-button">${isErrorPage ? '重试生成' : '重新生成'}</button>
            </form>`;
    }

    let githubSaveFormHtml = '';
    let generatePodcastButtonHtml = ''; 
    let aiDailyAnalysisButtonHtml = '';
    let outDisplayButtonHtml = '';

    // Since commitToGitHub and genAIPodcastScript are now API calls,
    // these forms should be handled by JavaScript on the client side.
    // We will provide the data as hidden inputs for potential client-side use,
    // but the submission will be via JS fetch, not direct form POST.
    if (!isErrorPage) {
        if (title === 'AI日报' && promptsMd && dailyMd) {
            githubSaveFormHtml = `
                <input type="hidden" id="promptsMdCall1" value="${escapeHtml(promptsMd)}">
                <input type="hidden" id="dailyMd" value="${escapeHtml(dailyMd)}">
                <button type="button" class="button-link github-save-button" onclick="commitToGitHub('${pageDate}', 'daily')">保存日报到 GitHub</button>`;
        } else if (title === 'AI播客脚本' && promptsMd && podcastMd) {
            githubSaveFormHtml = `
                <input type="hidden" id="promptsMdCall2" value="${escapeHtml(promptsMd)}">
                <input type="hidden" id="podcastMd" value="${escapeHtml(podcastMd)}">
                <button type="button" class="button-link github-save-button" onclick="commitToGitHub('${pageDate}', 'podcast')">保存播客到 GitHub</button>`;
        }
    }

    if (title === 'AI日报' && !isErrorPage && podcastMd === null) { // podcastMd === null indicates it's the Call 1 page
        generatePodcastButtonHtml = `
            <form action="/genAIPodcastScript" method="POST" style="display: inline-block; margin-left: 0.5rem;">
                <input type="hidden" name="date" value="${escapeHtml(pageDate)}">
                ${selectedItemsForAction.map(item => `<input type="hidden" name="selectedItems" value="${escapeHtml(item)}">`).join('')}
                <input type="hidden" name="summarizedContent" value="${escapeHtml(convertEnglishQuotesToChinese(bodyContent))}">
                <button type="submit" class="button-link">生成播客脚本</button>
            </form>`;
        aiDailyAnalysisButtonHtml = `
            <input type="hidden" id="summarizedContentInput" value="${escapeHtml(convertEnglishQuotesToChinese(bodyContent))}">
            <button type="button" class="button-link" onclick="generateAIDailyAnalysis('${escapeHtml(pageDate)}')">AI 日报分析</button>
        `;
        outDisplayButtonHtml = `
            <button type="button" class="button-link" onclick="openContentInNewWindow()" >新窗口预览内容</button>
        `;
    }

    let promptDisplayHtml = '';
    if (title === 'AI日报') {
        if (systemP1 || userP1) {
            promptDisplayHtml = `
                <div style="margin-top: 1.5rem;">
                    <h2 style="font-size:1.3rem; margin-bottom:0.5rem;">API 调用详情</h2>
                    ${generatePromptSectionHtmlForGenAI(convertEnglishQuotesToChinese(systemP1), convertEnglishQuotesToChinese(userP1), '调用 1: 日报', 'call1')}
                </div>`;
        }
    } else if (title === 'AI播客脚本') {
        if (systemP2 || userP2) {
            promptDisplayHtml = `
                <div style="margin-top: 1.5rem;">
                    <h2 style="font-size:1.3rem; margin-bottom:0.5rem;">API 调用详情</h2>
                    ${generatePromptSectionHtmlForGenAI(convertEnglishQuotesToChinese(systemP2), convertEnglishQuotesToChinese(userP2), '调用 2: 播客格式化', 'call2')}
                </div>`;
        }
    }

    return `
        <!DOCTYPE html><html lang="zh-Hans"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(title)}</title>
            <style>
                :root { --primary-color: #007bff; --light-gray: #f8f9fa; --medium-gray: #e9ecef; --dark-gray: #343a40; --retry-color: #ffc107; --retry-text-color: #212529; --info-color: #17a2b8; --github-green: #28a745;}
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; background-color: var(--light-gray); color: var(--dark-gray); padding: 1rem; }
                .container { max-width: 900px; margin: 0 auto; background-color: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { font-size: 1.8rem; color: ${isErrorPage ? '#dc3545' : 'var(--dark-gray)'}; margin-bottom: 0.5rem; }
                p { margin-bottom: 1rem; }
                .content-box { margin-top: 1.5rem; padding: 1rem; background-color: ${isErrorPage ? '#f8d7da' : '#f0f9ff'}; border: 1px solid ${isErrorPage ? '#f5c6cb' : '#cce7ff'}; color: ${isErrorPage ? '#721c24' : 'var(--dark-gray)'}; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; font-family: ${isErrorPage ? 'inherit' : 'Menlo, Monaco, Consolas, "Courier New", monospace'}; font-size: ${isErrorPage ? '1rem' : '0.95rem'};}
                .header-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; align-items: center; margin-bottom: 1rem; }
                .navigation-links { margin-top: 1.5rem; }
                .button-link { display: inline-block; background-color: var(--primary-color); color: white; border: none; padding: 0.6rem 1.2rem; font-size: 0.9rem; border-radius: 5px; cursor: pointer; text-decoration: none; transition: background-color 0.2s; margin-right: 0.5rem; margin-bottom: 0.5rem;}
                .button-link:hover { background-color: #0056b3; }
                .regenerate-button { background-color: ${isErrorPage ? 'var(--retry-color)' : 'var(--info-color)'}; color: ${isErrorPage ? 'var(--retry-text-color)' : 'white'}; }
                .regenerate-button:hover { background-color: ${isErrorPage ? '#e0a800' : '#138496'}; }
                .github-save-button { background-color: var(--github-green); }
                .github-save-button:hover { background-color: #218838; }
                .toggle-prompt-btn { background-color: #6c757d; font-size: 0.85rem; padding: 0.4rem 0.8rem;}
                .toggle-prompt-btn:hover { background-color: #5a6268; }
                .copy-prompt-btn { background-color: #17a2b8; font-size: 0.85rem; padding: 0.4rem 0.8rem;}
                .copy-prompt-btn:hover { background-color: #138496;}
                #outContentBox { display: none;}
            </style>
        </head><body><div class="container">
            <div class="header-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                <h1>${escapeHtml(title)}</h1>
                <div class="header-actions">
                    ${generatePodcastButtonHtml}
                    ${aiDailyAnalysisButtonHtml}
                    ${outDisplayButtonHtml}
                </div>
            </div>
            <p>所选内容日期: <strong>${formatDateToChinese(escapeHtml(pageDate))}</strong></p>
            <div class="content-box" id="mainContentBox">${bodyContent}</div>
            <div class="content-box" id="outContentBox">${markdownToHtml(replaceImageProxy(env.IMG_PROXY, bodyContent))}</div>
            ${promptDisplayHtml}
            <div class="navigation-links">
                <a href="/getContentHtml?date=${encodeURIComponent(pageDate)}" class="button-link">返回内容选择</a>
                ${actionButtonHtml}
                ${githubSaveFormHtml}
                <div id="dailyAnalysisResult" style="margin-top: 1rem; padding: 1rem; border: 1px solid #ccc; border-radius: 5px; background-color: #f9f9f9; display: none;"></div>
            </div>
        </div>
        <script>
            function openContentInNewWindow() {
                const content = document.getElementById('outContentBox').innerHTML;
                const newWindow = window.open('', '_blank');
                newWindow.document.write('<!DOCTYPE html><html><head><title>内容预览</title><style> img{max-width: 100%;} div{max-width: 36%; margin: 0 auto;} body {font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 1rem; }</style></head><body>');
                newWindow.document.write('<div>'+content+'</div>');
                newWindow.document.write('</body></html>');
                newWindow.document.close();
            }

            function togglePromptVisibility(elementId, buttonElement) {
                const promptDiv = document.getElementById(elementId);
                if (promptDiv) {
                    promptDiv.style.display = (promptDiv.style.display === 'none') ? 'block' : 'none';
                    if (buttonElement) buttonElement.textContent = (promptDiv.style.display === 'none') ? '显示提示详情' : '隐藏提示详情';
                }
            }
            function copyToClipboard(textToCopy, buttonElement) {
                if (!textToCopy) { alert("Nothing to copy."); return; }
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalText = buttonElement.textContent;
                    buttonElement.textContent = '已复制!'; buttonElement.style.backgroundColor = '#28a745';
                    setTimeout(() => { buttonElement.textContent = originalText; buttonElement.style.backgroundColor = '#17a2b8'; }, 2000);
                }, (err) => { console.error('Async: Could not copy text: ', err); alert('复制提示失败。'); });
            }

            async function commitToGitHub(date, type) {
                const button = event.target;
                const originalText = button.textContent;
                button.textContent = '保存中...';
                button.disabled = true;

                const formData = new FormData();
                formData.append('date', date);

                if (type === 'daily') {
                    formData.append('prompts_markdown-1', document.getElementById('promptsMdCall1').value);
                    formData.append('daily_summary_markdown', document.getElementById('dailyMd').value);
                } else if (type === 'podcast') {
                    formData.append('prompts_markdown-2', document.getElementById('promptsMdCall2').value);
                    formData.append('podcast_script_markdown', document.getElementById('podcastMd').value);
                }

                try {
                    const response = await fetch('/commitToGitHub', {
                        method: 'POST',
                        body: formData
                    });

                    const result = await response.json();
                    if (response.ok) {
                        alert('GitHub 提交成功！');
                        console.log('GitHub Commit Success:', result);
                    } else {
                        alert('GitHub 提交失败: ' + result.message);
                        console.error('GitHub Commit Failed:', result);
                    }
                } catch (error) {
                    console.error('Error committing to GitHub:', error);
                    alert('请求失败，请检查网络或服务器。');
                } finally {
                    button.textContent = originalText;
                    button.disabled = false;
                }
            }

            async function generateAIDailyAnalysis(date) {
                const button = event.target;
                const originalText = button.textContent;
                button.textContent = '正在分析...';
                button.disabled = true;
                const analysisResultDiv = document.getElementById('dailyAnalysisResult');
                analysisResultDiv.style.display = 'none'; // Hide previous result
                analysisResultDiv.innerHTML = ''; // Clear previous result

                const summarizedContent = document.getElementById('summarizedContentInput').value; // Get summarized content from hidden input

                try {
                    const response = await fetch('/genAIDailyAnalysis', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ date: date, summarizedContent: summarizedContent })
                    });

                    if (response.ok) {
                        const result = await response.text();
                        analysisResultDiv.innerHTML = \`<h2>AI 日报分析结果</h2><div class="content-box">\${result}</div>\`;
                        analysisResultDiv.style.display = 'block';
                        //alert('AI 日报分析成功！');
                    } else {
                        const errorText = await response.text();
                        analysisResultDiv.innerHTML = \`<h2>AI 日报分析失败</h2><div class="content-box error">\${errorText}</div>\`;
                        analysisResultDiv.style.display = 'block';
                        alert('AI 日报分析失败: ' + errorText);
                    }
                } catch (error) {
                    console.error('Error generating AI daily analysis:', error);
                    analysisResultDiv.innerHTML = \`<h2>AI 日报分析失败</h2><div class="content-box error">请求失败，请检查网络或服务器。错误: \${escapeHtml(error.message)}</div>\`;
                    analysisResultDiv.style.display = 'block';
                    alert('请求失败，请检查网络或服务器。');
                } finally {
                    button.textContent = originalText;
                    button.disabled = false;
                }
            }
        </script>
        </body></html>`;
}


/**
 * 一个功能完善的 Markdown 到 HTML 的转换器。
 * 
 * 设计思路:
 * 1.  **tokenize(markdown)**: 词法分析器，将 Markdown 字符串转换为一个令牌数组。
 *     - 它按块（block-level elements）处理输入，如段落、标题、列表等。
 *     - 每个令牌是一个对象，如 { type: 'heading', depth: 1, text: '标题文字' }。
 *     - 包含内联 Markdown 的文本（如段落内容）会先保持原样，等待下一步处理。
 * 
 * 2.  **render(tokens)**: 渲染器，接收令牌数组并输出 HTML。
 *     - 它遍历令牌，根据令牌的 `type` 生成相应的 HTML 标签。
 *     - 当遇到需要处理内联元素的令牌时（如 heading, paragraph），它会调用 `parseInline`。
 * 
 * 3.  **parseInline(text)**: 内联解析器。
 *     - 它负责处理行内的 Markdown 语法，如加粗、斜体、链接、图片、行内代码等。
 *     - 它使用一系列的正则表达式按优先级顺序进行替换。
 * 
 * 4.  **辅助函数**: 如 `escapeHtml` 用于防止 XSS 攻击。
 */
export function markdownToHtml(markdown) {
    if (typeof markdown !== 'string') {
        console.error("Input must be a string.");
        return '';
    }

    // 预处理：规范化换行符，确保尾部有换行符以便于正则匹配
    const preprocessedMarkdown = markdown.replace(/\r\n?/g, '\n').replace(/^(#+\s*[^#\s].*)\s*#+\s*$/gm, '$1') + '\n\n';

    // --- 1. 辅助函数 ---
    const escapeHtml = (str) => {
        const map = {
            '&': '&',
            '<': '<',
            '>': '>',
            '"': '"',
            "'": '\''
        };
        return str.replace(/[&<>"']/g, m => map[m]);
    };


    // --- 2. 内联解析器 (Inline Parser) ---
    // 按优先级顺序处理内联元素
    const parseInline = (text) => {
        let html = text;

        // 图片: ![alt](src "title")
        html = html.replace(/!\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, alt, src, title) => {
            let titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
            return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}>`;
        });

        // 链接: [text](href "title")
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, text, href, title) => {
            let titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
            return `<a href="${escapeHtml(href)}"${titleAttr}>${parseInline(text)}</a>`; // 递归处理链接文本中的内联格式
        });
        
        // 行内代码: `code`
        html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);

        // 加粗+斜体: ***text*** 或 ___text___
        html = html.replace(/(\*\*\*|___)(.+?)\1/g, '<strong><em>$2</em></strong>');

        // 加粗: **text** 或 __text__
        html = html.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');

        // 斜体: *text* 或 _text_
        // html = html.replace(/(\*|_)(.+?)\1/g, '<em>$2</em>');

        // 删除线: ~~text~~
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        
        // 换行: 行尾两个空格
        html = html.replace(/ {2,}\n/g, '<br>\n');

        return html;
    };


    // --- 3. 词法分析器 (Tokenizer) ---
    const tokenize = (md) => {
        const tokens = [];
        let src = md;

        // 定义块级元素的正则表达式 (按优先级)
        const rules = {
            newline: /^\n+/,
            code: /^```(\w*)\n([\s\S]+?)\n```\n*/,
            fences: /^ {0,3}(`{3,}|~{3,})([^`~\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,
            heading: /^ {0,3}(#{1,6}) (.*)(?:\n+|$)/,
            hr: /^ {0,3}((?:- *){3,}|(?:_ *){3,}|(?:\* *){3,})(?:\n+|$)/,
            blockquote: /^( {0,3}> ?(.*)(?:\n|$))+/,
            list: /^( {0,3}(?:[*+-]|\d+\.) [^\n]*(?:\n(?!(?:[*+-]|\d+\. |>|#|`{3,}|-{3,}))[^\n]*)*)+/i,
            html: /^ {0,3}(?:<(script|pre|style|textarea)[\s>][\s\S]*?(?:<\/\1>[^\n]*\n+|$)|<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?(?:\?>\n*|$)|<![A-Z][\s\S]*?(?:>\n*|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>\n*|$)|<\/?(address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|nav|ol|p|param|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?: +|\n|\/?>)[\s\S]*?(?:\n\n+|$)|<(?!script|pre|style|textarea)[a-z][\w-]*\s*\/?>(?=[ \t]*(?:\n|$))[\s\S]*?(?:\n\n+|$))/,
            setextHeading: /^([^\n]+)\n {0,3}(=+|-+) *(?:\n+|$)/,
            paragraph: /^([^\n]+(?:\n(?! {0,3}(?:[*+-]|\d+\.) |>|#|`{3,}|-{3,}|={3,})[^\n]+)*)\n*/
        };

        while (src) {
            // 1. 空行
            let cap = rules.newline.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                tokens.push({ type: 'space' });
                continue;
            }
            
            // 2. Fenced Code Block (```)
            cap = rules.fences.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                tokens.push({
                    type: 'code',
                    lang: cap[2] ? cap[2].trim() : '',
                    text: cap[3] || ''
                });
                continue;
            }

            // 3. ATX Heading (# h1)
            cap = rules.heading.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                tokens.push({
                    type: 'heading',
                    depth: cap[1].length,
                    text: cap[2].trim()
                });
                continue;
            }
            
            // 4. Setext Heading (underline)
            cap = rules.setextHeading.exec(src);
            if(cap) {
                src = src.substring(cap[0].length);
                tokens.push({
                    type: 'heading',
                    depth: cap[2].charAt(0) === '=' ? 1 : 2,
                    text: cap[1]
                });
                continue;
            }
            
            // 5. Horizontal Rule
            cap = rules.hr.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                tokens.push({ type: 'hr' });
                continue;
            }
            
            // 6. Blockquote
            cap = rules.blockquote.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                // 移除每行开头的 '>' 和一个可选的空格
                const bqContent = cap[0].replace(/^ *> ?/gm, '');
                tokens.push({
                    type: 'blockquote',
                    // 递归地对块引用内容进行词法分析
                    tokens: tokenize(bqContent)
                });
                continue;
            }
            
            // 7. List
            cap = rules.list.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                const listStr = cap[0];
                const ordered = /^\d+\./.test(listStr);
                const itemRegex = /^( *)([*+-]|\d+\.) +([^\n]*(?:\n(?! {0,3}(?:[*+-]|\d+\.) )[^\n]*)*)/gm;
                const items = [];
                let match;
                while ((match = itemRegex.exec(listStr)) !== null) {
                    const [, indent, , itemContent] = match;
                    // 处理嵌套内容，移除当前项的缩进
                    const nestedContent = itemContent.replace(new RegExp('^' + ' '.repeat(indent.length), 'gm'), '');
                    items.push({
                        type: 'list_item',
                        // 递归地对列表项内容进行词法分析
                        tokens: tokenize(nestedContent)
                    });
                }

                tokens.push({
                    type: 'list',
                    ordered: ordered,
                    items: items
                });
                continue;
            }
            
            // 8. Raw HTML
            cap = rules.html.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                tokens.push({
                    type: 'html',
                    text: cap[0]
                });
                continue;
            }
            
            // 9. Paragraph (作为最后的 fallback)
            cap = rules.paragraph.exec(src);
            if (cap) {
                src = src.substring(cap[0].length);
                tokens.push({
                    type: 'paragraph',
                    text: cap[1].trim()
                });
                continue;
            }

            // 如果没有规则匹配，说明有未知语法，跳过一个字符防止死循环
            if (src) {
                console.error(`Infinite loop on: ${src.slice(0, 20)}`);
                src = src.substring(1);
            }
        }
        return tokens;
    };


    // --- 4. 渲染器 (Renderer) ---
    const render = (tokens) => {
        let html = '';
        
        for (const token of tokens) {
            switch (token.type) {
                case 'space':
                    break;
                case 'hr':
                    html += '<hr>\n';
                    break;
                case 'heading':
                    html += `<h${token.depth}>${parseInline(token.text)}</h${token.depth}>\n`;
                    break;

                case 'code':
                    const langClass = token.lang ? ` class="language-${escapeHtml(token.lang)}"` : '';
                    html += `<pre><code${langClass}>${escapeHtml(token.text)}</code></pre>\n`;
                    break;
                
                case 'blockquote':
                    // 递归渲染块引用内的令牌
                    html += `<blockquote>\n${render(token.tokens)}</blockquote>\n`;
                    break;
                
                case 'list':
                    const tag = 'ul';
                    let listContent = '';
                    for (const item of token.items) {
                        // 递归渲染列表项内的令牌
                        listContent += `<li>${render(item.tokens).trim()}</li>\n`;
                    }
                    html += `<${tag}>\n${listContent}</${tag}>\n`;
                    break;
                    
                case 'paragraph':
                    html += `<p>${parseInline(token.text)}</p>\n`;
                    break;
                    
                case 'html':
                    html += token.text;
                    break;
                    
                default:
                    console.error(`Unknown token type: ${token.type}`);
            }
        }
        return html;
    };
    
    // --- 执行流程 ---
    const tokens = tokenize(preprocessedMarkdown);
    const result = render(tokens);
    return result.trim();
}
