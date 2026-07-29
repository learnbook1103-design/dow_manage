import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const { startServer } = require('../server');
const { createServerConfig } = require('../lib/app-config');

const config = createServerConfig(process.env);
const database = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});
const server = startServer(0);
let approvalId = null;

async function jsonRequest(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    assert.equal(response.ok, true, JSON.stringify(body));
    return body;
}

try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await jsonRequest(`${baseUrl}/api/health`);
    assert.equal(health.database, 'connected');

    const indexResponse = await fetch(`${baseUrl}/index.html`);
    const indexHtml = await indexResponse.text();
    assert.equal(indexResponse.ok, true);
    assert.match(indexHtml, /lib\/app-config\.js/);
    assert.match(indexHtml, /runtime-config\.js/);
    assert.match(indexHtml, /lib\/browser\/session-store\.js/);

    const sessionModuleResponse = await fetch(
        `${baseUrl}/lib/browser/session-store.js`
    );
    const sessionModule = await sessionModuleResponse.text();
    assert.equal(sessionModuleResponse.ok, true);
    assert.match(sessionModule, /DowSession/);

    const adminResponse = await fetch(`${baseUrl}/admin.html`);
    const adminHtml = await adminResponse.text();
    assert.equal(adminResponse.ok, true);
    assert.match(adminHtml, /lib\/attendance\/import-normalizer\.js/);
    assert.match(adminHtml, /attendanceImporter\.normalizeRows/);

    const attendanceModuleResponse = await fetch(
        `${baseUrl}/lib/attendance/import-normalizer.js`
    );
    const attendanceModule = await attendanceModuleResponse.text();
    assert.equal(attendanceModuleResponse.ok, true);
    assert.match(attendanceModule, /AttendanceImportNormalizer/);

    const submit = await jsonRequest(`${baseUrl}/api/approval/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: '로컬서버검증',
            applicant: '테스트직원',
            data: { source: 'verify-local-server' },
            amount: 1200
        })
    });
    approvalId = submit.id;

    const approvals = await jsonRequest(
        `${baseUrl}/api/approval/list?applicant=${encodeURIComponent('테스트직원')}`
    );
    assert.equal(approvals.some((approval) => approval.id === approvalId), true);

    const decision = await jsonRequest(`${baseUrl}/api/approval/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: approvalId,
            status: 'approved',
            note: '자동 통합 테스트',
            decided_by: '테스트관리자'
        })
    });
    assert.equal(decision.ok, true);

    console.log(JSON.stringify({
        ok: true,
        health: 'passed',
        staticAssets: 'passed (including session and attendance modules)',
        approvalApi: 'passed'
    }, null, 2));
} finally {
    if (approvalId !== null) {
        await database.from('approvals').delete().eq('id', approvalId);
    }
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}
