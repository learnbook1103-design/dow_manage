import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTk1NzM0NTIwMH0.dZrfDB3HmOCJuPkvSpdSagOTQQ9qBE5mGQf1fAnKzew';
const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const runId = `local-verify-${Date.now()}`;
const storagePath = `_verification/${runId}.txt`;
let approvalId = null;

function expect(result, label) {
    if (result.error) {
        throw new Error(`${label}: ${result.error.message}`);
    }
    return result.data;
}

try {
    const employees = expect(
        await client.from('employees').select('name, pin, is_admin').order('name'),
        '직원 시드 조회 실패'
    );
    if (!employees.some((employee) => employee.name === '테스트관리자' && employee.is_admin)) {
        throw new Error('관리자 테스트 계정이 없습니다.');
    }

    const approval = expect(
        await client
            .from('approvals')
            .insert({
                type: '로컬검증',
                applicant: '테스트직원',
                data: { runId },
                amount: 1000
            })
            .select('id, status')
            .single(),
        '결재 생성 실패'
    );
    approvalId = approval.id;

    const updatedApproval = expect(
        await client
            .from('approvals')
            .update({ status: 'approved', decided_by: '테스트관리자' })
            .eq('id', approvalId)
            .select('status')
            .single(),
        '결재 갱신 실패'
    );
    if (updatedApproval.status !== 'approved') {
        throw new Error('결재 상태가 갱신되지 않았습니다.');
    }

    expect(
        await client.storage
            .from('approval-files')
            .upload(storagePath, new Blob(['local storage verification'], { type: 'text/plain' })),
        'Storage 업로드 실패'
    );
    const signedUrl = expect(
        await client.storage.from('approval-files').createSignedUrl(storagePath, 60),
        'Storage 서명 URL 생성 실패'
    );
    if (!signedUrl?.signedUrl) {
        throw new Error('Storage 서명 URL이 생성되지 않았습니다.');
    }

    console.log(JSON.stringify({
        ok: true,
        apiUrl: url,
        employees: employees.length,
        databaseCrud: 'passed',
        storage: 'passed'
    }, null, 2));
} finally {
    await client.storage.from('approval-files').remove([storagePath]);
    if (approvalId !== null) {
        await client.from('approvals').delete().eq('id', approvalId);
    }
}
