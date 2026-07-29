-- Anonymous test-only data. Reset at any time with: npm run db:reset

insert into public.employees
    (name, org, join_date, email, rank, is_leader, shift, pin, is_admin)
values
    ('테스트관리자', '개발팀', '2026-01-01', 'admin@example.test', '관리자', false, '0800-1700', '0000', true),
    ('테스트팀장',   '개발팀', '2026-01-01', 'leader@example.test', '팀장', true,  '0800-1700', '1111', false),
    ('테스트직원',   '개발팀', '2026-01-01', 'staff@example.test', '사원', false, '0830-1730', '2222', false)
on conflict (name) do update set
    org = excluded.org,
    email = excluded.email,
    rank = excluded.rank,
    is_leader = excluded.is_leader,
    shift = excluded.shift,
    pin = excluded.pin,
    is_admin = excluded.is_admin;

insert into public.attendance_records
    (manager_key, name, date, shift, in_time, out_time, is_anomalous, reason)
values
    ('테스트직원_2026-07-20', '테스트직원', '2026-07-20', '0830-1730', '08:22', '17:41', false, ''),
    ('테스트직원_2026-07-21', '테스트직원', '2026-07-21', '0830-1730', '09:05', '17:35', true, '지각'),
    ('테스트직원_2026-07-22', '테스트직원', '2026-07-22', '0830-1730', '08:18', null, true, '퇴근 기록 없음')
on conflict (manager_key) do update set
    in_time = excluded.in_time,
    out_time = excluded.out_time,
    is_anomalous = excluded.is_anomalous,
    reason = excluded.reason,
    updated_at = now();

insert into public.attendance_anomalies
    (date, name, reason, explanation, status, manager_key)
values
    ('2026-07-21', '테스트직원', '지각', null, 'requested', '테스트직원_2026-07-21'),
    ('2026-07-22', '테스트직원', '퇴근 기록 없음', null, 'requested', '테스트직원_2026-07-22')
on conflict (manager_key) do update set
    reason = excluded.reason,
    explanation = excluded.explanation,
    status = excluded.status;

insert into public.attendance_holidays (date, name)
values ('2026-08-15', '광복절')
on conflict (date) do update set name = excluded.name;

insert into public.app_settings (module, key, value)
values
    ('approval', 'approvers', '{"비품구매":"테스트관리자","경조사비":"테스트관리자","출장비":"테스트관리자","식비":"테스트관리자"}'::jsonb),
    ('approval', 'approval_lines', '{}'::jsonb),
    ('approval', 'team_limits', '{"개발팀":{"비품구매":100000,"경조사비":100000,"출장비":100000,"식비":100000}}'::jsonb),
    ('approval', 'over_limit', '{"approver":"테스트관리자"}'::jsonb),
    ('approval', 'form_type', '"internal"'::jsonb),
    ('approval', 'google_form_urls', '{}'::jsonb)
on conflict (module, key) do update set
    value = excluded.value,
    updated_at = now();
