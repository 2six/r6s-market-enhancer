document.addEventListener('DOMContentLoaded', () => {
    const useOverlayCheck = document.getElementById('useOverlay');
    const useFavoritesCheck = document.getElementById('useFavorites');
    const overlayModeSelect = document.getElementById('overlayMode');
    const showFavoritesTabCheck = document.getElementById('showFavoritesTab');
    const showOwnedTabCheck = document.getElementById('showOwnedTab');
    const popupModeSelect = document.getElementById('popupMode');
    const popupLinkActionSelect = document.getElementById('popupLinkAction');
    const usePriceAlertsCheck = document.getElementById('usePriceAlerts');
    const alertIntervalSelect = document.getElementById('alertInterval');
    const purgeDataButton = document.getElementById('purgeData');
    const saveStatusDiv = document.getElementById('saveStatus');
    const lastUpdateSpan = document.getElementById('lastUpdate');
    const lastDashboardUpdateSpan = document.getElementById('lastDashboardUpdate');

    const storage = {
        get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
        set: (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve)),
        clear: () => new Promise((resolve) => chrome.storage.local.clear(resolve)),
    };
    
    async function loadSettings() {
        const data = await storage.get(['settings', 'lastUpdate', 'lastDashboardUpdate']);
        const settings = data.settings || {};

        useOverlayCheck.checked = settings.useOverlay !== false;
        useFavoritesCheck.checked = settings.useFavorites !== false;
        overlayModeSelect.value = settings.overlayMode || 'default';
        showFavoritesTabCheck.checked = settings.showFavoritesTab !== false;
        showOwnedTabCheck.checked = settings.showOwnedTab !== false;
        popupModeSelect.value = settings.popupMode || 'extended';
        popupLinkActionSelect.value = settings.popupLinkAction || 'navigate';
        usePriceAlertsCheck.checked = settings.usePriceAlerts === true;
        alertIntervalSelect.value = settings.alertInterval || 5;
        
        lastUpdateSpan.textContent = data.lastUpdate ? new Date(data.lastUpdate).toLocaleString() : '데이터 없음';
        lastDashboardUpdateSpan.textContent = data.lastDashboardUpdate ? new Date(data.lastDashboardUpdate).toLocaleString() : '데이터 없음';
    }

    async function saveSettings() {
        const { settings: oldSettings } = await storage.get('settings');
        const newSettings = {
            ...(oldSettings || {}),
            useOverlay: useOverlayCheck.checked,
            useFavorites: useFavoritesCheck.checked,
            overlayMode: overlayModeSelect.value,
            showFavoritesTab: showFavoritesTabCheck.checked,
            showOwnedTab: showOwnedTabCheck.checked,
            popupMode: popupModeSelect.value,
            popupLinkAction: popupLinkActionSelect.value,
            usePriceAlerts: usePriceAlertsCheck.checked,
            alertInterval: parseInt(alertIntervalSelect.value, 10),
        };
        await storage.set({ settings: newSettings });
        
        chrome.runtime.sendMessage({ action: "updateAlarm", payload: newSettings });

        saveStatusDiv.style.opacity = '1';
        setTimeout(() => { saveStatusDiv.style.opacity = '0'; }, 1500);
    }

    purgeDataButton.addEventListener('click', async () => {
        if (confirm('정말로 모든 즐겨찾기, 분석 데이터, 설정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
            await storage.clear();
            alert('모든 데이터가 성공적으로 초기화되었습니다. 페이지를 새로고침합니다.');
            location.reload();
        }
    });

    useOverlayCheck.addEventListener('change', saveSettings);
    useFavoritesCheck.addEventListener('change', saveSettings);
    overlayModeSelect.addEventListener('change', saveSettings);
    showFavoritesTabCheck.addEventListener('change', saveSettings);
    showOwnedTabCheck.addEventListener('change', saveSettings);
    popupModeSelect.addEventListener('change', saveSettings);
    popupLinkActionSelect.addEventListener('change', saveSettings);
    usePriceAlertsCheck.addEventListener('change', saveSettings);
    alertIntervalSelect.addEventListener('change', saveSettings);

    loadSettings();
});