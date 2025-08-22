(async () => {
    const data = await chrome.storage.local.get(['isUpdating', 'isDashboardUpdating', 'settings']);
    if (data.isUpdating || data.isDashboardUpdating) {
        await chrome.storage.local.set({ isUpdating: false, isDashboardUpdating: false });
    }
    if (data.settings) {
        await updateAlarm(data.settings);
    }
})();

const GQL_TEMPLATES = {
  GetSellableItems: { 
    operationName:"GetSellableItems", 
    variables: { 
      spaceId: "0d2ae42d-4c27-4cb7-af6c-2099062302bb", 
      limit: 50, 
      offset: 0, 
      filterBy: {}, 
      sortBy: { field: "LAST_TRANSACTION_PRICE", direction: "DESC", paymentItemId: "9ef71262-515b-46e8-b9a8-b6b6ad456c67" }
    }, 
    query: "query GetSellableItems($spaceId: String!, $limit: Int!, $offset: Int, $filterBy: MarketableItemFilter, $sortBy: MarketableItemSort) {\n  game(spaceId: $spaceId) {\n    id\n    viewer {\n      meta {\n        id\n        marketableItems(limit: $limit, offset: $offset, filterBy: $filterBy, sortBy: $sortBy, withMarketData: true) {\n          nodes {\n            ...MarketableItemFragment\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment MarketableItemFragment on MarketableItem {\n  id\n  item {\n    ...SecondaryStoreItemFragment\n    __typename\n  }\n  marketData {\n    ...MarketDataFragment\n    __typename\n  }\n}\n\nfragment SecondaryStoreItemFragment on SecondaryStoreItem {\n  id\n  assetUrl\n  itemId\n  name\n}\n\nfragment MarketDataFragment on MarketableItemMarketData {\n  id\n  sellStats {\n    lowestPrice\n    __typename\n  }\n  buyStats {\n    highestPrice\n    __typename\n  }\n  lastSoldAt { price performedAt __typename }\n}"
  },
  GetTransactionsHistory: { operationName: "GetTransactionsHistory", variables: { spaceId: "0d2ae42d-4c27-4cb7-af6c-2099062302bb", offset: 0, limit: 100 }, query: "query GetTransactionsHistory($spaceId: String!, $limit: Int!, $offset: Int) { game(spaceId: $spaceId) { id viewer { meta { id trades( limit: $limit, offset: $offset, filterBy: {states: [Succeeded, Failed]}, sortBy: {field: LAST_MODIFIED_AT} ) { nodes { ...TradeFragment __typename } __typename } __typename } __typename } __typename } } fragment TradeFragment on Trade { id state category lastModifiedAt tradeItems { item { itemId name assetUrl __typename } __typename } payment { price __typename } __typename }", },
  GetItemPriceHistory: { operationName: "GetItemPriceHistory", variables: { spaceId: "0d2ae42d-4c27-4cb7-af6c-2099062302bb", itemId: "{item_id}", paymentItemId: "9ef71262-515b-46e8-b9a8-b6b6ad456c67" }, query: "query GetItemPriceHistory($spaceId: String!, $itemId: String!, $paymentItemId: String!) { game(spaceId: $spaceId) { id marketableItem(itemId: $itemId) { id priceHistory(paymentItemId: $paymentItemId) { id date lowestPrice averagePrice highestPrice itemsCount __typename } __typename } __typename } }", },
  GetItemDetails: { operationName: "GetItemDetails", variables: { spaceId: "0d2ae42d-4c27-4cb7-af6c-2099062302bb", itemId: "{item_id}" }, query: "query GetItemDetails($spaceId: String!, $itemId: String!) { game(spaceId: $spaceId) { id marketableItem(itemId: $itemId) { id item { ...SecondaryStoreItemFragment __typename } marketData { ...MarketDataFragment __typename } __typename } __typename } } fragment SecondaryStoreItemFragment on SecondaryStoreItem { id assetUrl itemId name type tags __typename } fragment MarketDataFragment on MarketableItemMarketData { id sellStats { lowestPrice activeCount __typename } buyStats { highestPrice activeCount __typename } lastSoldAt { price performedAt __typename } __typename }", }
};
const API_URL = "https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql";
const storage = { get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)), set: (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve)), };

async function updateAlarm(settings) {
    await chrome.alarms.clear('priceAlertChecker');
    if (settings && settings.usePriceAlerts) {
        const interval = parseInt(settings.alertInterval, 10) || 5;
        chrome.alarms.create('priceAlertChecker', { periodInMinutes: interval });
    }
}

chrome.runtime.onInstalled.addListener(async (details) => {
    const { settings } = await storage.get('settings');
    const defaultSettings = {
        useOverlay: true,
        overlayMode: "default",
        useFavorites: true,
        showFavoritesTab: true,
        showOwnedTab: true,
        popupMode: "extended",
        popupLinkAction: "navigate",
        usePriceAlerts: false,
        alertInterval: 5,
        sort: { sortBy: 'undervalueRatio_7d_calculated', sortDir: 'desc' }
    };
    
    const newSettings = { ...defaultSettings, ...(settings || {}) };

    if (details.reason === "install") {
        await storage.set({ settings: newSettings, priceAlerts: {}, marketData: {}, personalData: {} });
    } else if (details.reason === "update") {
        await storage.set({ settings: newSettings });
    }
    await updateAlarm(newSettings);
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'priceAlertChecker') {
        checkPriceAlerts();
    }
});

async function checkPriceAlerts() {
    const data = await storage.get(['settings', 'priceAlerts', 'requestHeaders']);
    if (!data.settings || !data.settings.usePriceAlerts || !data.priceAlerts || !data.requestHeaders) {
        return;
    }

    const alerts = data.priceAlerts;
    const itemIds = Object.keys(alerts);
    if (itemIds.length === 0) return;

    try {
        const detailsPayloads = itemIds.map(id => { const p = JSON.parse(JSON.stringify(GQL_TEMPLATES.GetItemDetails)); p.variables.itemId = id; return p; });
        const detailsResults = await makeApiCall(detailsPayloads, data.requestHeaders);

        let triggeredAlerts = [];
        let remainingAlerts = { ...alerts };

        itemIds.forEach((id, index) => {
            const itemDetails = detailsResults[index]?.data?.game?.marketableItem;
            if (!itemDetails) return;

            const alert = alerts[id];
            const currentSell = itemDetails.marketData.sellStats?.[0]?.lowestPrice;
            const currentBuy = itemDetails.marketData.buyStats?.[0]?.highestPrice;

            let conditionMet = false;
            let currentPrice = null;
            if (alert.type === 'sell' && currentSell !== null) {
                currentPrice = currentSell;
                if (alert.condition === 'below' && currentSell <= alert.price) conditionMet = true;
                if (alert.condition === 'above' && currentSell >= alert.price) conditionMet = true;
            } else if (alert.type === 'buy' && currentBuy !== null) {
                currentPrice = currentBuy;
                if (alert.condition === 'below' && currentBuy <= alert.price) conditionMet = true;
                if (alert.condition === 'above' && currentBuy >= alert.price) conditionMet = true;
            }

            if (conditionMet) {
                triggeredAlerts.push({ name: itemDetails.item.name, currentPrice, ...alert });
                delete remainingAlerts[id];
            }
        });

        if (triggeredAlerts.length > 0) {
            triggeredAlerts.forEach(alert => {
                const typeText = alert.type === 'sell' ? '최저 판매가' : '최고 구매가';
                const condText = alert.condition === 'below' ? '이하' : '이상';
                chrome.notifications.create(`price-alert-${alert.itemId}`, {
                    type: 'basic',
                    iconUrl: 'images/icon128.png',
                    title: 'R6S Market 가격 알림',
                    message: `${alert.name}의 ${typeText}가 ${alert.price} ${condText}에 도달했습니다! (현재가: ${alert.currentPrice})`
                });
            });
            await storage.set({ priceAlerts: remainingAlerts });
        }
    } catch(e) {}
}

chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.url.includes("graphql") && details.method === "POST") {
            const requiredHeaders = new Set([
                'authorization',
                'ubi-appid',
                'ubi-sessionid',
                'content-type',
                'ubi-localecode'
            ]);

            const filteredHeaders = details.requestHeaders.filter(header => 
                requiredHeaders.has(header.name.toLowerCase())
            );
            
            storage.set({ requestHeaders: filteredHeaders });
        }
    },
    { urls: ["*://*.ubi.com/*", "*://*.ubisoft.com/*"] },
    ["requestHeaders"]
);

async function syncRecentTransactions() {
    const { requestHeaders, lastTransactionTimestamp, personalData = {} } = await storage.get(['requestHeaders', 'lastTransactionTimestamp', 'personalData']);
    if (!requestHeaders) return [];

    let newTrades = [];
    let offset = 0;
    let limit = 100;
    let keepFetching = true;
    let latestTimestamp = lastTransactionTimestamp || null;

    while (keepFetching) {
        const payload = JSON.parse(JSON.stringify(GQL_TEMPLATES.GetTransactionsHistory));
        payload.variables.offset = offset;
        payload.variables.limit = limit;

        const res = await makeApiCall(payload, requestHeaders);
        const trades = res[0]?.data?.game?.viewer?.meta?.trades?.nodes;

        if (!trades || trades.length === 0) {
            keepFetching = false;
            break;
        }

        if (offset === 0 && trades.length > 0) {
            const currentLatestTimestamp = new Date(trades[0].lastModifiedAt).getTime();
            if(!latestTimestamp || currentLatestTimestamp > latestTimestamp) {
                latestTimestamp = currentLatestTimestamp;
            }
        }

        for (const trade of trades) {
            if (lastTransactionTimestamp && new Date(trade.lastModifiedAt).getTime() <= lastTransactionTimestamp) {
                keepFetching = false;
                break;
            }
            newTrades.push(trade);
        }

        if (trades.length < limit) {
            keepFetching = false;
        }
        offset += limit;
    }

    if (newTrades.length > 0) {
        newTrades.sort((a, b) => new Date(a.lastModifiedAt) - new Date(b.lastModifiedAt));
        let changedItemIds = new Set();

        for (const trade of newTrades) {
            if (trade.state !== "Succeeded") continue;
            const itemInfo = trade.tradeItems?.[0]?.item;
            if (!itemInfo?.itemId) continue;
            const itemId = itemInfo.itemId;
            
            if (!personalData[itemId]) {
                personalData[itemId] = {};
            }

            if (trade.category === "Buy") {
                personalData[itemId].myBuyPrice = trade.payment?.price;
                personalData[itemId].buyDate = trade.lastModifiedAt;
                personalData[itemId].mySellPrice = null;
                personalData[itemId].sellDate = null;
            } else if (trade.category === "Sell") {
                personalData[itemId].mySellPrice = Math.round(trade.payment?.price * 0.9);
                personalData[itemId].sellDate = trade.lastModifiedAt;
                personalData[itemId].myBuyPrice = null;
                personalData[itemId].buyDate = null;
            }
            changedItemIds.add(itemId);
        }
        await storage.set({ personalData: personalData, lastTransactionTimestamp: latestTimestamp });
        return Array.from(changedItemIds);
    }
    return [];
}

async function refreshFavoritesMarketData() {
    await storage.set({ isUpdating: true });
    try {
        const { requestHeaders, favoriteIds = [], marketData = {} } = await storage.get(['requestHeaders', 'favoriteIds', 'marketData']);
        if (!requestHeaders) throw new Error("인증 헤더 없음.");

        if (favoriteIds.length > 0) {
            const marketDataMap = await fetchAssetsMarketData(favoriteIds, requestHeaders);
            for (const itemId in marketDataMap) {
                marketData[itemId] = { ...(marketData[itemId] || {}), ...analyzeSingleItem(marketDataMap[itemId]) };
            }
            await storage.set({ marketData: marketData, lastUpdate: Date.now() });
        } else {
             await storage.set({ lastUpdate: Date.now() });
        }
    } finally {
        await storage.set({ isUpdating: false });
    }
}

async function syncPersonalDataAndRefreshOwned() {
    await storage.set({ isDashboardUpdating: true });
    try {
        const changedItemIds = await syncRecentTransactions();
        
        const { requestHeaders, favoriteIds = [], marketData = {}, personalData = {} } = await storage.get(['requestHeaders', 'favoriteIds', 'marketData', 'personalData']);
        if (!requestHeaders) throw new Error("인증 헤더 없음.");
        
        const sellableItems = await getSellableItems(requestHeaders);
        const sellableItemIds = sellableItems.map(item => item.item.itemId);

        const itemIdsToUpdateMarketData = [...new Set([...sellableItemIds, ...changedItemIds])];
        const newOrMissingIds = itemIdsToUpdateMarketData.filter(id => !marketData[id]);

        if (newOrMissingIds.length > 0) {
            const marketDataMap = await fetchAssetsMarketData(newOrMissingIds, requestHeaders);
            for (const itemId in marketDataMap) {
                marketData[itemId] = { ...(marketData[itemId] || {}), ...analyzeSingleItem(marketDataMap[itemId]) };
            }
        }
        
        const ownedItems = sellableItems.map(item => {
            const itemId = item.item.itemId;
            const marketInfo = marketData[itemId] || {};
            const personalInfo = personalData[itemId] || {};
            return {
                ...marketInfo, 
                ...item.item, 
                ...personalInfo,
                isFavorite: favoriteIds.includes(itemId),
                netProfit_current: _calculateNetProfit(marketInfo.currentLowestSellPrice, personalInfo.myBuyPrice),
                profitRatio_current: _calculateProfit(marketInfo.currentLowestSellPrice, personalInfo.myBuyPrice),
                netProfit_7d: _calculateNetProfit(marketInfo.avgPrice_7d, personalInfo.myBuyPrice),
                profitRatio_7d: _calculateProfit(marketInfo.avgPrice_7d, personalInfo.myBuyPrice),
                netProfit_14d: _calculateNetProfit(marketInfo.avgPrice_14d, personalInfo.myBuyPrice),
                profitRatio_14d: _calculateProfit(marketInfo.avgPrice_14d, personalInfo.myBuyPrice),
            };
        });

        await storage.set({ 
            ownedItems: ownedItems, 
            marketData: marketData,
            lastDashboardUpdate: Date.now() 
        });

    } finally {
        await storage.set({ isDashboardUpdating: false });
    }
}

async function makeApiCall(payload, originalHeaders) {
    const headers = {};
    originalHeaders.forEach(h => { if (!h.name.toLowerCase().startsWith('sec-') && !h.name.toLowerCase().startsWith('dnt')) headers[h.name] = h.value; });
    const bodyPayload = Array.isArray(payload) ? payload : [payload];
    const MAX_RETRIES = 5;
    let defaultRetryDelay = 5000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(API_URL, { method: 'POST', headers: headers, body: JSON.stringify(bodyPayload) });
            if (!response.ok) {
                const errorBodyText = await response.text();
                const error = new Error(`Server responded with ${response.status}: ${errorBodyText}`);
                error.responseText = errorBodyText;
                throw error;
            }
            const responseData = await response.json();
            if (!Array.isArray(responseData) || responseData.length !== bodyPayload.length) throw new Error(`Response format mismatch`);
            for (let i = 0; i < responseData.length; i++) {
                const result = responseData[i];
                if (!result || !result.data || (result.data.game === null && result.errors)) {
                    const errorMessage = result.errors?.[0]?.message || `Invalid data in response at index ${i}`;
                    const error = new Error(errorMessage);
                    error.responseText = JSON.stringify(result);
                    throw error;
                }
            }
            return responseData;
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                let retryAfter = defaultRetryDelay;
                try {
                    const errorJson = JSON.parse(error.responseText);
                    const rateLimitMessage = errorJson?.errors?.[0]?.message;
                    if (rateLimitMessage && rateLimitMessage.includes('Too many requests')) {
                        const match = rateLimitMessage.match(/try again in (\d+) seconds/);
                        if (match && match[1]) {
                            retryAfter = parseInt(match[1], 10) * 1000 + 500;
                        }
                    }
                } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, retryAfter));
            } else {
                throw error;
            }
        }
    }
}

async function fetchAssetsMarketData(itemIds, headers) {
    const marketDataMap = {};
    const batchSize = 10;
    const API_CALL_DELAY = 2000;
    for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        try {
            const historyPayloads = batch.map(id => { const p = JSON.parse(JSON.stringify(GQL_TEMPLATES.GetItemPriceHistory)); p.variables.itemId = id; return p; });
            const historyResults = await makeApiCall(historyPayloads, headers);
            const tempHistory = {};
            batch.forEach((id, index) => {
                const historyItem = historyResults[index]?.data?.game?.marketableItem;
                if (historyItem) tempHistory[id] = { priceHistory: historyItem.priceHistory || [] };
            });
            await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY));
            const detailsPayloads = batch.map(id => { const p = JSON.parse(JSON.stringify(GQL_TEMPLATES.GetItemDetails)); p.variables.itemId = id; return p; });
            const detailsResults = await makeApiCall(detailsPayloads, headers);
            batch.forEach((id, index) => {
                const detailsItem = detailsResults[index]?.data?.game?.marketableItem;
                if (detailsItem && tempHistory[id]) {
                    marketDataMap[id] = { ...tempHistory[id], marketData: detailsItem.marketData || {}, item: detailsItem.item || {} };
                }
            });
        } catch (error) { }
        if (i + batchSize < itemIds.length) { await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY)); }
    }
    return marketDataMap;
}

function analyzeSingleItem(marketInfo) {
    const { priceHistory, marketData, item } = marketInfo;
    const current_sell = marketData.sellStats?.[0]?.lowestPrice ?? null;
    const current_buy = marketData.buyStats?.[0]?.highestPrice ?? null;
    const lastSoldTime = marketData.lastSoldAt?.[0]?.performedAt ?? null;
    const today = new Date();
    const calcAvg = (data, key) => { const values = data.map(p => p[key]).filter(v => v != null); return values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null; };
    const prices7d = priceHistory.filter(h => h.date && (today - new Date(h.date)) / (1000 * 60 * 60 * 24) < 7);
    const prices14d = priceHistory.filter(h => h.date && (today - new Date(h.date)) / (1000 * 60 * 60 * 24) < 14);
    const getActualRange = (data, lowKey, highKey) => {
        if (data.length === 0) return { min: null, max: null };
        const lowestPrices = data.map(p => p[lowKey]).filter(v => v != null);
        const highestPrices = data.map(p => p[highKey]).filter(v => v != null);
        return { min: lowestPrices.length > 0 ? Math.min(...lowestPrices) : null, max: highestPrices.length > 0 ? Math.max(...highestPrices) : null, };
    };
    const range7d = getActualRange(prices7d, 'lowestPrice', 'highestPrice');
    const range14d = getActualRange(prices14d, 'lowestPrice', 'highestPrice');

    const typeMap = { "WeaponSkin": "무기 스킨", "WeaponAttachmentSkinSet": "부속품 스킨", "DroneSkin": "드론 스킨", "CharacterHeadgear": "머리보호구", "CharacterUniform": "전투복", "OperatorCardPortrait": "대원 초상화", "OperatorCardBackground": "카드 뒷면", "Charm": "부적", "GadgetSkin": "도구 스킨" };
    const rarityMap = { "common": "일반", "uncommon": "고급", "rare": "희귀", "epic": "영웅", "superrare": "에픽", "legendary": "전설" };
    
    const WEAPON_RAW = ['.44 Mag Semi-Auto', '5.7 USG', '6P41', '9mm C1', '9x19VSN', '416-C CARBINE', '417', '552 COMMANDO', '556XI', '1911 TACOPS', 'ACS12', 'AK-12', 'AK-74M', 'ALDA 556', 'AR-1550', 'AR33', 'ARX200', 'AUG A2', 'AUG A3', 'Bailiff 410', 'BEARING 9', 'BOSG122', 'C7E', 'C8-SFW', 'C75 Auto', 'CAMRS', 'COMMANDO 9', 'CSRX 300', 'D-50', 'DP27', 'F2', 'F90', 'FMG-9', 'FO-12', 'G8A1', 'G36C', 'GONNE-6', 'GSH-18', 'ITA12L', 'ITA12S', 'K1A', 'KERATOS .357', 'L85A2', 'LFP586', 'LMG-E', 'M4', 'M12', 'M45 MEUSOC', 'M249', 'M249 SAW', 'M590A1', 'M762', 'M870', 'M1014', 'Mk 14 EBR', 'MK1 9mm', 'MK17 CQB', 'MP5', 'MP5K', 'MP5SD', 'MP7', 'MPX', 'Mx4 Storm', 'OTs-03', 'P-10C', 'P9', 'P10 RONI', 'P12', 'P90', 'P226 MK 25', 'P229', 'PARA-308', 'PDW9', 'PMM', 'POF-9', 'PRB92', 'Q-929', 'R4-C', 'RG15', 'SASG-12', 'SC3000K', 'SCORPION EVO 3 A1', 'SDP 9mm', 'SG-CQB', 'SIX12', 'SIX12 SD', 'SMG-11', 'SMG-12', 'SPAS-12', 'SPAS-15', 'SPEAR .308', 'SPSMG9', 'SR-25', 'SUPER 90', 'SUPER SHORTY', 'SUPERNOVA', 'T-5 SMG', 'T-95 LSW', 'TCSG12', 'TYPE-89', 'UMP45', 'USP40', 'UZK50GI', 'V308', 'VECTOR .45 ACP', 'FlashShield', 'TankShield'];
    const normalizeTagForLookup = (t) => t.toUpperCase().replace(/\s/g, '_').replace(/\./g, '');
    const WEAPON_SET = new Set(WEAPON_RAW.map(normalizeTagForLookup));
    const SUB_TAG_CANDIDATES = new Set(['Animated', '3DSkin', 'Texture', 'Color', 'Pattern']);
    const SUB_TAG_TRANSLATIONS = { 'Animated': '동적', '3DSkin': '3D 스킨', 'Texture': '텍스처', 'Color': '색상', 'Pattern': '패턴' };

    let itemType = item?.type ? (typeMap[item.type] || item.type) : null;
    let primaryTag = null;
    let subTag = null;
    let rarity = null;
    let season = null;

    if (item?.tags && Array.isArray(item.tags)) {
        let foundWeaponTag = null, foundCharTag = null, foundSubTag = null;
        let isUniversal = false, isSeasonal = false, isEsport = false;
        for (const tag of item.tags) {
            const normalized = normalizeTagForLookup(tag);
            if (WEAPON_SET.has(normalized)) foundWeaponTag = tag;
            if (tag.startsWith('Character')) foundCharTag = tag.split('.').pop();
            if (SUB_TAG_CANDIDATES.has(tag)) foundSubTag = SUB_TAG_TRANSLATIONS[tag] || tag;
            if (tag === 'Universal') isUniversal = true;
            if (tag === 'Seasonal') isSeasonal = true;
            if (tag === 'esport') isEsport = true;
        }
        const itemCat = item.type;
        if (itemCat === 'Charm') {
            primaryTag = null; subTag = null;
        } else if (['WeaponSkin', 'WeaponAttachmentSkinSet', 'GadgetSkin', 'DroneSkin'].includes(itemCat)) {
            primaryTag = foundWeaponTag || (isUniversal ? '공용' : (isSeasonal ? '시즌' : null));
            subTag = isEsport ? 'e스포츠' : foundSubTag;
        } else if (['CharacterHeadgear', 'CharacterUniform', 'OperatorCardPortrait'].includes(itemCat)) {
            primaryTag = foundCharTag;
            subTag = isEsport ? 'e스포츠' : (foundSubTag || null);
        }
        if (primaryTag) primaryTag = primaryTag.replace(/_/g, ' ');
        for (const tag of item.tags) {
            if (tag.startsWith('rarity_')) rarity = rarityMap[tag.replace('rarity_', '')] || tag.replace('rarity_', '');
            const seasonMatch = tag.match(/^Y(\d)S(\d)/);
            if (seasonMatch) season = `Y${seasonMatch[1]}S${seasonMatch[2]}`;
        }
    }
    return {
        itemId: item?.itemId, name: item?.name, assetUrl: item?.assetUrl,
        itemType: itemType, primaryTag: primaryTag, subTag: subTag, rarity: rarity, season: season,
        lastSoldTime: lastSoldTime,
        actualLowest_7d: range7d.min, actualHighest_7d: range7d.max,
        actualLowest_14d: range14d.min, actualHighest_14d: range14d.max,
        avgLowestPrice_7d: calcAvg(prices7d, 'lowestPrice'), avgLowestPrice_14d: calcAvg(prices14d, 'lowestPrice'),
        currentLowestSellPrice: current_sell, currentHighestBuyPrice: current_buy,
        spread: (current_sell != null && current_buy != null) ? current_sell - current_buy : null,
        avgPrice_7d: calcAvg(prices7d, 'averagePrice'), avgPrice_14d: calcAvg(prices14d, 'averagePrice'),
        avgHighestPrice_7d: calcAvg(prices7d, 'highestPrice'), avgHighestPrice_14d: calcAvg(prices14d, 'highestPrice'),
        avgItemsCount_7d: calcAvg(prices7d, 'itemsCount'), avgItemsCount_14d: calcAvg(prices14d, 'itemsCount'),
    };
}

async function handleFetchSingleItem(itemId) {
    if (!itemId) return { error: "Item ID was not provided." };
    try {
        const { requestHeaders } = await storage.get(['requestHeaders']);
        if (!requestHeaders) throw new Error("인증 헤더 없음.");
        const marketDataMap = await fetchAssetsMarketData([itemId], requestHeaders);
        if (!marketDataMap[itemId]) throw new Error("API로부터 아이템 정보를 가져오지 못했습니다.");
        return analyzeSingleItem(marketDataMap[itemId]);
    } catch (error) { return { error: error.message }; }
}

async function getSellableItems(headers) {
    let allItems = [];
    const ITEM_LIMIT = 100;
    const BATCH_SIZE = 50;
    let offset = 0;
    while (allItems.length < ITEM_LIMIT) {
        const query = JSON.parse(JSON.stringify(GQL_TEMPLATES.GetSellableItems));
        query.variables.offset = offset;
        query.variables.limit = BATCH_SIZE;
        try {
            const res = await makeApiCall(query, headers);
            const items = res[0]?.data?.game?.viewer?.meta?.marketableItems?.nodes;
            if (!items || items.length === 0) break;
            allItems.push(...items);
            if (items.length < BATCH_SIZE) break;
            offset += BATCH_SIZE;
        } catch (error) {
            break; 
        }
    }
    return allItems.slice(0, ITEM_LIMIT);
}

const TRANSACTION_FEE = 0.10;
const _calculateProfit = (sellPrice, buyPrice) => { if (sellPrice == null || buyPrice == null) return null; const netProfit = (sellPrice * (1 - TRANSACTION_FEE)) - buyPrice; return buyPrice > 0 ? +((netProfit / buyPrice) * 100).toFixed(1) : 0; };
const _calculateUndervalue = (avgPrice, currentSell) => { if (avgPrice == null || currentSell == null || avgPrice === 0) return null; return +(((avgPrice - currentSell) / avgPrice) * 100).toFixed(1); };
const _calculateNetProfit = (sellPrice, buyPrice) => { if(sellPrice == null || buyPrice == null) return null; return Math.round((sellPrice * (1-TRANSACTION_FEE)) - buyPrice); };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = async () => {
        try {
            switch (message.action) {
                case "refreshFavoritesMarketData": { 
                    await refreshFavoritesMarketData(); 
                    return {success: true}; 
                }
                case "syncPersonalDataAndRefreshOwned": {
                    await syncPersonalDataAndRefreshOwned();
                    return {success: true};
                }
                case "getSharedData": {
                    return await storage.get(['marketData', 'personalData', 'ownedItems', 'favoriteIds', 'lastUpdate', 'lastDashboardUpdate', 'isUpdating', 'isDashboardUpdating', 'settings', 'priceAlerts']);
                }
                case "getItemDataForPanel": {
                    const { itemId } = message.payload;
                    const { marketData = {}, personalData = {}, favoriteIds = [] } = await storage.get(['marketData', 'personalData', 'favoriteIds']);
                    
                    const combinedData = {
                        ...(marketData[itemId] || {}),
                        ...(personalData[itemId] || {}),
                        isFavorite: favoriteIds.includes(itemId)
                    };
                    
                    if (Object.keys(combinedData).length > 2) { 
                        sendResponse(combinedData);
                    } else {
                        sendResponse({ error: "No cached data found, fetching..." });
                    }

                    (async () => {
                        const freshMarketData = await handleFetchSingleItem(itemId);
                        if (freshMarketData && !freshMarketData.error) {
                            const { marketData: currentMarketData = {}, personalData: currentPersonalData = {} } = await storage.get(['marketData', 'personalData']);
                            currentMarketData[itemId] = freshMarketData;
                            await storage.set({ marketData: currentMarketData });

                            const updatedCombinedData = {
                                ...freshMarketData,
                                ...(currentPersonalData[itemId] || {}),
                                isFavorite: favoriteIds.includes(itemId)
                            };
                            
                            try {
                                await chrome.tabs.sendMessage(sender.tab.id, { action: 'itemDataUpdated', payload: updatedCombinedData });
                            } catch (e) {}
                        }
                    })();
                    return true;
                }
                case "toggleFavorite": {
                    const { itemId } = message.payload;
                    const { favoriteIds = [] } = await storage.get(['favoriteIds']);
                    const idSet = new Set(favoriteIds);
                    const isNowFavorite = !idSet.has(itemId);
                    
                    if (isNowFavorite) {
                        idSet.add(itemId);
                    } else {
                        idSet.delete(itemId);
                    }
                    await storage.set({ favoriteIds: [...idSet] });
                    try {
                        const [tab] = await chrome.tabs.query({ active: true, url: "*://*.ubisoft.com/ko-kr/game/rainbow-six/siege/marketplace*" });
                        if (tab) {
                            await chrome.tabs.sendMessage(tab.id, { action: 'broadcastUpdate', payload: { itemId, isFavorite: isNowFavorite } });
                        }
                    } catch (e) {}
                    return { success: true };
                }
                case "updateAlarm":
                    await updateAlarm(message.payload);
                    return { success: true };
                case "addOrUpdatePriceAlert": {
                    const { priceAlerts = {} } = await storage.get('priceAlerts');
                    priceAlerts[message.payload.itemId] = message.payload.alert;
                    await storage.set({ priceAlerts });
                    return { success: true };
                }
                case "removePriceAlert": {
                    const { priceAlerts = {} } = await storage.get('priceAlerts');
                    delete priceAlerts[message.payload.itemId];
                    await storage.set({ priceAlerts });
                    return { success: true };
                }
            }
        } catch (error) { 
            if(message.action === 'syncPersonalDataAndRefreshOwned') await storage.set({ isDashboardUpdating: false });
            if(message.action === 'refreshFavoritesMarketData') await storage.set({ isUpdating: false });
            throw error;
        }
    };
    handler().then(sendResponse).catch(error => sendResponse({error: {message: error.message, stack: error.stack}}));
    return true;
});

const injectedTabs = {};
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.url && details.url.includes("itemId=")) {
        const url = new URL(details.url);
        const uniqueUrl = url.pathname + url.search;
        if (injectedTabs[details.tabId] === uniqueUrl) return;
        injectedTabs[details.tabId] = uniqueUrl;
        chrome.scripting.executeScript({ target: { tabId: details.tabId }, files: ["injector.js"] });
    }
});
chrome.tabs.onRemoved.addListener((tabId) => { delete injectedTabs[tabId]; });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { if (changeInfo.status === 'loading') delete injectedTabs[tabId]; });