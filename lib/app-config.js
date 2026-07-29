(function exposeConfig(root, factory) {
    const configApi = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = configApi;
    }
    if (root) {
        root.DowManageConfig = configApi;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createConfigApi() {
    const PRODUCTION = Object.freeze({
        supabaseUrl: 'https://grxslikvzxafmxuepusy.supabase.co',
        supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeHNsaWt2enhhZm14dWVwdXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDI4MzAsImV4cCI6MjA4ODY3ODgzMH0.F2Kz13S44mPdt4RelEIGzGP7qfZBbNRm-HAaKxJZdjc',
        gasApprovalUrl: 'https://script.google.com/macros/s/AKfycbw9ilToZxa0TbUJcOSisgYXVL-g-S5jy8eptzaHLcgAu53GmYdtZ5AXsxmoKxphBLTomA/exec'
    });

    const LOCAL = Object.freeze({
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTk1NzM0NTIwMH0.dZrfDB3HmOCJuPkvSpdSagOTQQ9qBE5mGQf1fAnKzew'
    });

    function isLocalHostname(hostname) {
        return ['localhost', '127.0.0.1', '::1'].includes(String(hostname || '').toLowerCase());
    }

    function isLocalServerRuntime(env = {}) {
        return !env.VERCEL
            && env.NODE_ENV !== 'production'
            && env.DOW_ENV !== 'production';
    }

    function createBrowserConfig(hostname) {
        const isLocal = isLocalHostname(hostname);
        return {
            isLocal,
            supabaseUrl: isLocal ? LOCAL.supabaseUrl : PRODUCTION.supabaseUrl,
            supabaseKey: isLocal ? LOCAL.supabaseKey : PRODUCTION.supabaseKey,
            externalWritesEnabled: !isLocal
        };
    }

    function createServerConfig(env = {}) {
        const isLocal = isLocalServerRuntime(env);
        return {
            isLocal,
            port: Number(env.PORT) || 3000,
            supabaseUrl: env.SUPABASE_URL
                || (isLocal ? LOCAL.supabaseUrl : PRODUCTION.supabaseUrl),
            supabaseKey: env.SUPABASE_ANON_KEY
                || (isLocal ? LOCAL.supabaseKey : PRODUCTION.supabaseKey),
            gasApprovalUrl: env.GAS_APPROVAL_URL
                || (isLocal ? '' : PRODUCTION.gasApprovalUrl)
        };
    }

    return Object.freeze({
        PRODUCTION,
        LOCAL,
        isLocalHostname,
        isLocalServerRuntime,
        createBrowserConfig,
        createServerConfig
    });
}));
