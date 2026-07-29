(function exposeSessionStore(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.DowSession = api.createSessionStore({
            localStorage: root.localStorage,
            sessionStorage: root.sessionStorage
        });
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSessionStoreModule() {
    const LOCAL_KEYS = Object.freeze({
        name: 'attendance_user_name',
        pin: 'attendance_user_pin',
        org: 'attendance_user_org',
        rank: 'attendance_user_rank',
        loginDate: 'attendance_login_date'
    });
    const SESSION_KEYS = Object.freeze({
        isAdmin: 'attendance_user_is_admin',
        isLeader: 'attendance_user_is_leader',
        org: 'attendance_user_org'
    });

    function localDateString(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function createSessionStore({
        localStorage,
        sessionStorage,
        now = () => new Date()
    } = {}) {
        if (!localStorage || !sessionStorage) {
            return null;
        }

        function read() {
            const adminValue = sessionStorage.getItem(SESSION_KEYS.isAdmin);
            const leaderValue = sessionStorage.getItem(SESSION_KEYS.isLeader);
            return {
                name: localStorage.getItem(LOCAL_KEYS.name) || '',
                pin: localStorage.getItem(LOCAL_KEYS.pin) || '',
                org: localStorage.getItem(LOCAL_KEYS.org)
                    || sessionStorage.getItem(SESSION_KEYS.org)
                    || '',
                rank: localStorage.getItem(LOCAL_KEYS.rank) || '',
                loginDate: localStorage.getItem(LOCAL_KEYS.loginDate) || '',
                isAdmin: adminValue === 'true',
                isLeader: leaderValue === 'true',
                hasAuthorization: adminValue !== null
            };
        }

        function save(user) {
            localStorage.setItem(LOCAL_KEYS.name, String(user.name || ''));
            localStorage.setItem(LOCAL_KEYS.pin, String(user.pin || ''));
            localStorage.setItem(LOCAL_KEYS.org, String(user.org || ''));
            localStorage.setItem(LOCAL_KEYS.rank, String(user.rank || ''));
            localStorage.setItem(
                LOCAL_KEYS.loginDate,
                user.loginDate || localDateString(now())
            );
            sessionStorage.setItem(SESSION_KEYS.isAdmin, String(Boolean(user.isAdmin)));
            sessionStorage.setItem(SESSION_KEYS.isLeader, String(Boolean(user.isLeader)));
            sessionStorage.setItem(SESSION_KEYS.org, String(user.org || ''));
            return read();
        }

        function clearAuthorization() {
            Object.values(SESSION_KEYS).forEach((key) => sessionStorage.removeItem(key));
        }

        function clear() {
            Object.values(LOCAL_KEYS).forEach((key) => localStorage.removeItem(key));
            clearAuthorization();
        }

        function hasCredentials() {
            const user = read();
            return Boolean(user.name && user.pin);
        }

        function isCurrentDay() {
            return read().loginDate === localDateString(now());
        }

        return Object.freeze({
            read,
            save,
            clear,
            clearAuthorization,
            hasCredentials,
            isCurrentDay
        });
    }

    return Object.freeze({
        LOCAL_KEYS,
        SESSION_KEYS,
        localDateString,
        createSessionStore
    });
}));
