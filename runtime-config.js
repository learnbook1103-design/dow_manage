(function configureDowManage() {
    if (!window.DowManageConfig) {
        throw new Error('DowManageConfig가 먼저 로드되어야 합니다.');
    }
    window.DOW_CONFIG = Object.freeze(
        window.DowManageConfig.createBrowserConfig(window.location.hostname)
    );
})();
