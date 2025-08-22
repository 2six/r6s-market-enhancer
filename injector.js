if (!window.r6sInjector) {
    window.r6sInjector = true;
    (() => {
        let patrolInterval;
        let currentPanelId = null;
        let isPanelCreationPending = false;
        let settings = {};
        const MODES = ['none', 'simple', 'default', 'extended'];

        async function init() {
            try {
                const data = await new Promise((resolve) => chrome.storage.local.get(['settings'], resolve));
                if (data.settings) settings = data.settings;
            } catch (e) {}
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local') {
                    if (changes.settings) {
                        const oldSettings = settings;
                        settings = changes.settings.newValue;
                        handleSettingsChange(oldSettings, settings);
                    }
                }
            });
            document.addEventListener('click', handleGlobalClick);
            document.addEventListener('mousedown', handleGlobalMouseDown);
            window.addEventListener('message', onMessageReceived);
            startPatrol();
        }

        function handleSettingsChange(oldSettings, newSettings) {
            const panel = document.getElementById('r6s-enhancer-panel');
            if (panel && (oldSettings.useOverlay !== newSettings.useOverlay || oldSettings.useFavorites !== newSettings.useFavorites)) {
                if (newSettings.useOverlay === false) {
                    panel.remove();
                    currentPanelId = null;
                } else {
                    window.postMessage({ type: 'R6S_GET_ITEM_DATA', payload: { itemId: panel.dataset.itemId } }, '*');
                }
            }
        }

        function onMessageReceived(event) {
            if (event.source !== window || !event.data.type || !event.data.type.startsWith('R6S_')) return;
            const { type, payload } = event.data;

            if (type === 'R6S_NAVIGATE_TO_ITEM') {
                const { itemId, route } = payload;
                if (itemId) {
                    const url = new URL(window.location.href);
                    url.searchParams.set('route', route || 'buy/item-details');
                    url.searchParams.set('itemId', itemId);
                    window.history.pushState({}, '', url.toString());
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
                return;
            }

            if (type === 'R6S_ITEM_DATA_RESPONSE') {
                const itemData = payload;
                if (itemData && !itemData.error) createPanel(itemData);
                isPanelCreationPending = false;
            } else if (type === 'R6S_BROADCAST_UPDATE') {
                const { itemId, isFavorite } = payload;
                const panel = document.getElementById('r6s-enhancer-panel');
                if (panel && panel.dataset.itemId === itemId) {
                    const favBtn = panel.querySelector('#enhancer-favorite-btn');
                    if (favBtn) favBtn.textContent = isFavorite ? '★' : '☆';
                }
            } else if (type === 'R6S_ITEM_DATA_UPDATED') {
                const itemData = payload;
                const panel = document.getElementById('r6s-enhancer-panel');
                if (panel && panel.dataset.itemId === itemData.itemId) {
                    createPanel(itemData);
                }
            }
        }

        function startPatrol() {
            clearInterval(patrolInterval);
            patrolInterval = setInterval(() => {
                const urlParams = new URLSearchParams(window.location.search);
                const targetItemId = urlParams.get('itemId');
                const panel = document.getElementById('r6s-enhancer-panel');
                if (targetItemId) {
                    if (settings.useOverlay === false) {
                        if (panel) panel.remove();
                        currentPanelId = null;
                        return;
                    }
                    if (targetItemId === currentPanelId || isPanelCreationPending) return;
                    if (panel) panel.remove();
                    const buyButton = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('구매하기') || btn.textContent.includes('판매 목록'));
                    if (buyButton) {
                        isPanelCreationPending = true;
                        window.postMessage({ type: 'R6S_GET_ITEM_DATA', payload: { itemId: targetItemId } }, '*');
                    }
                } else {
                    if (panel) {
                        panel.remove();
                        currentPanelId = null;
                    }
                }
            }, 500);
        }
        
        function formatTimeAgo(dateString) {
            if (!dateString) return 'N/A';
            const now = new Date();
            const past = new Date(dateString);
            const seconds = Math.floor((now - past) / 1000);
            let interval = seconds / 31536000;
            if (interval > 1) return Math.floor(interval) + "년 전";
            interval = seconds / 2592000;
            if (interval > 1) return Math.floor(interval) + "달 전";
            interval = seconds / 86400;
            if (interval > 1) return Math.floor(interval) + "일 전";
            interval = seconds / 3600;
            if (interval > 1) return Math.floor(interval) + "시간 전";
            interval = seconds / 60;
            if (interval > 1) return Math.floor(interval) + "분 전";
            return "방금 전";
        }

        function createPanel(itemData) {
            const oldPanel = document.getElementById('r6s-enhancer-panel');
            if (oldPanel) oldPanel.remove();
            const currentMode = sessionStorage.getItem('r6s_overlayMode') || settings.overlayMode || 'default';
            injectStyles();
            const panel = document.createElement('div');
            panel.id = 'r6s-enhancer-panel';
            panel.dataset.itemId = itemData.itemId;
            let favoriteButtonHtml = '';
            if(settings.useFavorites !== false) {
                favoriteButtonHtml = `<span class="enhancer-favorite-btn" id="enhancer-favorite-btn">${itemData.isFavorite ? '★' : '☆'}</span>`;
            }
            const currentIndex = MODES.indexOf(currentMode);
            const isMinusDisabled = currentIndex <= 0;
            const isPlusDisabled = currentIndex >= MODES.length - 1;
            const headerHtml = `<div class="enhancer-header" id="enhancer-header">${favoriteButtonHtml}<h3 title="${itemData.name}">${itemData.name || '...'}</h3><div class="enhancer-controls"><span class="enhancer-btn" id="enhancer-refresh-btn">⟳</span><span class="enhancer-btn" id="enhancer-minus-btn" ${isMinusDisabled ? 'disabled' : ''}>-</span><span class="enhancer-btn" id="enhancer-plus-btn" ${isPlusDisabled ? 'disabled' : ''}>+</span></div></div>`;
            let contentHtml = '';
            
            const TRANSACTION_FEE = 0.10;
            const _calculateProfit = (sellPrice, buyPrice) => { if (sellPrice == null || buyPrice == null) return null; const netProfit = (sellPrice * (1 - TRANSACTION_FEE)) - buyPrice; return buyPrice > 0 ? +((netProfit / buyPrice) * 100).toFixed(1) : 0; };
            const _calculateUndervalue = (avgPrice, currentSell) => { if (avgPrice == null || currentSell == null || avgPrice === 0) return null; return +(((avgPrice - currentSell) / avgPrice) * 100).toFixed(1); };
            const _calculateNetProfit = (sellPrice, buyPrice) => { if(sellPrice == null || buyPrice == null) return null; return Math.round((sellPrice * (1-TRANSACTION_FEE)) - buyPrice); };

            let simpleContent = `
                ${createRow('나의 구매가', formatPrice(itemData.myBuyPrice), 'price-my')}
                ${createRow('나의 판매가', formatPrice(itemData.mySellPrice), 'price-sell')}
                ${createRow('현재 최고 구매가', formatPrice(itemData.currentHighestBuyPrice), 'price-buy')}
                ${createRow('마지막 거래 시간', formatTimeAgo(itemData.lastSoldTime))}
            `;
            
            const profit_7d = _calculateProfit(itemData.avgPrice_7d, itemData.myBuyPrice);
            const profit_14d = _calculateProfit(itemData.avgPrice_14d, itemData.myBuyPrice);
            const undervalue_7d = _calculateUndervalue(itemData.avgPrice_7d, itemData.currentLowestSellPrice);
            const undervalue_14d = _calculateUndervalue(itemData.avgPrice_14d, itemData.currentLowestSellPrice);
            let lastRowHtml = '';
            if (itemData.myBuyPrice) { lastRowHtml = `<tr><td>수익률</td><td class="${getColorClass(profit_7d)}">${formatRatio(profit_7d)}</td><td class="${getColorClass(profit_14d)}">${formatRatio(profit_14d)}</td></tr>`; }
            else { lastRowHtml = `<tr><td>저평가</td><td class="${getColorClass(undervalue_7d)}">${formatRatio(undervalue_7d)}</td><td class="${getColorClass(undervalue_14d)}">${formatRatio(undervalue_14d)}</td></tr>`; }

            const netProfit_7d = _calculateNetProfit(itemData.avgPrice_7d, itemData.myBuyPrice);
            const netProfit_14d = _calculateNetProfit(itemData.avgPrice_14d, itemData.myBuyPrice);
            
            let extendedRowsHtml = '';
            if (itemData.myBuyPrice) {
                extendedRowsHtml += `
                    <tr><td>예상 순수익</td><td class="${getColorClass(netProfit_7d)}">${formatPrice(netProfit_7d)}</td><td class="${getColorClass(netProfit_14d)}">${formatPrice(netProfit_14d)}</td></tr>
                `;
            }
            extendedRowsHtml += `
                <tr><td>실제 가격 범위</td><td>${formatPrice(itemData.actualLowest_7d)}~${formatPrice(itemData.actualHighest_7d)}</td><td>${formatPrice(itemData.actualLowest_14d)}~${formatPrice(itemData.actualHighest_14d)}</td></tr>
            `;

            let defaultContentTable = `
                <table class="enhancer-table">
                    <thead><tr><th></th><th>7일</th><th>14일</th></tr></thead>
                    <tbody>
                        <tr><td>평균가</td><td>${formatPrice(itemData.avgPrice_7d)}</td><td>${formatPrice(itemData.avgPrice_14d)}</td></tr>
                        <tr><td>최고가 평균</td><td>${formatPrice(itemData.avgHighestPrice_7d)}</td><td>${formatPrice(itemData.avgHighestPrice_14d)}</td></tr>
                        <tr><td>최저가 평균</td><td>${formatPrice(itemData.avgLowestPrice_7d)}</td><td>${formatPrice(itemData.avgLowestPrice_14d)}</td></tr>
                        <tr><td>평균 거래량</td><td>${formatPrice(itemData.avgItemsCount_7d)}</td><td>${formatPrice(itemData.avgItemsCount_14d)}</td></tr>
                        ${currentMode === 'extended' ? lastRowHtml + extendedRowsHtml : ''}
                    </tbody>
                </table>
            `;

            let defaultContent = `
                ${createRow('나의 구매가', formatPrice(itemData.myBuyPrice), 'price-my')}
                ${createRow('나의 판매가', formatPrice(itemData.mySellPrice), 'price-sell')}
                ${createRow('현재 최고 구매가', formatPrice(itemData.currentHighestBuyPrice), 'price-buy')}
                ${createRow('마지막 거래 시간', formatTimeAgo(itemData.lastSoldTime))}
                ${createRow('스프레드', formatPrice(itemData.spread))}
                <hr>
                ${defaultContentTable}
            `;

            if (currentMode !== 'none') {
                let modeContent = '';
                switch(currentMode) {
                    case 'simple': modeContent = simpleContent; break;
                    case 'default':
                    case 'extended': 
                        modeContent = defaultContent;
                        break;
                }
                contentHtml = `<div class="enhancer-content" id="enhancer-content">${modeContent}</div>`;
            }

            panel.innerHTML = headerHtml + contentHtml;
            document.body.appendChild(panel);
            currentPanelId = itemData.itemId;
        }

        function handleGlobalClick(e) {
            const panel = e.target.closest('#r6s-enhancer-panel');
            if (!panel) return;
            const targetId = e.target.id;
            const itemId = panel.dataset.itemId;

            if (targetId === 'enhancer-favorite-btn') {
                if (settings.useFavorites !== false) {
                    window.postMessage({ type: 'R6S_TOGGLE_FAVORITE', payload: { itemId: itemId } }, '*');
                }
            } else if (targetId === 'enhancer-minus-btn' || targetId === 'enhancer-plus-btn') {
                if (e.target.hasAttribute('disabled')) return;
                const currentMode = sessionStorage.getItem('r6s_overlayMode') || settings.overlayMode || 'default';
                let currentIndex = MODES.indexOf(currentMode);
                const direction = targetId === 'enhancer-plus-btn' ? 1 : -1;
                let nextIndex = currentIndex + direction;
                nextIndex = Math.max(0, Math.min(nextIndex, MODES.length - 1));
                const newMode = MODES[nextIndex];
                sessionStorage.setItem('r6s_overlayMode', newMode);
                window.postMessage({ type: 'R6S_GET_ITEM_DATA', payload: { itemId: itemId } }, '*');
            } else if (targetId === 'enhancer-refresh-btn') {
                window.postMessage({ type: 'R6S_GET_ITEM_DATA', payload: { itemId: itemId } }, '*');
            }
        }
        function handleGlobalMouseDown(e) { const header = e.target.closest('#enhancer-header'); if (!header || e.target.closest('.enhancer-controls') || e.target.closest('.enhancer-favorite-btn')) return; const panel = header.parentElement; e.preventDefault(); let pos1 = 0, pos2 = 0, pos3 = e.clientX, pos4 = e.clientY; document.onmousemove = (e) => { e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY; panel.style.top = (panel.offsetTop - pos2) + "px"; panel.style.left = (panel.offsetLeft - pos1) + "px"; }; document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; }; }
        function createRow(label, value, valueClass = '') { if (value === null || value === undefined || (typeof value === 'string' && value.includes('N/A'))) return ''; return `<div class="info-row"><span class="info-label">${label}:</span><span class="info-value ${valueClass}">${value}</span></div>`; }
        function formatPrice(value) { return value !== null && value !== undefined ? Math.round(value).toString() : 'N/A'; }
        function formatRatio(value) { return value !== null && value !== undefined ? `${value.toFixed(1)}%` : 'N.A'; }
        function getColorClass(value) { if (value === null || value === undefined) return ''; return value > 0 ? 'positive' : (value < 0 ? 'negative' : ''); }
        function injectStyles() { if (document.getElementById('r6s-enhancer-styles')) return; const style = document.createElement('style'); style.id = 'r6s-enhancer-styles'; style.textContent = ` #r6s-enhancer-panel { position: fixed; top: 250px; right: 20px; width: 280px; background-color: #1a1a1a; border: 1px solid #555; border-radius: 8px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: #e0e0e0; font-family: "Ubisoft Sans", sans-serif; } .enhancer-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background-color: #2c2c2c; cursor: move; border-bottom: 1px solid #444; border-radius: 7px 7px 0 0;} .enhancer-header h3 { margin: 0; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; text-align: center; } .enhancer-favorite-btn { font-size: 20px; cursor: pointer; user-select: none; padding-right: 10px; min-width: 28px; text-align: center; } .enhancer-controls { display: flex; gap: 8px; } .enhancer-btn { font-size: 20px; color: #999; cursor: pointer; line-height: 1; user-select: none; font-weight: bold; } .enhancer-btn:hover { color: #fff; } .enhancer-btn[disabled] { color: #555; cursor: default; } .enhancer-content { padding: 15px; } .enhancer-content hr { border: none; border-top: 1px solid #333; margin: 10px 0; } .info-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; margin-bottom: 8px; } .info-label { color: #bbb; } .info-value { font-weight: bold; font-size: 16px; } .enhancer-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; } .enhancer-table th, .enhancer-table td { text-align: right; padding: 4px 2px; } .enhancer-table th { color: #fff; border-bottom: 1px solid #444; } .enhancer-table td:first-child { text-align: left; color: #bbb; font-weight: normal; } .positive { color: #4caf50; } .negative { color: #f44336; } .price-buy { color: #4caf50; } .price-my { color: #ff9800; } .price-sell { color: #03a9f4; } .extended-section { margin-top: 5px; } .enhancer-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); z-index: 10001; display: flex; justify-content: center; align-items: center; } .enhancer-modal-content { background-color: #2c2c2c; padding: 20px; border-radius: 8px; border: 1px solid #555; width: 320px; box-shadow: 0 5px 15px rgba(0,0,0,0.5); } .enhancer-modal-content h3 { margin-top: 0; text-align: center; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .enhancer-modal-row { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; } .enhancer-modal-row label { flex-basis: 80px; } .enhancer-modal-row select, .enhancer-modal-row input { flex-grow: 1; padding: 5px; background-color: #1a1a1a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; } .enhancer-modal-buttons { display: flex; justify-content: space-between; margin-top: 20px; } .enhancer-modal-buttons button { padding: 8px 16px; border-radius: 5px; border: none; cursor: pointer; font-weight: bold; } #enhancer-alert-save { background-color: #007bff; color: white; } #enhancer-alert-delete { background-color: #dc3545; color: white; } #enhancer-alert-cancel { background-color: #6c757d; color: white; } `; document.head.appendChild(style); }
        
        init();
        return true;
    })();
}