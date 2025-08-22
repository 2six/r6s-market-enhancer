window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data.type || !event.data.type.startsWith('R6S_')) return;
    const { type, payload } = event.data;
    let action, responseType;
    switch (type) {
        case 'R6S_GET_ITEM_DATA':
            action = 'getItemDataForPanel'; responseType = 'R6S_ITEM_DATA_RESPONSE'; break;
        case 'R6S_TOGGLE_FAVORITE':
            action = 'toggleFavorite'; responseType = 'R6S_TOGGLE_FAVORITE_RESPONSE'; break;
        case 'R6S_LIST_DATA_CAPTURED':
            action = 'processListData'; break;
        default: return;
    }
    if (action) {
        chrome.runtime.sendMessage({ action, payload }, (response) => {
            if (chrome.runtime.lastError) {
                if (chrome.runtime.lastError.message.includes("context invalidated")) return;
                return;
            }
            if (responseType) {
                window.postMessage({ type: responseType, payload: response }, '*');
            }
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let forwardType;
    switch (message.action) {
        case 'broadcastUpdate':
            forwardType = 'R6S_BROADCAST_UPDATE'; break;
        case 'listTagsReady':
            forwardType = 'R6S_LIST_TAGS_READY'; break;
        case 'navigateToItem':
            forwardType = 'R6S_NAVIGATE_TO_ITEM'; break;
        case 'itemDataUpdated':
            forwardType = 'R6S_ITEM_DATA_UPDATED'; break;
        default: return;
    }
    if (forwardType) {
        window.postMessage({ type: forwardType, payload: message.payload }, '*');
    }
});