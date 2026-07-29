const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const configApi = require('../../lib/app-config');

test('브라우저는 localhost에서 로컬 DB와 외부 쓰기 차단을 선택한다', () => {
    const config = configApi.createBrowserConfig('localhost');

    assert.equal(config.isLocal, true);
    assert.equal(config.supabaseUrl, 'http://127.0.0.1:54321');
    assert.equal(config.externalWritesEnabled, false);
});

test('브라우저는 배포 호스트에서 운영 DB를 선택한다', () => {
    const config = configApi.createBrowserConfig('dow-manage.vercel.app');

    assert.equal(config.isLocal, false);
    assert.equal(config.supabaseUrl, configApi.PRODUCTION.supabaseUrl);
    assert.equal(config.externalWritesEnabled, true);
});

test('서버 설정은 개발/운영과 명시적 환경변수를 구분한다', () => {
    const local = configApi.createServerConfig({});
    const production = configApi.createServerConfig({ NODE_ENV: 'production' });
    const overridden = configApi.createServerConfig({
        SUPABASE_URL: 'http://db.example.test',
        SUPABASE_ANON_KEY: 'test-key',
        PORT: '4100'
    });

    assert.equal(local.isLocal, true);
    assert.equal(local.gasApprovalUrl, '');
    assert.equal(production.isLocal, false);
    assert.equal(production.supabaseUrl, configApi.PRODUCTION.supabaseUrl);
    assert.equal(overridden.supabaseUrl, 'http://db.example.test');
    assert.equal(overridden.supabaseKey, 'test-key');
    assert.equal(overridden.port, 4100);
});

test('runtime-config는 공통 설정 모듈의 결과를 고정해 노출한다', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../runtime-config.js'),
        'utf8'
    );
    const context = {
        window: {
            DowManageConfig: configApi,
            location: { hostname: '127.0.0.1' }
        }
    };

    vm.runInNewContext(source, context);

    assert.equal(context.window.DOW_CONFIG.isLocal, true);
    assert.equal(Object.isFrozen(context.window.DOW_CONFIG), true);
});
