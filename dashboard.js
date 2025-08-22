document.addEventListener('DOMContentLoaded', () => {
    const refreshButton = document.getElementById('refreshButton');
    const statusEl = document.getElementById('status');
    const ownedTab = document.getElementById('ownedTab');
    const favoritesTab = document.getElementById('favoritesTab');
    const reportContainer = document.getElementById('reportContainer');
    const infoTextEl = document.getElementById('info-text');
    const searchInput = document.getElementById('searchInput');
    const typeFilter = document.getElementById('typeFilter');
    const sellableFilter = document.getElementById('sellableFilter');

    let ownedItems = [];
    let favoriteItems = [];
    let currentSortKey = 'profitRatio_current';
    let isAscending = false;
    let activeTab = 'owned';
    const SELL_LOCK_DAYS = 15;

    const _calculateUndervalue = (avgPrice, currentSell) => { if (avgPrice == null || currentSell == null || avgPrice === 0) return null; return +(((avgPrice - currentSell) / avgPrice) * 100); };

    function updateStatusText(data) {
        const isUpdating = activeTab === 'owned' ? data.isDashboardUpdating : data.isUpdating;
        const lastUpdate = activeTab === 'owned' ? data.lastDashboardUpdate : data.lastUpdate;
        if (isUpdating) {
            refreshButton.disabled = true;
            statusEl.textContent = '업데이트 중...';
        } else {
            refreshButton.disabled = false;
            statusEl.textContent = lastUpdate ? `마지막 업데이트: ${new Date(lastUpdate).toLocaleString()}` : '데이터가 없습니다. 새로고침 해주세요.';
        }
    }

    function switchTab(tabName) {
        if (activeTab === tabName) return;
        activeTab = tabName;
        ownedTab.classList.toggle('active', tabName === 'owned');
        favoritesTab.classList.toggle('active', tabName === 'favorites');
        sellableFilter.style.display = (tabName === 'owned') ? 'block' : 'none';
        currentSortKey = (tabName === 'owned') ? 'profitRatio_current' : 'undervalue_14d';
        isAscending = false;
        chrome.storage.local.get(['lastUpdate', 'lastDashboardUpdate', 'isUpdating', 'isDashboardUpdating'], (data) => {
            updateStatusText(data || {});
        });
        renderTabContent();
    }
    
    function renderPage(data) {
        ownedItems = data.ownedItems || [];
        
        const { marketData = {}, personalData = {}, favoriteIds = [] } = data;
        const combinedData = Object.keys(marketData).map(itemId => ({
            ...marketData[itemId],
            ...(personalData[itemId] || {}),
            isFavorite: favoriteIds.includes(itemId)
        }));
        const rawFavoriteItems = combinedData.filter(item => item.isFavorite);
        
        favoriteItems = rawFavoriteItems.map(item => ({
            ...item,
            undervalue_7d: _calculateUndervalue(item.avgPrice_7d, item.currentLowestSellPrice),
            undervalue_14d: _calculateUndervalue(item.avgPrice_14d, item.currentLowestSellPrice)
        }));
        updateStatusText(data);
    }
    
    function renderTabContent() {
        const sourceData = (activeTab === 'owned') ? ownedItems : favoriteItems;
        if (!sourceData) {
            reportContainer.innerHTML = "";
            return;
        }
        
        const searchTerm = searchInput.value.toLowerCase();
        const selectedType = typeFilter.value;
        const sellableStatus = sellableFilter.value;

        const filteredData = sourceData.filter(item => {
            const nameMatch = item.name?.toLowerCase().includes(searchTerm);
            const primaryTagMatch = item.primaryTag?.toLowerCase().includes(searchTerm);
            const subTagMatch = item.subTag?.toLowerCase().includes(searchTerm);
            const searchMatch = !searchTerm || nameMatch || primaryTagMatch || subTagMatch;
            const typeMatch = !selectedType || item.itemType === selectedType;
            let sellableMatch = true;
            if (activeTab === 'owned' && sellableStatus) {
                const isSellable = !item.buyDate || Math.max(0, Math.ceil(SELL_LOCK_DAYS - (new Date() - new Date(item.buyDate)) / (1000 * 60 * 60 * 24))) <= 0;
                sellableMatch = (sellableStatus === 'true') === isSellable;
            }
            return searchMatch && typeMatch && sellableMatch;
        });

        sortData(filteredData);

        if (activeTab === 'owned') {
            infoTextEl.textContent = `마지막 판매가 기준 상위 100개 중 ${filteredData.length}개 표시`;
            reportContainer.innerHTML = generateOwnedItemsTable(filteredData);
        } else {
            infoTextEl.textContent = `총 ${favoriteItems.length}개 중 ${filteredData.length}개 표시`;
            reportContainer.innerHTML = generateFavoritesTable(filteredData);
        }
        
        updateSortedHeader();
    }

    function generateOwnedItemsTable(data) {
        if (data.length === 0) return '<p>표시할 아이템이 없습니다.</p>';
        const headers = `<thead><tr><th rowspan="2" data-sort-key="name">이미지</th><th rowspan="2" data-sort-key="name">이름</th><th rowspan="2" data-sort-key="buyDate">판매 상태</th><th rowspan="2" data-sort-key="myBuyPrice">내 구매가</th><th colspan="4">현재</th><th colspan="4">7일</th><th colspan="4">14일</th></tr><tr><th data-sort-key="currentLowestSellPrice">판매가</th><th data-sort-key="currentHighestBuyPrice">구매가</th><th data-sort-key="netProfit_current">순수익</th><th data-sort-key="profitRatio_current">수익률(%)</th><th data-sort-key="avgPrice_7d">평균가</th><th data-sort-key="avgHighestPrice_7d">최고가 평균</th><th data-sort-key="netProfit_7d">순수익</th><th data-sort-key="profitRatio_7d">수익률(%)</th><th data-sort-key="avgPrice_14d">평균가</th><th data-sort-key="avgHighestPrice_14d">최고가 평균</th><th data-sort-key="netProfit_14d">순수익</th><th data-sort-key="profitRatio_14d">수익률(%)</th></tr></thead>`;
        const rows = data.map(item => {
            const subInfoParts = [item.itemType, item.primaryTag, item.subTag, item.rarity, item.season].filter(Boolean);
            const subInfoHTML = subInfoParts.length > 0 ? `<div class="sub-info"><span>${subInfoParts.join('</span><span>')}</span></div>` : '';
            return `
                <tr>
                    <td class="td-img"><img src="${item.assetUrl}" alt="${item.name}"></td>
                    <td class="td-name-container"><div class="item-name-text">${item.name}</div>${subInfoHTML}</td>
                    ${getSellabilityHtml(item.buyDate)}
                    <td>${item.myBuyPrice !== null && item.myBuyPrice !== undefined ? item.myBuyPrice : '획득'}</td>
                    <td>${formatNumber(item.currentLowestSellPrice)}</td>
                    <td>${formatNumber(item.currentHighestBuyPrice)}</td>
                    <td class="${getColorClass(item.netProfit_current)}">${formatNumber(item.netProfit_current)}</td>
                    <td class="${getColorClass(item.profitRatio_current)}">${formatNumber(item.profitRatio_current, 1, '%')}</td>
                    <td>${formatNumber(item.avgPrice_7d)}</td>
                    <td>${formatNumber(item.avgHighestPrice_7d)}</td>
                    <td class="${getColorClass(item.netProfit_7d)}">${formatNumber(item.netProfit_7d)}</td>
                    <td class="${getColorClass(item.profitRatio_7d)}">${formatNumber(item.profitRatio_7d, 1, '%')}</td>
                    <td>${formatNumber(item.avgPrice_14d)}</td>
                    <td>${formatNumber(item.avgHighestPrice_14d)}</td>
                    <td class="${getColorClass(item.netProfit_14d)}">${formatNumber(item.netProfit_14d)}</td>
                    <td class="${getColorClass(item.profitRatio_14d)}">${formatNumber(item.profitRatio_14d, 1, '%')}</td>
                </tr>`;
        }).join('');
        return `<table>${headers}<tbody>${rows}</tbody></table>`;
    }

    function generateFavoritesTable(data) {
        if (data.length === 0) return '<p>표시할 아이템이 없습니다.</p>';
        const headers = `<thead><tr><th rowspan="2" data-sort-key="name">이미지</th><th rowspan="2" data-sort-key="name">이름</th><th colspan="3">현재</th><th colspan="3">7일</th><th colspan="3">14일</th></tr><tr><th data-sort-key="currentLowestSellPrice">최저 판매가</th><th data-sort-key="currentHighestBuyPrice">최고 구매가</th><th data-sort-key="spread">스프레드</th><th data-sort-key="avgPrice_7d">평균가</th><th data-sort-key="avgHighestPrice_7d">최고가 평균</th><th data-sort-key="undervalue_7d">저평가(%)</th><th data-sort-key="avgPrice_14d">평균가</th><th data-sort-key="avgHighestPrice_14d">최고가 평균</th><th data-sort-key="undervalue_14d">저평가(%)</th></tr></thead>`;
        const rows = data.map(item => {
            const subInfoParts = [item.itemType, item.primaryTag, item.subTag, item.rarity, item.season].filter(Boolean);
            const subInfoHTML = subInfoParts.length > 0 ? `<div class="sub-info"><span>${subInfoParts.join('</span><span>')}</span></div>` : '';
            return `
                <tr>
                    <td class="td-img"><img src="${item.assetUrl}" alt="${item.name}"></td>
                    <td class="td-name-container"><div class="item-name-text">${item.name}</div>${subInfoHTML}</td>
                    <td>${formatNumber(item.currentLowestSellPrice)}</td>
                    <td>${formatNumber(item.currentHighestBuyPrice)}</td>
                    <td>${formatNumber(item.spread)}</td>
                    <td>${formatNumber(item.avgPrice_7d)}</td>
                    <td>${formatNumber(item.avgHighestPrice_7d)}</td>
                    <td class="${getColorClass(item.undervalue_7d)}">${formatNumber(item.undervalue_7d, 1, '%')}</td>
                    <td>${formatNumber(item.avgPrice_14d)}</td>
                    <td>${formatNumber(item.avgHighestPrice_14d)}</td>
                    <td class="${getColorClass(item.undervalue_14d)}">${formatNumber(item.undervalue_14d, 1, '%')}</td>
                </tr>`;
        }).join('');
        return `<table>${headers}<tbody>${rows}</tbody></table>`;
    }

    function sortTable(sortKey) {
        if (currentSortKey === sortKey) {
            isAscending = !isAscending;
        } else {
            currentSortKey = sortKey;
            isAscending = false;
        }
        renderTabContent();
    }
    
    function sortData(dataArray) {
        dataArray.sort((a, b) => {
            const valA = a[currentSortKey];
            const valB = b[currentSortKey];
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            if (typeof valA === 'number') {
                return isAscending ? valA - valB : valB - valA;
            }
            if (typeof valA === 'string') {
                return isAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return 0;
        });
    }
    
    function updateSortedHeader() {
        document.querySelectorAll('#reportContainer th[data-sort-key]').forEach(th => {
            th.classList.toggle('sorted', th.dataset.sortKey === currentSortKey);
        });
    }

    function getSellabilityHtml(buyDateStr) {
        if (!buyDateStr) return `<td class="sellable" title="✅ 판매 가능">✅</td>`;

        const now = new Date();
        const buyDate = new Date(buyDateStr);
        const msRemaining = (buyDate.getTime() + (SELL_LOCK_DAYS * 24 * 60 * 60 * 1000)) - now.getTime();

        if (msRemaining <= 0) {
            return `<td class="sellable" title="✅ 판매 가능">✅</td>`;
        }

        if (msRemaining < 24 * 60 * 60 * 1000) {
            const hoursRemaining = Math.ceil(msRemaining / (1000 * 60 * 60));
            return `<td class="locked" title="🔒 ${hoursRemaining}시간 후 판매 가능">🔒</td>`;
        } else {
            const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            return `<td class="locked" title="🔒 ${daysRemaining}일 후 판매 가능">🔒</td>`;
        }
    }
    function getColorClass(value) {
        if (value === null || typeof value === 'undefined') return 'neutral';
        return value > 0 ? 'positive' : (value < 0 ? 'negative' : 'neutral');
    }
    function formatNumber(value, fractionDigits = 0, suffix = '') {
        if (value === null || typeof value === 'undefined') return '-';
        return (typeof value.toFixed === 'function') ? value.toFixed(fractionDigits) + suffix : value + suffix;
    }

    ownedTab.addEventListener('click', () => switchTab('owned'));
    favoritesTab.addEventListener('click', () => switchTab('favorites'));
    
    searchInput.addEventListener('input', renderTabContent);
    typeFilter.addEventListener('change', renderTabContent);
    sellableFilter.addEventListener('change', renderTabContent);

    reportContainer.addEventListener('click', (e) => {
        const header = e.target.closest('th[data-sort-key]');
        if (header) {
            sortTable(header.dataset.sortKey);
        }
    });

    refreshButton.addEventListener('click', () => {
        statusEl.textContent = '업데이트 중...';
        refreshButton.disabled = true;
        const action = activeTab === 'owned' ? 'syncPersonalDataAndRefreshOwned' : 'refreshFavoritesMarketData';
        chrome.runtime.sendMessage({ action: action });
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            chrome.runtime.sendMessage({ action: "getSharedData" }, (response) => {
                if (chrome.runtime.lastError || (response && response.error)) {
                    return;
                }
                renderPage(response);
                renderTabContent();
            });
        }
    });

    function init() {
        chrome.runtime.sendMessage({ action: "getSharedData" }, (response) => {
            if (chrome.runtime.lastError || (response && response.error)) {
                statusEl.textContent = '데이터를 불러오는 데 실패했습니다.';
                return;
            }
            renderPage(response);
            switchTab('owned');
            renderTabContent();
        });
    }

    init();
});