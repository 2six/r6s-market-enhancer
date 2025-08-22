document.addEventListener('DOMContentLoaded', async () => {
    const refreshButton = document.getElementById('refreshButton');
    const statusDiv = document.getElementById('status');
    const tableHeader = document.getElementById('tableHeader');
    const tableBody = document.getElementById('tableBody');
    const ownedTab = document.getElementById('ownedTab');
    const favoritesTab = document.getElementById('favoritesTab');
    const tabsContainer = document.querySelector('.tabs');

    let activeTab = 'favorites';
    let ownedItems = [];
    let favoriteItems = [];
    let settings = {};
    let priceAlerts = {};
    const SELL_LOCK_DAYS = 15;
    let sortConfig = {
        owned: { key: 'profitRatio_current', dir: 'desc' },
        favorites: { key: 'undervalue_7d', dir: 'desc' }
    };

    function showAlertModal(itemId, itemName, currentAlert) {
        const existingModal = document.getElementById('enhancer-alert-modal');
        if (existingModal) existingModal.remove();

        const overlay = document.createElement('div');
        overlay.id = 'enhancer-alert-modal';
        overlay.className = 'enhancer-modal-overlay';
        
        const content = document.createElement('div');
        content.className = 'enhancer-modal-content';
        
        content.innerHTML = `
            <h3 title="${itemName}">${itemName}</h3>
            <div class="enhancer-modal-row">
                <label for="enhancer-alert-type">가격 종류</label>
                <select id="enhancer-alert-type">
                    <option value="sell" ${currentAlert?.type === 'sell' ? 'selected' : ''}>최저 판매가</option>
                    <option value="buy" ${currentAlert?.type === 'buy' ? 'selected' : ''}>최고 구매가</option>
                </select>
            </div>
            <div class="enhancer-modal-row">
                <label for="enhancer-alert-condition">조건</label>
                <select id="enhancer-alert-condition">
                    <option value="below" ${currentAlert?.condition === 'below' ? 'selected' : ''}>... 이하</option>
                    <option value="above" ${currentAlert?.condition === 'above' ? 'selected' : ''}>... 이상</option>
                </select>
            </div>
            <div class="enhancer-modal-row">
                <label for="enhancer-alert-price">목표 가격</label>
                <input type="number" id="enhancer-alert-price" value="${currentAlert?.price || ''}" placeholder="크레딧 입력">
            </div>
            <div class="enhancer-modal-buttons">
                <div>
                    <button id="enhancer-alert-save">저장</button>
                    <button id="enhancer-alert-cancel">취소</button>
                </div>
                ${currentAlert ? '<button id="enhancer-alert-delete">삭제</button>' : ''}
            </div>
        `;

        overlay.appendChild(content);
        document.body.appendChild(overlay);

        document.getElementById('enhancer-alert-save').addEventListener('click', () => {
            const price = parseInt(document.getElementById('enhancer-alert-price').value, 10);
            if (!price || price <= 0) {
                alert('올바른 가격을 입력하세요.');
                return;
            }
            const alert = {
                itemId: itemId,
                name: itemName,
                type: document.getElementById('enhancer-alert-type').value,
                condition: document.getElementById('enhancer-alert-condition').value,
                price: price
            };
            chrome.runtime.sendMessage({ action: "addOrUpdatePriceAlert", payload: { itemId, alert }});
            overlay.remove();
        });

        document.getElementById('enhancer-alert-cancel').addEventListener('click', () => {
            overlay.remove();
        });

        const deleteBtn = document.getElementById('enhancer-alert-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                chrome.runtime.sendMessage({ action: "removePriceAlert", payload: { itemId }});
                overlay.remove();
            });
        }
    }

    function updateStatusText(data) {
        const isUpdating = activeTab === 'owned' ? data.isDashboardUpdating : data.isUpdating;
        const lastUpdate = activeTab === 'owned' ? data.lastDashboardUpdate : data.lastUpdate;
        if (isUpdating) {
            refreshButton.disabled = true;
            statusDiv.textContent = '업데이트 중...';
        } else {
            refreshButton.disabled = false;
            statusDiv.textContent = lastUpdate ? `마지막 업데이트: ${new Date(lastUpdate).toLocaleTimeString()}` : '데이터 없음';
        }
    }

    function switchTab(tabName) {
        if (!settings.showFavoritesTab && tabName === 'favorites') return;
        if (!settings.showOwnedTab && tabName === 'owned') return;
        if (activeTab === tabName) return;
        activeTab = tabName;
        chrome.storage.local.set({ popupActiveTab: activeTab });
        chrome.storage.local.get(['lastUpdate', 'lastDashboardUpdate', 'isUpdating', 'isDashboardUpdating'], (data) => {
            updateStatusText(data || {});
        });
        updateTabUI();
        renderTabContent();
    }
    
    function updateTabUI() {
        ownedTab.style.display = settings.showOwnedTab ? 'inline-block' : 'none';
        favoritesTab.style.display = settings.showFavoritesTab ? 'inline-block' : 'none';
        if (!settings.showOwnedTab && !settings.showFavoritesTab) {
            tabsContainer.style.display = 'none';
            refreshButton.style.display = 'none';
        } else {
            tabsContainer.style.display = 'flex';
            refreshButton.style.display = 'block';
        }
        ownedTab.classList.toggle('active', activeTab === 'owned');
        favoritesTab.classList.toggle('active', activeTab === 'favorites');
    }

    function renderPage(data) {
        settings = data.settings || {};
        priceAlerts = data.priceAlerts || {};
        if (data.settings && data.settings.popupSortConfig) {
            sortConfig = data.settings.popupSortConfig;
        }
        ownedItems = data.ownedItems || [];
        
        const { marketData = {}, personalData = {}, favoriteIds = [] } = data;
        const combinedData = Object.keys(marketData).map(itemId => ({
            ...marketData[itemId],
            ...(personalData[itemId] || {}),
            isFavorite: favoriteIds.includes(itemId)
        }));
        favoriteItems = combinedData.filter(item => item.isFavorite);

        updateStatusText(data);
        updateTabUI();
        renderTabContent();
    }
    
    function sortData(dataArray) {
        const config = sortConfig[activeTab];
        if (!config || !config.key) return;

        dataArray.sort((a, b) => {
            let valA = a[config.key];
            let valB = b[config.key];

            if (config.key === 'undervalue_7d') {
                valA = _calculateUndervalue(a.avgPrice_7d, a.currentLowestSellPrice);
                valB = _calculateUndervalue(b.avgPrice_7d, b.currentLowestSellPrice);
            }
            
            const isAsc = config.dir === 'asc';
            if (valA === null || typeof valA === 'undefined') return 1;
            if (valB === null || typeof valB === 'undefined') return -1;
            if (typeof valA === 'string') {
                return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return isAsc ? valA - valB : valB - valA;
        });
    }

    function renderTabContent() {
        let itemsToRender;
        if (activeTab === 'owned' && settings.showOwnedTab) {
            itemsToRender = [...ownedItems];
            sortData(itemsToRender);
            renderOwnedItems(itemsToRender);
        } else if (activeTab === 'favorites' && settings.showFavoritesTab) {
            itemsToRender = [...favoriteItems];
            sortData(itemsToRender);
            renderFavoriteItems(itemsToRender);
        } else {
            tableHeader.innerHTML = '';
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">표시할 탭이 설정되지 않았습니다.</td></tr>';
        }
        updateSortHeaderUI();
    }
    
    function getItemNameHtml(item) {
        let alertBtnHtml = '';
        if (settings.usePriceAlerts !== false && item.isFavorite) {
            const alertBtnClass = `alert-btn ${priceAlerts[item.itemId] ? 'active' : ''}`;
            alertBtnHtml = `<span class="${alertBtnClass}" title="가격 알림 설정">🔔</span>`;
        }
        return `<div class="item-name-container"><span class="item-name">${item.name || '이름 없음'}</span>${alertBtnHtml}</div>`;
    }

    function renderOwnedItems(data) {
        if (data.length === 0) {
            tableHeader.innerHTML = '';
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">보유 아이템이 없습니다.</td></tr>';
            return;
        }
        const mode = settings.popupMode || 'extended';
        const headers = `<tr><th class="col-img">이미지</th><th class="col-name col-name-th" data-sort-key="name">이름</th><th class="col-data1" data-sort-key="myBuyPrice">내 구매가</th><th class="col-data2" data-sort-key="currentLowestSellPrice">현재가</th><th class="col-data3" data-sort-key="profitRatio_current">수익률(%)</th><th class="col-action" data-sort-key="buyDate">상태</th></tr>`;
        tableHeader.innerHTML = headers;

        if (mode === 'extended') {
            tableBody.innerHTML = data.map(item => {
                const subInfoParts = [item.itemType, item.primaryTag, item.subTag, item.rarity, item.season].filter(Boolean);
                const subInfoHTML = subInfoParts.length > 0 ? `<div class="sub-info"><span>${subInfoParts.join('</span><span>')}</span></div>` : '';
                return `
                    <tr class="main-row" data-item-name="${item.name || ''}" data-item-id="${item.itemId}">
                        <td class="no-bottom-border" rowspan="2"><img src="${item.assetUrl || ''}?imwidth=80" class="item-image"></td>
                        <td class="col-name-td no-bottom-border">${getItemNameHtml(item)}</td>
                        <td class="no-bottom-border">${item.myBuyPrice !== null && item.myBuyPrice !== undefined ? item.myBuyPrice : '획득'}</td>
                        <td class="no-bottom-border">${formatNumber(item.currentLowestSellPrice)}</td>
                        <td class="no-bottom-border ${getColorClass(item.profitRatio_current)}">${formatNumber(item.profitRatio_current, 1, '%')}</td>
                        ${getSellabilityHtml(item.buyDate, true)}
                    </tr>
                    <tr class="sub-row" data-item-id="${item.itemId}">
                        <td colspan="4" class="col-name-td">${subInfoHTML}</td>
                    </tr>`;
            }).join('');
        } else {
            tableBody.innerHTML = data.map(item => {
                let rowTooltip = '';
                if (mode === 'tooltip') {
                    const subInfoParts = [item.itemType, item.primaryTag, item.subTag, item.rarity, item.season].filter(Boolean);
                    if (subInfoParts.length > 0) rowTooltip = ` title="${subInfoParts.join(' | ')}"`;
                }
                return `
                    <tr class="data-row" data-item-name="${item.name || ''}" data-item-id="${item.itemId}"${rowTooltip}>
                        <td><img src="${item.assetUrl || ''}?imwidth=80" class="item-image"></td>
                        <td class="col-name-td">${getItemNameHtml(item)}</td>
                        <td>${item.myBuyPrice !== null && item.myBuyPrice !== undefined ? item.myBuyPrice : '획득'}</td>
                        <td>${formatNumber(item.currentLowestSellPrice)}</td>
                        <td class="${getColorClass(item.profitRatio_current)}">${formatNumber(item.profitRatio_current, 1, '%')}</td>
                        ${getSellabilityHtml(item.buyDate, false)}
                    </tr>`;
            }).join('');
        }
    }

    function renderFavoriteItems(data) {
        if (data.length === 0) {
            tableHeader.innerHTML = '';
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">즐겨찾기한 아이템이 없습니다.</td></tr>';
            return;
        }
        const mode = settings.popupMode || 'extended';
        const headers = `<tr><th class="col-img">이미지</th><th class="col-name col-name-th" data-sort-key="name">이름</th><th class="col-data1" data-sort-key="currentLowestSellPrice">현재가</th><th class="col-data2" data-sort-key="currentHighestBuyPrice">최고 구매가</th><th class="col-data3" data-sort-key="undervalue_7d">저평가(7d)</th><th class="col-action">삭제</th></tr>`;
        tableHeader.innerHTML = headers;
        
        if (mode === 'extended') {
            tableBody.innerHTML = data.map(item => {
                const subInfoParts = [item.itemType, item.primaryTag, item.subTag, item.rarity, item.season].filter(Boolean);
                const subInfoHTML = subInfoParts.length > 0 ? `<div class="sub-info"><span>${subInfoParts.join('</span><span>')}</span></div>` : '';
                const undervalue7d = _calculateUndervalue(item.avgPrice_7d, item.currentLowestSellPrice);
                return `
                    <tr class="main-row" data-item-name="${item.name || ''}" data-item-id="${item.itemId}">
                        <td class="no-bottom-border" rowspan="2"><img src="${item.assetUrl || ''}?imwidth=80" class="item-image"></td>
                        <td class="col-name-td no-bottom-border">${getItemNameHtml(item)}</td>
                        <td class="no-bottom-border">${formatNumber(item.currentLowestSellPrice)}</td>
                        <td class="no-bottom-border">${formatNumber(item.currentHighestBuyPrice)}</td>
                        <td class="no-bottom-border ${getColorClass(undervalue7d)}">${formatNumber(undervalue7d, 1, '%')}</td>
                        <td class="no-bottom-border" rowspan="2"><span class="delete-btn" title="즐겨찾기 삭제">×</span></td>
                    </tr>
                    <tr class="sub-row" data-item-id="${item.itemId}">
                        <td colspan="4" class="col-name-td">${subInfoHTML}</td>
                    </tr>`;
            }).join('');
        } else {
            tableBody.innerHTML = data.map(item => {
                let rowTooltip = '';
                if (mode === 'tooltip') {
                    const subInfoParts = [item.itemType, item.primaryTag, item.subTag, item.rarity, item.season].filter(Boolean);
                    if (subInfoParts.length > 0) rowTooltip = ` title="${subInfoParts.join(' | ')}"`;
                }
                const undervalue7d = _calculateUndervalue(item.avgPrice_7d, item.currentLowestSellPrice);
                return `
                    <tr class="data-row" data-item-name="${item.name || ''}" data-item-id="${item.itemId}"${rowTooltip}>
                        <td><img src="${item.assetUrl || ''}?imwidth=80" class="item-image"></td>
                        <td class="col-name-td">${getItemNameHtml(item)}</td>
                        <td>${formatNumber(item.currentLowestSellPrice)}</td>
                        <td>${formatNumber(item.currentHighestBuyPrice)}</td>
                        <td class="${getColorClass(undervalue7d)}">${formatNumber(undervalue7d, 1, '%')}</td>
                        <td><span class="delete-btn" title="즐겨찾기 삭제">×</span></td>
                    </tr>`;
            }).join('');
        }
    }
    
    function updateSortHeaderUI() {
        tableHeader.querySelectorAll('th[data-sort-key]').forEach(th => {
            th.classList.remove('sorted');
        });
        const config = sortConfig[activeTab];
        if (config && config.key) {
            const activeHeader = tableHeader.querySelector(`th[data-sort-key="${config.key}"]`);
            if (activeHeader) {
                activeHeader.classList.add('sorted');
            }
        }
    }

    function getSellabilityHtml(buyDateStr, isExtended) {
        const CELL_TAG = isExtended ? 'td class="no-bottom-border" rowspan="2"' : 'td';
        if (!buyDateStr) return `<${CELL_TAG}><span class="sellable" title="✅ 판매 가능">✅</span></${CELL_TAG}>`;
        
        const now = new Date();
        const buyDate = new Date(buyDateStr);
        const msRemaining = (buyDate.getTime() + (SELL_LOCK_DAYS * 24 * 60 * 60 * 1000)) - now.getTime();

        if (msRemaining <= 0) {
            return `<${CELL_TAG}><span class="sellable" title="✅ 판매 가능">✅</span></${CELL_TAG}>`;
        }

        let content;
        if (msRemaining < 24 * 60 * 60 * 1000) {
            const hoursRemaining = Math.ceil(msRemaining / (1000 * 60 * 60));
            content = `<span class="locked" title="🔒 ${hoursRemaining}시간 후 판매 가능">🔒</span>`;
        } else {
            const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            content = `<span class="locked" title="🔒 ${daysRemaining}일 후 판매 가능">🔒</span>`;
        }
        return `<${CELL_TAG}>${content}</${CELL_TAG}>`;
    }
    
    function getColorClass(value) { return value > 0 ? 'positive' : (value < 0 ? 'negative' : 'neutral'); }
    function formatNumber(value, fractionDigits = 0, suffix = '') {
        if (value === null || typeof value === 'undefined') return '-';
        return (typeof value.toFixed === 'function') ? value.toFixed(fractionDigits) + suffix : value + suffix;
    }
    const _calculateUndervalue = (avgPrice, currentSell) => { if (avgPrice == null || currentSell == null || avgPrice === 0) return null; return +(((avgPrice - currentSell) / avgPrice) * 100); };
    
    ownedTab.addEventListener('click', () => switchTab('owned'));
    favoritesTab.addEventListener('click', () => switchTab('favorites'));

    refreshButton.addEventListener('click', () => {
        statusDiv.textContent = '업데이트 중...';
        refreshButton.disabled = true;
        const action = activeTab === 'owned' ? 'syncPersonalDataAndRefreshOwned' : 'refreshFavoritesMarketData';
        chrome.runtime.sendMessage({ action: action });
    });

    tableHeader.addEventListener('click', async (e) => {
        const header = e.target.closest('th[data-sort-key]');
        if (!header) return;

        const sortKey = header.dataset.sortKey;
        const config = sortConfig[activeTab];

        if (config.key === sortKey) {
            config.dir = config.dir === 'asc' ? 'desc' : 'asc';
        } else {
            config.key = sortKey;
            config.dir = 'desc';
        }
        
        const data = await chrome.storage.local.get('settings');
        const newSettings = { ...(data.settings || {}), popupSortConfig: sortConfig };
        await chrome.storage.local.set({ settings: newSettings });

        renderTabContent();
    });

    tableBody.addEventListener('mouseover', e => {
        const row = e.target.closest('tr');
        if (!row) return;
        
        if (row.classList.contains('main-row')) {
            row.classList.add('hover-effect');
            const nextRow = row.nextElementSibling;
            if (nextRow && nextRow.classList.contains('sub-row')) {
                nextRow.classList.add('hover-effect');
            }
        } else if (row.classList.contains('sub-row')) {
            row.classList.add('hover-effect');
            const prevRow = row.previousElementSibling;
            if (prevRow && prevRow.classList.contains('main-row')) {
                prevRow.classList.add('hover-effect');
            }
        }
    });

    tableBody.addEventListener('mouseout', e => {
        const row = e.target.closest('tr');
        if (!row) return;

        if (row.classList.contains('main-row') || row.classList.contains('sub-row')) {
            const relatedRows = Array.from(tableBody.querySelectorAll(`[data-item-id='${row.dataset.itemId}']`));
            relatedRows.forEach(r => r.classList.remove('hover-effect'));
        }
    });

    tableBody.addEventListener('click', async (e) => {
        const target = e.target;
        const row = target.closest('tr');
        if (!row) return;

        let mainRow = row;
        if(row.classList.contains('sub-row')) {
            mainRow = row.previousElementSibling;
        }
        if (!mainRow || !mainRow.dataset.itemId) return;
        const itemId = mainRow.dataset.itemId;
        
        if (target.classList.contains('delete-btn')) {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: "toggleFavorite", payload: { itemId: itemId } });
            return;
        } 
        
        if (target.classList.contains('alert-btn')) {
            e.stopPropagation();
            if (settings.usePriceAlerts) {
                const itemName = mainRow.dataset.itemName;
                showAlertModal(itemId, itemName, priceAlerts[itemId]);
            } else {
                alert("가격 알림 기능을 사용하려면 먼저 옵션 페이지에서 활성화해주세요.");
            }
            return;
        }
        
        if (e.ctrlKey || e.metaKey) {
            const route = activeTab === 'owned' ? 'sell/item-details' : 'buy/item-details';
            const { settings } = await chrome.storage.local.get('settings');
            const linkAction = settings?.popupLinkAction || 'navigate';

            if (linkAction === 'navigate') {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0] && tabs[0].url.includes("siege/marketplace")) {
                        chrome.tabs.sendMessage(tabs[0].id, { action: "navigateToItem", payload: { itemId, route } });
                        window.close();
                    } else {
                        const itemUrl = `https://www.ubisoft.com/ko-kr/game/rainbow-six/siege/marketplace?route=${encodeURIComponent(route)}&itemId=${itemId}`;
                        chrome.tabs.create({ url: itemUrl, active: false });
                    }
                });
            } else {
                const itemUrl = `https://www.ubisoft.com/ko-kr/game/rainbow-six/siege/marketplace?route=${encodeURIComponent(route)}&itemId=${itemId}`;
                chrome.tabs.create({ url: itemUrl, active: false });
            }
        } else {
            const itemName = mainRow.dataset.itemName;
            navigator.clipboard.writeText(itemName).then(() => {
                const originalText = statusDiv.textContent;
                statusDiv.textContent = `✅ "${itemName}" 복사 완료!`;
                setTimeout(() => { statusDiv.textContent = originalText; }, 1500);
            });
        }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
             chrome.runtime.sendMessage({ action: "getSharedData" }, (response) => {
                if (chrome.runtime.lastError || (response && response.error)) {
                    return;
                }
                renderPage(response);
            });
        }
    });

    async function init() {
        const storageData = await chrome.storage.local.get('popupActiveTab');
        const savedTab = storageData.popupActiveTab;

        chrome.runtime.sendMessage({ action: "getSharedData" }, (response) => {
            if (chrome.runtime.lastError || (response && response.error)) {
                statusDiv.textContent = '데이터 로딩 오류.';
                return;
            }
            renderPage(response);
            
            const defaultTab = response.settings?.showFavoritesTab ? 'favorites' : (response.settings?.showOwnedTab ? 'owned' : null);
            let targetTab = savedTab || defaultTab;
            if (targetTab === 'owned' && !response.settings?.showOwnedTab) targetTab = 'favorites';
            if (targetTab === 'favorites' && !response.settings?.showFavoritesTab) targetTab = 'owned';
            
            if(targetTab) {
                activeTab = targetTab;
                chrome.storage.local.get(['lastUpdate', 'lastDashboardUpdate', 'isUpdating', 'isDashboardUpdating'], (data) => {
                    updateStatusText(data || {});
                });
                updateTabUI();
                renderTabContent();
            } else {
                updateTabUI();
                renderTabContent();
            }
        });
    }

    init();
});