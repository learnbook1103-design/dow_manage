const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LOCAL_KEYS,
    SESSION_KEYS,
    localDateString,
    createSessionStore
} = require('../../lib/browser/session-store');

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

function createFixtureStore() {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const store = createSessionStore({
        localStorage,
        sessionStorage,
        now: () => new Date(2026, 6, 24, 9, 30)
    });
    return { store, localStorage, sessionStorage };
}

test('로그인 정보를 공통 키와 로컬 날짜로 저장하고 읽는다', () => {
    const { store } = createFixtureStore();

    const user = store.save({
        name: '테스트관리자',
        pin: '0000',
        org: '경영지원',
        rank: '관리자',
        isAdmin: true,
        isLeader: true
    });

    assert.deepEqual(user, {
        name: '테스트관리자',
        pin: '0000',
        org: '경영지원',
        rank: '관리자',
        loginDate: '2026-07-24',
        isAdmin: true,
        isLeader: true,
        hasAuthorization: true
    });
    assert.equal(store.hasCredentials(), true);
    assert.equal(store.isCurrentDay(), true);
});

test('로그아웃은 로컬 사용자 정보와 세션 권한을 모두 제거한다', () => {
    const { store, localStorage, sessionStorage } = createFixtureStore();
    store.save({ name: '테스트직원', pin: '2222', isAdmin: false });

    store.clear();

    Object.values(LOCAL_KEYS).forEach((key) => assert.equal(localStorage.getItem(key), null));
    Object.values(SESSION_KEYS).forEach((key) => assert.equal(sessionStorage.getItem(key), null));
    assert.equal(store.hasCredentials(), false);
});

test('날짜 문자열은 UTC 변환 없이 로컬 날짜를 사용한다', () => {
    assert.equal(localDateString(new Date(2026, 0, 2, 0, 5)), '2026-01-02');
});
