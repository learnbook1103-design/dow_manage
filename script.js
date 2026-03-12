document.addEventListener('DOMContentLoaded', () => {
    // [설정] Supabase 연동 정보 (사용자가 직접 입력 필요)
    const SUPABASE_URL = "https://grxslikvzxafmxuepusy.supabase.co";
    const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeHNsaWt2enhhZm14dWVwdXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDI4MzAsImV4cCI6MjA4ODY3ODgzMH0.F2Kz13S44mPdt4RelEIGzGP7qfZBbNRm-HAaKxJZdjc";
    let supabase = null;

    if (SUPABASE_URL && SUPABASE_KEY) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    // 기본 UI 요소
    const dropZoneAttendance = document.getElementById('drop-zone-attendance');
    const fileInputAttendance = document.getElementById('file-input-attendance');
    const fileListAttendance = document.getElementById('file-list-attendance');

    const dropZoneLeave = document.getElementById('drop-zone-leave');
    const fileInputLeave = document.getElementById('file-input-leave');
    const fileStatusLeave = document.getElementById('file-status-leave');
    const reportContainer = document.getElementById('report-container');
    const reportDateInput = document.getElementById('report-date-input');
    const employeeListContainer = document.getElementById('employee-list-container');
    const addEmployeeBtn = document.getElementById('add-employee-btn');
    const employeeModal = document.getElementById('employee-modal');
    const openManagerBtn = document.getElementById('open-manager-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const saveEmployeeBtn = document.getElementById('save-employee-btn');
    const printBtn = document.getElementById('print-btn');

    // 검증(Verification) 기능 요소
    const verifyBtn = document.getElementById('verify-data-btn');
    const verifyModal = document.getElementById('verify-modal');
    const closeVerifyBtn = document.getElementById('close-verify-btn');
    const verifyTbody = document.getElementById('verify-tbody');
    const verifyEmptyMsg = document.getElementById('verify-empty-msg');
    const bulkUnconfirmBtn = document.getElementById('bulk-unconfirm-btn');
    const syncToCloudBtn = document.getElementById('sync-to-cloud-btn');
    const fetchFromCloudBtn = document.getElementById('fetch-from-cloud-btn');

    // 공휴일 관리 요소
    const openHolidayBtn = document.getElementById('open-holiday-btn');
    const holidayModal = document.getElementById('holiday-modal');
    const closeHolidayModalBtn = document.getElementById('close-holiday-modal-btn');
    const holidayListContainer = document.getElementById('holiday-list-container');
    const newHolidayDateInput = document.getElementById('new-holiday-date');
    const addHolidayBtn = document.getElementById('add-holiday-btn');
    const cloudSyncAllBtn = document.getElementById('cloud-sync-all-btn');
    const cloudFetchAllBtn = document.getElementById('cloud-fetch-all-btn');

    async function syncAllToCloud() {
        if (!supabase) { alert("시스템 연결 중입니다. 잠시 후 시도해 주세요."); return; }

        // collect all records across all names and dates
        const currentMatrix = updateAndProcessData(true); // Get the recordsMap
        if (!currentMatrix) { alert("저장할 데이터가 없습니다. 먼저 엑셀 파일을 업로드해주세요."); return; }

        const { recordsMap, names, uniqueDates } = currentMatrix;
        const toUpsert = [];

        names.forEach(name => {
            const userRecs = recordsMap[name] || {};
            uniqueDates.forEach(date => {
                const rec = userRecs[date];
                if (rec) {
                    const corrKey = `${name}_${date}`;
                    const corrData = manualCorrections[corrKey] || { in: false, out: false, leave: false };

                    toUpsert.push({
                        manager_key: corrKey,
                        name: name,
                        date: date,
                        shift: rec.shiftStart,
                        in_time: rec.inTime,
                        out_time: rec.outTime,
                        status_in: !!corrData.in,
                        status_out: !!corrData.out,
                        status_leave: !!corrData.leave,
                        manager_reason: manualReasons[corrKey] || "",
                        employee_explanation: employeeExplanations[corrKey] || "",
                        reason: rec.reason || "", // [추가] 휴가 사유 클라우드 저장
                        early_punch_mode: manualEarlyPunches[corrKey] || "",
                        is_anomalous: !!(unconfirmedAnomaliesMap[corrKey] && (unconfirmedAnomaliesMap[corrKey].in || unconfirmedAnomaliesMap[corrKey].out))
                    });
                }
            });
        });

        if (toUpsert.length === 0) { alert("저장할 활동 데이터가 없습니다."); return; }

        if (!confirm(`현재 화면에 로드된 ${toUpsert.length}건의 데이터를 클라우드에 백업하시겠습니까?\n(기존 동일 날짜 데이터는 업데이트됩니다)`)) return;

        cloudSyncAllBtn.disabled = true;
        cloudSyncAllBtn.textContent = "⏳ 저장 중...";

        const { error } = await supabase
            .from('attendance_records')
            .upsert(toUpsert, { onConflict: 'manager_key' });

        if (error) {
            console.error('Cloud Sync Error:', error);
            alert('저장 중 오류가 발생했습니다: ' + error.message);
        } else {
            alert(`성공적으로 ${toUpsert.length}건을 클라우드에 저장했습니다.`);
        }
        cloudSyncAllBtn.disabled = false;
        cloudSyncAllBtn.textContent = "전체 데이터 클라우드 저장";
    }
    async function uploadFileToStorage(file, path) {
        if (!supabase) return;
        const bucketName = 'attendance-files';
        const timestamp = new Date().getTime();
        const fullPath = `${path}/${timestamp}_${file.name}`;

        const { data, error } = await supabase.storage
            .from(bucketName)
            .upload(fullPath, file);

        if (error) {
            console.error('File Upload Error:', error);
        } else {
            console.log('File uploaded successfully:', data.path);
        }
    }

    async function autoSyncToCloud(matrix) {
        if (!supabase) return;
        if (!matrix) return;

        const { recordsMap, names, uniqueDates } = matrix;
        const toUpsert = [];

        names.forEach(name => {
            const userRecs = recordsMap[name] || {};
            uniqueDates.forEach(date => {
                const rec = userRecs[date];
                if (rec) {
                    const corrKey = `${name}_${date}`;
                    const corrData = manualCorrections[corrKey] || { in: false, out: false, leave: false };
                    toUpsert.push({
                        manager_key: corrKey,
                        name: name,
                        date: date,
                        shift: rec.shiftStart,
                        in_time: rec.inTime,
                        out_time: rec.outTime,
                        status_in: !!corrData.in,
                        status_out: !!corrData.out,
                        status_leave: !!corrData.leave,
                        manager_reason: manualReasons[corrKey] || "",
                        employee_explanation: employeeExplanations[corrKey] || "",
                        reason: rec.reason || "",
                        early_punch_mode: manualEarlyPunches[corrKey] || "",
                        is_anomalous: !!(unconfirmedAnomaliesMap[corrKey] && (unconfirmedAnomaliesMap[corrKey].in || unconfirmedAnomaliesMap[corrKey].out))
                    });
                }
            });
        });

        if (toUpsert.length === 0) return;

        const { error } = await supabase
            .from('attendance_records')
            .upsert(toUpsert, { onConflict: 'manager_key' });

        if (error) {
            console.error('Auto Sync Error:', error);
        } else {
            console.log(`자동 저장 완료: ${toUpsert.length}건`);
            cloudSyncAllBtn.textContent = `저장됨 (${toUpsert.length}건)`;
            setTimeout(() => cloudSyncAllBtn.textContent = "전체 데이터 클라우드 저장", 3000);
        }
    }
    async function fetchAllFromCloud() {
        if (!supabase) { alert("시스템 연결 중입니다. 잠시 후 시도해 주세요."); return; }

        const start = document.getElementById('report-period-start')?.value;
        const end = document.getElementById('report-period-end')?.value;

        if (!start || !end) { alert("불러오기 전 '기간 설정'의 시작일과 종료일을 입력해주세요."); return; }

        cloudFetchAllBtn.disabled = true;
        cloudFetchAllBtn.textContent = "⏳ 불러오는 중...";

        const { data, error } = await supabase
            .from('attendance_records')
            .select('*')
            .gte('date', start)
            .lte('date', end);

        if (error) {
            console.error('Cloud Fetch Error:', error);
            alert('불러오기 중 오류가 발생했습니다: ' + error.message);
        } else if (data && data.length > 0) {
            // Map to local state
            data.forEach(row => {
                const key = row.manager_key;
                manualCorrections[key] = {
                    in: row.status_in,
                    out: row.status_out,
                    leave: row.status_leave
                };
                manualReasons[key] = row.manager_reason || "";
                employeeExplanations[key] = row.employee_explanation || "";
                if (row.early_punch_mode) {
                    manualEarlyPunches[key] = row.early_punch_mode;
                }

                if (!attendanceFilesMap.has('Cloud_Data')) attendanceFilesMap.set('Cloud_Data', []);
                const cloudData = attendanceFilesMap.get('Cloud_Data');
                const existingIdx = cloudData.findIndex(d => `${d.이름}_${d.날짜}` === key);
                const newRow = {
                    "날짜": row.date,
                    "이름": row.name,
                    "근무조": row.shift,
                    "출근": row.in_time,
                    "퇴근": row.out_time,
                    "비고": row.reason || ""
                };
                if (existingIdx > -1) cloudData[existingIdx] = newRow;
                else cloudData.push(newRow);
            });

            localStorage.setItem('manualCorrections', JSON.stringify(manualCorrections));
            localStorage.setItem('manualReasons', JSON.stringify(manualReasons));
            localStorage.setItem('employeeExplanations', JSON.stringify(employeeExplanations));
            localStorage.setItem('manualEarlyPunches', JSON.stringify(manualEarlyPunches));
        }

        // [추가] 선제적 보완 데이터(사전 등록 내역) 별도 로딩
        try {
            const { data: prepData, error: prepError } = await supabase
                .from('attendance_supplements')
                .select('*')
                .gte('date', start)
                .lte('date', end);

            if (prepError) {
                alert('선제 등록 내역 불러오기 중 오류: ' + prepError.message);
            } else if (prepData) {
                if (prepData.length > 0) {
                    prepData.forEach(row => {
                        const key = `${normalizeName(row.name)}_${row.date}`;
                        const reasonText = row.type + (row.details ? ` (${row.details})` : "");
                        // [단일화] 사원 소명 객체에도 동일하게 반영
                        if (!employeeExplanations[key]) {
                            employeeExplanations[key] = reasonText;
                        } else if (!employeeExplanations[key].includes(reasonText)) {
                            employeeExplanations[key] += `, ${reasonText}`;
                        }
                    });
                    localStorage.setItem('employeeExplanations', JSON.stringify(employeeExplanations));
                }
            }
        } catch (prepErr) {
            console.error('Preemptive Supplement Fetch Error:', prepErr);
        }
        // [추가] 직원 제출 보완 답변(attendance_anomalies) 자동 로딩
        try {
            const { data: anomalyData, error: anomalyError } = await supabase
                .from('attendance_anomalies')
                .select('manager_key, explanation')
                .not('explanation', 'is', null)
                .gte('date', start)
                .lte('date', end);

            if (anomalyError) {
                console.error('Anomaly Explanation Fetch Error:', anomalyError);
            } else if (anomalyData && anomalyData.length > 0) {
                anomalyData.forEach(item => {
                    if (item.explanation) {
                        employeeExplanations[item.manager_key] = item.explanation;
                    }
                });
                localStorage.setItem('employeeExplanations', JSON.stringify(employeeExplanations));
            }
        } catch (anomalyErr) {
            console.error('Anomaly Fetch Error:', anomalyErr);
        }
        updateAndProcessData();
        cloudFetchAllBtn.disabled = false;
        cloudFetchAllBtn.textContent = "클라우드 데이터 불러오기";

        const totalRecords = (data ? data.length : 0);
        const prepCount = (prepData ? prepData.length : 0);

        if (totalRecords > 0 || prepCount > 0) {
            alert(`클라우드 데이터를 불러왔습니다.\n(기록: ${totalRecords}건, 사전등록: ${prepCount}건)`);
        } else {
            alert(`해당 기간(${start} ~ ${end})에 클라우드에 저장된 데이터가 없습니다.`);
        }
    }

    if (cloudSyncAllBtn) cloudSyncAllBtn.onclick = syncAllToCloud;
    if (cloudFetchAllBtn) cloudFetchAllBtn.onclick = fetchAllFromCloud;

    // 업로드된 출퇴근 엑셀 데이터 관리 (파일명: 데이터)
    let attendanceFilesMap = new Map();
    let currentLeaveData = null;
    let currentUniqueDates = new Set();

    // [추가] 이상 근태 하이라이트 관련
    let showAnomaliesHighlight = false;
    let unconfirmedAnomaliesMap = {};

    // { '이름_날짜': { in: true, out: true } }
    const highlightAnomalyBtn = document.getElementById('highlight-anomaly-btn');

    if (highlightAnomalyBtn) {
        highlightAnomalyBtn.addEventListener('click', () => {
            showAnomaliesHighlight = !showAnomaliesHighlight;
            highlightAnomalyBtn.classList.toggle('active', showAnomaliesHighlight);
            updateAndProcessData();
        });
    }

    // [추가] 모달 드래그 기능
    function makeDraggable(modalEl) {
        const content = modalEl.querySelector('.modal-content');
        const header = modalEl.querySelector('.modal-header');
        if (!content || !header) return;

        let isDragging = false;
        let startX, startY;
        let transX = 0, transY = 0;

        header.onmousedown = (e) => {
            if (e.target.closest('button')) return; // 버튼 클릭은 무시
            isDragging = true;
            startX = e.clientX - transX;
            startY = e.clientY - transY;
            e.preventDefault();
        };

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            transX = e.clientX - startX;
            transY = e.clientY - startY;
            content.style.transform = `translate(${transX}px, ${transY}px)`;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    makeDraggable(employeeModal);
    makeDraggable(verifyModal);
    makeDraggable(holidayModal);

    // [추가] 수동 확인 데이터 (localStorage)
    const savedCorrections = localStorage.getItem('manualCorrections');
    let manualCorrections = savedCorrections ? JSON.parse(savedCorrections) : {};

    const savedEarlyPunches = localStorage.getItem('manualEarlyPunches');
    let manualEarlyPunches = savedEarlyPunches ? JSON.parse(savedEarlyPunches) : {};

    const savedReasons = localStorage.getItem('manualReasons');
    const savedExplanations = localStorage.getItem('employeeExplanations');
    let employeeExplanations = savedExplanations ? JSON.parse(savedExplanations) : {};
    let manualReasons = savedReasons ? JSON.parse(savedReasons) : {};

    // [추가] 선제적 보완 데이터 저장소
    const savedPreemptive = localStorage.getItem('preemptiveSupplements');
    let preemptiveSupplements = {}; // 더이상 사용하지 않지만 변수 선언은 유지 (오류 방지)

    // 사원 리스트 데이터 (localStorage에서 불러오기)
    const savedEmployees = localStorage.getItem('employeeConfigList');
    let employeeConfigList = savedEmployees ? JSON.parse(savedEmployees) : [
        { org: "다우밸브", name: "정미영" }, { org: "다우밸브", name: "김혜원" },
        { org: "다우밸브", name: "이대희" }, { org: "다우밸브", name: "이재근" },
        { org: "다우밸브", name: "서현석" }, { org: "다우밸브", name: "박주연" },
        { org: "다우밸브", name: "김현욱" }, { org: "다우밸브", name: "강미나" },
        { org: "밸브파크", name: "곽정원" }, { org: "다우밸브", name: "안효모" },
        { org: "다우밸브", name: "김영민" }, { org: "다우밸브", name: "이재룡" },
        { org: "다우밸브", name: "정광호" }, { org: "다우밸브", name: "이수형" },
        { org: "다우밸브", name: "장근영" }, { org: "다우밸브", name: "황나경" },
        { org: "밸브파크", name: "이도아" }, { org: "밸브파크", name: "채예은" },
        { org: "다우밸브", name: "한옥련" }, { org: "다우밸브", name: "채민주" },
        { org: "다우밸브", name: "정상민" }
    ];

    // 공휴일 리스트 데이터 (localStorage에서 불러오기)
    const savedHolidays = localStorage.getItem('holidayConfigList');
    let holidayConfigList = savedHolidays ? JSON.parse(savedHolidays) : [];
    let tempHolidayConfigList = [];

    // 다년도 법정 공휴일 데이터 (미리 정의된 리스트)
    const PREDEFINED_HOLIDAYS = [
        // 2024년
        { date: "2024-01-01", name: "신정" }, { date: "2024-02-09", name: "설날" }, { date: "2024-02-10", name: "설날" }, { date: "2024-02-11", name: "설날" }, { date: "2024-02-12", name: "대체공휴일" },
        { date: "2024-03-01", name: "삼일절" }, { date: "2024-04-10", name: "국회의원선거" }, { date: "2024-05-05", name: "어린이날" }, { date: "2024-05-06", name: "대체공휴일" }, { date: "2024-05-15", name: "부처님오신날" },
        { date: "2024-06-06", name: "현충일" }, { date: "2024-08-15", name: "광복절" }, { date: "2024-09-16", name: "추석" }, { date: "2024-09-17", name: "추석" }, { date: "2024-09-18", name: "추석" },
        { date: "2024-10-03", name: "개천절" }, { date: "2024-10-09", name: "한글날" }, { date: "2024-12-25", name: "크리스마스" },
        // 2025년
        { date: "2025-01-01", name: "신정" }, { date: "2025-01-28", name: "설날" }, { date: "2025-01-29", name: "설날" }, { date: "2025-01-30", name: "설날" }, { date: "2025-03-01", name: "삼일절" }, { date: "2025-03-03", name: "대체공휴일" },
        { date: "2025-05-05", name: "어린이날" }, { date: "2025-05-06", name: "부처님오신날" }, { date: "2025-06-06", name: "현충일" }, { date: "2025-08-15", name: "광복절" }, { date: "2025-10-03", name: "개천절" },
        { date: "2025-10-05", name: "추석" }, { date: "2025-10-06", name: "추석" }, { date: "2025-10-07", name: "추석" }, { date: "2025-10-08", name: "대체공휴일" }, { date: "2025-10-09", name: "한글날" }, { date: "2025-12-25", name: "크리스마스" },
        // 2026년
        { date: "2026-01-01", name: "신정" }, { date: "2026-02-16", name: "설날" }, { date: "2026-02-17", name: "설날" }, { date: "2026-02-18", name: "설날" }, { date: "2026-03-01", name: "삼일절" }, { date: "2026-03-02", name: "대체공휴일" },
        { date: "2026-05-05", name: "어린이날" }, { date: "2026-05-24", name: "부처님오신날" }, { date: "2026-05-25", name: "대체공휴일" }, { date: "2026-06-06", name: "현충일" }, { date: "2026-08-15", name: "광복절" }, { date: "2026-10-03", name: "개천절" },
        { date: "2026-09-24", name: "추석" }, { date: "2026-09-25", name: "추석" }, { date: "2026-09-26", name: "추석" }, { date: "2026-10-09", name: "한글날" }, { date: "2026-12-25", name: "크리스마스" },
        // 2027년
        { date: "2027-01-01", name: "신정" }, { date: "2027-02-06", name: "설날" }, { date: "2027-02-07", name: "설날" }, { date: "2027-02-08", name: "설날" }, { date: "2027-02-09", name: "대체공휴일" },
        { date: "2027-03-01", name: "삼일절" }, { date: "2027-05-05", name: "어린이날" }, { date: "2027-05-13", name: "부처님오신날" }, { date: "2027-06-06", name: "현충일" }, { date: "2027-08-15", name: "광복절" }, { date: "2027-08-16", name: "대체공휴일" },
        { date: "2027-09-14", name: "추석" }, { date: "2027-09-15", name: "추석" }, { date: "2027-09-16", name: "추석" }, { date: "2027-10-03", name: "개천절" }, { date: "2027-10-04", name: "대체공휴일" }, { date: "2027-10-09", name: "한글날" }, { date: "2027-12-25", name: "크리스마스" },
        // 2028년
        { date: "2028-01-01", name: "신정" }, { date: "2028-01-26", name: "설날" }, { date: "2028-01-27", name: "설날" }, { date: "2028-01-28", name: "설날" }, { date: "2028-03-01", name: "삼일절" },
        { date: "2028-05-02", name: "부처님오신날" }, { date: "2028-05-05", name: "어린이날" }, { date: "2028-06-06", name: "현충일" }, { date: "2028-08-15", name: "광복절" },
        { date: "2028-10-03", name: "개천절" }, { date: "2028-10-03", name: "추석" }, { date: "2028-10-04", name: "추석" }, { date: "2028-10-05", name: "추석" }, { date: "2028-10-06", name: "대체공휴일" }, { date: "2028-10-09", name: "한글날" }, { date: "2028-12-25", name: "크리스마스" },
        // 2029년
        { date: "2029-01-01", name: "신정" }, { date: "2029-02-12", name: "설날" }, { date: "2029-02-13", name: "설날" }, { date: "2029-02-14", name: "설날" }, { date: "2029-03-01", name: "삼일절" },
        { date: "2029-05-05", name: "어린이날" }, { date: "2029-05-07", name: "대체공휴일" }, { date: "2029-05-20", name: "부처님오신날" }, { date: "2029-05-21", name: "대체공휴일" }, { date: "2029-06-06", name: "현충일" },
        { date: "2029-08-15", name: "광복절" }, { date: "2029-09-21", name: "추석" }, { date: "2029-09-22", name: "추석" }, { date: "2029-09-23", name: "추석" }, { date: "2029-09-24", name: "대체공휴일" },
        { date: "2029-10-03", name: "개천절" }, { date: "2029-10-09", name: "한글날" }, { date: "2029-12-25", name: "크리스마스" },
        // 2030년
        { date: "2030-01-01", name: "신정" }, { date: "2030-02-02", name: "설날" }, { date: "2030-02-03", name: "설날" }, { date: "2030-02-04", name: "설날" }, { date: "2030-03-01", name: "삼일절" },
        { date: "2030-05-05", name: "어린이날" }, { date: "2030-05-06", name: "대체공휴일" }, { date: "2030-05-09", name: "부처님오신날" }, { date: "2030-06-06", name: "현충일" },
        { date: "2030-08-15", name: "광복절" }, { date: "2030-09-11", name: "추석" }, { date: "2030-09-12", name: "추석" }, { date: "2030-09-13", name: "추석" },
        { date: "2030-10-03", name: "개천절" }, { date: "2030-10-09", name: "한글날" }, { date: "2030-12-25", name: "크리스마스" }
    ];

    function isHoliday(dateStr) {
        return holidayConfigList.some(h => h.date === dateStr);
    }

    // 공휴일 관리 UI 렌더링
    function renderHolidayManager() {
        if (!holidayListContainer) return;
        holidayListContainer.innerHTML = '';

        if (tempHolidayConfigList.length === 0) {
            holidayListContainer.innerHTML = '<div class="holiday-empty-msg">등록된 공휴일이 없습니다.</div>';
            return;
        }

        tempHolidayConfigList.sort((a, b) => a.date.localeCompare(b.date)).forEach((hol, index) => {
            const item = document.createElement('div');
            item.className = 'holiday-item';
            item.innerHTML = `
                <div>
                    <span class="holiday-date">${hol.date}</span>
                    <span class="holiday-name">${hol.name || ''}</span>
                </div>
                <button class="remove-holiday-btn" data-index="${index}">&times;</button>
            `;
            item.querySelector('.remove-holiday-btn').onclick = () => {
                tempHolidayConfigList.splice(index, 1);
                renderHolidayManager();
            };
            holidayListContainer.appendChild(item);
        });
    }

    // ----- [추가] 사원 관리 모달 임시 상태 변수 -----
    let tempEmployeeConfigList = [];
    let draggedItemIndex = null;

    // 사원 관리 UI 렌더링 (드래그 기능 포함)
    function renderEmployeeManager() {
        if (!employeeListContainer) return;
        employeeListContainer.innerHTML = '';

        tempEmployeeConfigList.forEach((emp, index) => {
            const row = document.createElement('div');
            row.className = 'employee-row';
            row.draggable = true; // 드래그 가능 설정
            row.dataset.index = index;

            // 드래그 이벤트 리스너
            row.addEventListener('dragstart', (e) => {
                draggedItemIndex = index;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault(); // 드롭 허용
                row.classList.add('dragover');
            });

            row.addEventListener('dragleave', () => {
                row.classList.remove('dragover');
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('dragover');
                const targetIndex = index;
                if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
                    // 데이터 순서 변경
                    const movedItem = tempEmployeeConfigList.splice(draggedItemIndex, 1)[0];
                    tempEmployeeConfigList.splice(targetIndex, 0, movedItem);
                    renderEmployeeManager();
                }
            });

            row.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                draggedItemIndex = null;
            });

            // 기존 입력창 및 버튼들
            const orgSelect = document.createElement('select');
            orgSelect.className = 'org-select';
            ['조직 선택', '다우밸브', '밸브파크'].forEach(val => {
                const opt = document.createElement('option');
                opt.value = val === '조직 선택' ? '' : val;
                opt.text = val;
                orgSelect.appendChild(opt);
            });
            orgSelect.value = emp.org || '';
            orgSelect.addEventListener('change', (e) => {
                tempEmployeeConfigList[index].org = e.target.value;
            });

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = '사원명';
            nameInput.value = emp.name;
            nameInput.addEventListener('input', (e) => {
                tempEmployeeConfigList[index].name = e.target.value;
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.innerHTML = '×';
            removeBtn.type = 'button';
            removeBtn.addEventListener('click', () => {
                tempEmployeeConfigList.splice(index, 1);
                renderEmployeeManager();
            });

            row.appendChild(orgSelect);
            row.appendChild(nameInput);
            row.appendChild(removeBtn);
            employeeListContainer.appendChild(row);
        });
    }

    // 초기 실행
    renderEmployeeManager();

    if (addEmployeeBtn) {
        addEmployeeBtn.addEventListener('click', () => {
            tempEmployeeConfigList.push({ org: "", name: "" });
            renderEmployeeManager();
            employeeListContainer.scrollTop = employeeListContainer.scrollHeight;
        });
    }

    // 날짜 설정
    const today = new Date();
    reportDateInput.value = today.toISOString().split('T')[0];

    function updateAndProcessData(returnMatrix = false) {
        if (attendanceFilesMap.size === 0) {
            // Check if we have cloud data proxy, leave data, or preemptive supplements
            const hasPreemptive = Object.keys(preemptiveSupplements || {}).length > 0;
            if (currentLeaveData || (attendanceFilesMap.get('Cloud_Data') && attendanceFilesMap.get('Cloud_Data').length > 0) || hasPreemptive) {
                const matrix = processMatrixData([]);
                if (returnMatrix) return matrix;
            } else {
                // 둘 다 없으면 화면 지우기
                reportContainer.innerHTML = '';
                reportContainer.classList.add('hidden');
                if (verifyTbody) verifyTbody.innerHTML = '';
                if (returnMatrix) return null;
            }
            return;
        }
        const allData = [];
        attendanceFilesMap.forEach(data => allData.push(...data));
        const matrix = processMatrixData(allData);
        if (returnMatrix) return matrix;
    }

    function handleFiles(files) {
        let loadedCount = 0;
        const fileArray = Array.from(files);
        fileArray.forEach(file => {
            if (!file.name.match(/\.(xlsx|xls|csv)$/)) {
                loadedCount++;
                return;
            }
            const reader = new FileReader();
            reader.onload = async (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const jsonData = normalizeRows(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" }));

                attendanceFilesMap.set(file.name, jsonData);
                loadedCount++;

                if (loadedCount === fileArray.length) {
                    fileListAttendance.innerHTML = Array.from(attendanceFilesMap.keys())
                        .map(name => `<div class="file-item"><span class="file-name">✓ ${name}</span></div>`)
                        .join('');
                    dropZoneAttendance.classList.add('loaded');
                    const matrix = updateAndProcessData(true);
                    
                    // [추가] 클라우드 자동 저장 및 데이터 동기화
                    fileArray.forEach(f => uploadFileToStorage(f, 'attendance'));
                    await autoSyncToCloud(matrix);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    dropZoneAttendance.addEventListener('click', () => fileInputAttendance.click());
    dropZoneAttendance.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneAttendance.classList.add('dragover'); });
    dropZoneAttendance.addEventListener('dragleave', () => dropZoneAttendance.classList.remove('dragover'));
    dropZoneAttendance.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZoneAttendance.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    });
    fileInputAttendance.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFiles(e.target.files);
    });

    // [NEW] 파일 3: 휴가 내역 처리 전용 셋업
    if (dropZoneLeave && fileInputLeave) {
        dropZoneLeave.addEventListener('click', () => fileInputLeave.click());
        dropZoneLeave.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneLeave.classList.add('dragover'); });
        dropZoneLeave.addEventListener('dragleave', () => dropZoneLeave.classList.remove('dragover'));
        dropZoneLeave.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZoneLeave.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) handleLeaveFile(e.dataTransfer.files[0], dropZoneLeave, fileStatusLeave);
        });
        fileInputLeave.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleLeaveFile(e.target.files[0], dropZoneLeave, fileStatusLeave);
        });
    }

    function normalizeRows(rawData) {
        if (!rawData || rawData.length === 0) return rawData;

        const firstRow = rawData[0];
        const headers = Object.keys(firstRow);

        // [NEW] 로그 형태의 데이터 처리 (발생시각, 이름 기반)
        if (headers.includes('발생시각') && !headers.includes('출근')) {
            const results = [];
            rawData.forEach(row => {
                const name = String(row['이름'] || "").trim();
                const fullTime = String(row['발생시각'] || "").trim();
                const shift = String(row['근무조'] || "").trim();
                const status = String(row['상태'] || "").trim(); // 상태 확인

                if (!name || !fullTime) return;

                const [date, time] = fullTime.split(' ');
                if (date && time) {
                    let inTimeParam = "";
                    let outTimeParam = "";

                    if (status.includes('출근')) {
                        inTimeParam = time;
                    } else if (status.includes('퇴근')) {
                        outTimeParam = time;
                    } else {
                        // '출입' 등 기타 상태는 출근 보조로만 사용 (퇴근 X)
                        inTimeParam = time;
                    }

                    results.push({
                        '날짜': date,
                        '이름': name,
                        '출근': inTimeParam,
                        '퇴근': outTimeParam,
                        '근무조': shift
                    });
                }
            });
            return results;
        }

        // 기존 행 기반 데이터 처리 (Matrix Style)
        const canonicalMap = {};
        const findAndMap = (canonical, tests) => {
            const found = tests.find(t => headers.some(h => t(h)));
            if (found) {
                const src = headers.find(h => found(h));
                if (src && src !== canonical) canonicalMap[src] = canonical;
            }
        };

        findAndMap('날짜', [h => h === '날짜', h => h.includes('날짜') || h.includes('일자')]);
        findAndMap('이름', [h => h === '이름', h => h.includes('이름') || h.includes('성명') || h.includes('사원명')]);
        findAndMap('출근', [h => h === '출근', h => h === '출', h => h.includes('출근') && (h.includes('시간') || h.includes('시각')), h => h.includes('출근(지문)')]);
        findAndMap('퇴근', [h => h === '퇴근', h => h === '퇴', h => h.includes('퇴근') && (h.includes('시간') || h.includes('시각')), h => h.includes('퇴근(지문)')]);
        findAndMap('근무조', [h => h === '근무조', h => h.includes('근무조'), h => h === '조']);

        // [추가] '출입(지문)' 컬럼 처리
        const fingerprintEnterKey = headers.find(h => h.includes('출입(지문)'));

        return rawData.map(row => {
            const newRow = Object.assign({}, row);
            Object.entries(canonicalMap).forEach(([src, dst]) => {
                if (src in newRow && !(dst in newRow)) newRow[dst] = newRow[src];
            });
            // '출입(지문)' 보조 처리: 출근이 비어있을 때만 지문 기록으로 채워줌
            if (fingerprintEnterKey && row[fingerprintEnterKey]) {
                if (!newRow['출근']) newRow['출근'] = row[fingerprintEnterKey];
            }
            return newRow;
        });
    }

    function handleFileForSlot(file, slotIndex, dropZone, statusEl) {
        if (!file.name.match(/\.(xlsx|xls|csv)$/)) {
            alert('엑셀 파일을 업로드해주세요.');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonData = normalizeRows(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" }));

            if (slotIndex === 1) currentJsonData1 = jsonData;
            else currentJsonData2 = jsonData;

            dropZone.classList.add('loaded');
            if (statusEl) statusEl.textContent = `✓ ${file.name}`;

            currentJsonData = [...(currentJsonData1 || []), ...(currentJsonData2 || [])];
            if (currentJsonData.length > 0) {
                const matrix = updateAndProcessData(true);
                
                // [추가] 클라우드 자동 저장 및 데이터 동기화
                uploadFileToStorage(file, 'attendance');
                await autoSyncToCloud(matrix);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function handleLeaveFile(file, dropZone, statusEl) {
        if (!file.name.match(/\.(xlsx|xls|csv)$/)) {
            alert('엑셀 파일을 업로드해주세요.');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            // header: 1로 가져와 헤더가 밀리거나 없는 경우에도 유연하게 대처
            const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

            // 1. 헤더 행 찾기 (상위 10개 행 대상)
            let bestHeaderIdx = 0;
            let maxMatches = -1;
            const keyKeywords = ['이름', '성명', '시작', '종료', '상태', '결재'];

            for (let i = 0; i < Math.min(10, rawData.length); i++) {
                const row = rawData[i];
                if (!Array.isArray(row)) continue;
                const matches = row.filter(v => keyKeywords.some(k => String(v).includes(k))).length;
                if (matches > maxMatches) {
                    maxMatches = matches;
                    bestHeaderIdx = i;
                }
            }
            const headerRow = rawData[bestHeaderIdx] || [];
            const findColIndex = (keywords) => headerRow.findIndex(v => keywords.some(k => String(v).includes(k)));

            const nameIdx = findColIndex(['이름', '성명', '사원명']);
            const startIdx = findColIndex(['휴가 시작일', '시작일', '시작']);
            const endIdx = findColIndex(['휴가 종료일', '종료일', '종료']);
            const typeIdx = findColIndex(['항목', '종류', '구분', '휴가구분']);
            const daysIdx = findColIndex(['사용시간(일)', '일수', '사용일']);
            const statusIdx = findColIndex(['처리상태', '문서상태', '결재', '상태', '결재상태']);

            // 휴가 엑셀 파싱
            currentLeaveData = rawData.map((row, rowIndex) => {
                if (!Array.isArray(row) || rowIndex <= bestHeaderIdx) return null;

                const rowValues = row.map(v => String(v).trim());

                // 2중 필터링: 상태 확인 로직 강화
                const status = (statusIdx !== -1) ? rowValues[statusIdx] : "";

                if (statusIdx !== -1) {
                    // 상태 컬럼이 있을 때: '승인' 또는 '완료'가 기본 키워드이며, '대기', '취소', '반려', '삭제' 등이 없어야 함
                    if (status !== "") {
                        // 상태 단어가 발견되었을 때: 취소/반려/삭제가 포함되면 제외 (대기는 검증을 위해 유지)
                        const isRejected = status.includes("취소") || status.includes("반려") || status.includes("삭제");
                        if (isRejected) return null;

                        // 명시적으로 승인/완료가 아니고, 기타 다른 텍스트라면 패스하지만, 보통 위에서 걸러짐
                    }
                } else {
                    // 상태 컬럼이 없을 때만 행 전체에서 취소 키워드 검색
                    const hasCancelKeyword = rowValues.some(v => v.includes("취소") || v.includes("반려") || v.includes("삭제"));
                    if (hasCancelKeyword) return null;
                }

                // 1. 이름 찾기
                let rawName = (nameIdx !== -1) ? rowValues[nameIdx] : rowValues.find(v => {
                    const isHangul = /^[가-힣]{2,4}$/.test(v);
                    const isDept = v.endsWith('팀') || v.endsWith('부') || v.endsWith('과') || v.endsWith('사');
                    return isHangul && !isDept;
                });
                let name = normalizeName(rawName);

                // 2. 시작일/종료일 찾기
                let start = "";
                let end = "";

                if (startIdx !== -1 && row[startIdx] && rowIndex > 0) {
                    start = row[startIdx];
                    end = (endIdx !== -1 && row[endIdx]) ? row[endIdx] : start;
                } else {
                    // 헤더로 못 찾으면 행 전체에서 날짜 후보들 다 찾기
                    const dateCandidates = [];
                    row.forEach((v, idx) => {
                        if (typeof v === 'number' && v > 40000 && v < 60000) dateCandidates.push(v);
                        else if (typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}\.\d{2}\.\d{2}$/.test(v))) dateCandidates.push(v);
                    });

                    if (dateCandidates.length > 0) {
                        // 정렬하여 가장 빠른 날을 시작, 가장 늦은 날을 종료로
                        const timeValues = dateCandidates.map(v => (typeof v === 'number') ? v : new Date(v.replace(/\./g, '-')).getTime() / 86400000 + 25569);
                        const minIdx = timeValues.indexOf(Math.min(...timeValues));
                        const maxIdx = timeValues.indexOf(Math.max(...timeValues));
                        start = dateCandidates[minIdx];
                        end = dateCandidates[maxIdx];
                    }
                }

                // 3. 휴가 종류 찾기
                const typeKeywords = ['연차', '반차', '오전반차', '오후반차', '조퇴', '외출', '경조', '휴가', '공가', '병가', '청원', '대체', '포상', '출장'];
                let type = (typeIdx !== -1) ? rowValues[typeIdx] : "";

                // 찾은 타입값이 실제 휴가 키워드 중 하나를 포함하는지 확인 (잘못된 컬럼 방지), 아니면 휴리스틱 재검색
                if (!typeKeywords.some(k => type.includes(k))) {
                    const fallbackType = rowValues.find(v => typeKeywords.some(k => v.includes(k)));
                    if (fallbackType) type = fallbackType;
                }

                // 4. 일수 찾기 (기본 1)
                let days = 1;
                const dayVal = (daysIdx !== -1 && rowIndex > 0) ? rowValues[daysIdx] : rowValues.find(v => /^\d+(\.\d+)?$/.test(v) && parseFloat(v) > 0 && parseFloat(v) <= 1.5);
                if (dayVal) days = parseFloat(dayVal);

                if (name && start) {
                    return {
                        name: name,
                        start: start,
                        end: end,
                        type: type,
                        days: days,
                        status: status, // 상태 추가
                        raw: JSON.stringify(row)
                    };
                }
                return null;
            }).filter(d => d !== null);

            dropZone.classList.add('loaded');
            if (statusEl) statusEl.textContent = `✓ ${file.name}`;

            if (attendanceFilesMap.size > 0 || (currentJsonData && currentJsonData.length > 0)) {
                const matrix = updateAndProcessData(true);
                
                // [추가] 클라우드 자동 저장 및 데이터 동기화
                uploadFileToStorage(file, 'leave');
                await autoSyncToCloud(matrix);
            }
        };
        reader.readAsArrayBuffer(file);
    }


    function processMatrixData(rows) {
        const recordsMap = {};
        const uniqueDates = new Set();

        // [수동] 날짜 오프셋을 적용한 가상 데이터 생성
        const effectiveRows = rows.map(row => {
            let jsDate = null;
            if (typeof row["날짜"] === 'number') jsDate = new Date(Math.round((row["날짜"] - 25569) * 86400 * 1000));
            else if (row["날짜"]) jsDate = new Date(String(row["날짜"]).split(' ')[0]);

            if (!jsDate || isNaN(jsDate)) return row;

            const fDate = jsDate.toISOString().split('T')[0];
            const name = normalizeName(row["이름"]);
            const key = `${name}_${fDate}`;

            if (manualEarlyPunches[key]) {
                const inTimeRaw = cleanTime(row["출근"]);
                const outTimeRaw = cleanTime(row["퇴근"]);
                const mode = manualEarlyPunches[key]; // "shift" or "forceIn" or true

                if (mode === "shift" || mode === true) {
                    // 새벽 시간(06:00 이전)인 경우만 날짜를 시프팅함
                    if ((inTimeRaw && inTimeRaw < '06:00') || (outTimeRaw && outTimeRaw < '06:00')) {
                        const prevDate = new Date(jsDate);
                        prevDate.setDate(prevDate.getDate() - 1);
                        const newRow = Object.assign({}, row);
                        newRow["날짜"] = prevDate.toISOString().split('T')[0];

                        // [추가] 01:00 -> 25:00 형태로 변환 (24시간 합산 처리)
                        const expandTime = (t) => {
                            if (t && t < '06:00') {
                                const [h, m] = t.split(':');
                                return (parseInt(h) + 24) + ":" + m;
                            }
                            return t;
                        };
                        if (inTimeRaw && inTimeRaw < '06:00') newRow["출근"] = expandTime(inTimeRaw);
                        if (outTimeRaw && outTimeRaw < '06:00') newRow["퇴근"] = expandTime(outTimeRaw);

                        return newRow;
                    }
                } else if (mode === "forceIn") {
                    if (outTimeRaw && outTimeRaw < '06:00') {
                        const newRow = Object.assign({}, row);
                        newRow["출근"] = outTimeRaw;
                        newRow["퇴근"] = "";
                        return newRow;
                    }
                }
            }
            return row;
        });

        effectiveRows.forEach(row => {
            let jsDate = null;
            if (typeof row["날짜"] === 'number') jsDate = new Date(Math.round((row["날짜"] - 25569) * 86400 * 1000));
            else if (row["날짜"]) jsDate = new Date(String(row["날짜"]).split(' ')[0]);

            if (jsDate && !isNaN(jsDate)) {
                const fDate = jsDate.toISOString().split('T')[0];
                // 주말 또는 공휴일 제외
                if (jsDate.getDay() !== 0 && jsDate.getDay() !== 6 && !isHoliday(fDate)) {
                    const name = normalizeName(row["이름"]);
                    const inTime = cleanTime(row["출근"]);
                    const outTime = cleanTime(row["퇴근"]);
                    const shiftStr = String(row["근무조"] || "");
                    const cloudReason = row["비고"] || row["reason"] || ""; // [추가] 클라우드에서 복구된 사유

                    // [수정] 출퇴근 기록이 없더라도 사유(일반 휴가 등)가 있으면 데이터에 포함
                    if (name && (inTime || outTime || cloudReason)) {
                        uniqueDates.add(fDate);
                        if (!recordsMap[name]) recordsMap[name] = {};

                        const existing = recordsMap[name][fDate] || { inTime: "", outTime: "", shiftStart: "" };

                        const mergedIn = (inTime && (!existing.inTime || inTime < existing.inTime)) ? inTime : existing.inTime;
                        const mergedOut = (outTime && (!existing.outTime || outTime > existing.outTime)) ? outTime : existing.outTime;

                        let shiftStart = existing.shiftStart;
                        if (shiftStr.includes('-')) {
                            shiftStart = shiftStr.split('-')[0].trim();
                        }

                        // [추가] 클라우드 데이터에서 복구된 사유가 있으면 적용
                        const mergedReason = existing.reason || cloudReason;

                        recordsMap[name][fDate] = { inTime: mergedIn, outTime: mergedOut, shiftStart, reason: mergedReason };
                    }
                }
            }
        });

        // [NEW] 휴가 데이터 결합 로직
        if (currentLeaveData && currentLeaveData.length > 0) {
            currentLeaveData.forEach(lv => {
                const name = normalizeName(lv.name);
                const startNum = lv.start;
                const endNum = lv.end || startNum;

                if (!name || isNaN(startNum)) return;

                const getJsDate = (num) => new Date(Math.round((num - 25569) * 86400 * 1000));
                const startDate = getJsDate(startNum);
                const endDate = getJsDate(endNum);

                let curDay = new Date(startDate);
                while (curDay <= endDate) {
                    const fDate = curDay.toISOString().split('T')[0];

                    const corrKey = `${name}_${fDate}`;
                    let corrData = manualCorrections[corrKey];
                    if (corrData === true) corrData = { in: true, out: true, leave: true };
                    else if (!corrData || typeof corrData !== 'object') corrData = { in: false, out: false, leave: false };

                    const status = lv.status || "";
                    const isManuallyApplied = status.includes("대기") && corrData.leave === true;

                    // 기본 승인 조건: (비어있거나 (승인/완료 포함 & 대기/반려/취소 포함 안함))
                    const isDefaultApproved = status === "" || ((status.includes("승인") || status.includes("완료")) && !status.includes("대기") && !status.includes("취소") && !status.includes("반려") && !status.includes("삭제"));
                    const isApproved = isDefaultApproved || isManuallyApplied;

                    if (curDay.getDay() !== 0 && curDay.getDay() !== 6 && !isHoliday(fDate) && isApproved) {
                        uniqueDates.add(fDate);

                        if (!recordsMap[name]) recordsMap[name] = {};
                        if (!recordsMap[name][fDate]) recordsMap[name][fDate] = { inTime: "", outTime: "", shiftStart: "" };

                        const type = lv.type || "";
                        const isHalfDay = lv.days < 1 || type.includes("반차");
                        const raw = lv.raw || "";

                        if (isHalfDay) {
                            const rec = recordsMap[name][fDate];
                            const actualIn = rec.inTime;
                            const shiftStart = rec.shiftStart;

                            let detectedAM = !raw.includes("오후"); // 기본값

                            // [수정] 출근 시간을 확인하여 근무조 기준 출근시간 +1시간 이내이면 '오후반차'로 적용 (오전에 일하고 오후에 퇴근함)
                            if (actualIn && shiftStart) {
                                const parseToMin = (t) => {
                                    const cleaned = t.replace(':', '').trim();
                                    if (cleaned.length >= 4) {
                                        return parseInt(cleaned.substring(0, 2)) * 60 + parseInt(cleaned.substring(2, 4));
                                    }
                                    return null;
                                };
                                const inMin = parseToMin(actualIn);
                                const startMin = parseToMin(shiftStart);

                                if (inMin !== null) {
                                    if (inMin < 720) {
                                        detectedAM = false; // 12시 이전에 왔으니 오후에 쉬는 것 (오후반차)
                                    } else {
                                        detectedAM = true; // 12시 이후에 왔으니 오전에 쉰 것 (오전반차)
                                    }
                                }
                            }

                            if (detectedAM) {
                                recordsMap[name][fDate].inTime = "반차";
                            } else {
                                recordsMap[name][fDate].outTime = "반차";
                            }
                        } else if (type.includes("연차")) {
                            recordsMap[name][fDate].inTime = "연차";
                        } else {
                            // 연차, 반차를 제외한 휴가 사항은 사유란에만 입력 (사용자 요청: 출퇴근란 공란)
                            recordsMap[name][fDate].reason = type;
                        }
                    }
                    curDay.setDate(curDay.getDate() + 1);
                }
            });
        }

        // [NEW] 수동으로 입력한 조치 사유 반영
        Object.entries(manualReasons).forEach(([key, reason]) => {
            const [name, fDate] = key.split('_');
            if (name && fDate && reason) {
                if (!recordsMap[name]) recordsMap[name] = {};
                if (!recordsMap[name][fDate]) recordsMap[name][fDate] = { inTime: "", outTime: "", shiftStart: "" };
                recordsMap[name][fDate].reason = (recordsMap[name][fDate].reason ? recordsMap[name][fDate].reason + ", " : "") + reason;
            }
        });

        // [NEW] 선제적 보완(사전 등록) 사유 반영 제거 (관리자 확인 전에는 보고서에 미노출)
        // Object.entries(preemptiveSupplements || {}).forEach(([key, reason]) => { ... });

        // [NEW] 기간 내 모든 평일을 기본 날짜셋으로 구성 (기록이 하나도 없는 날짜도 이상근태로 잡기 위해)
        const startInput = document.getElementById('report-period-start');
        const endInput = document.getElementById('report-period-end');
        const startBound = startInput ? startInput.value : "";
        const endBound = endInput ? endInput.value : "";

        if (startBound && endBound) {
            let cur = new Date(startBound);
            const last = new Date(endBound);
            while (cur <= last) {
                const fDate = cur.toISOString().split('T')[0];
                if (cur.getDay() !== 0 && cur.getDay() !== 6 && !isHoliday(fDate)) {
                    uniqueDates.add(fDate);
                }
                cur.setDate(cur.getDate() + 1);
            }
        }

        let sortedDates = Array.from(uniqueDates).sort();

        if (startBound && endBound) {
            sortedDates = sortedDates.filter(d => d >= startBound && d <= endBound);
        }

        currentUniqueDates = new Set(sortedDates); // [추가] 검증 로직에서 사용하기 위해 전역 변수에 저장
        const manualNames = employeeConfigList.map(e => e.name.trim()).filter(n => n.length > 0);
        const finalNames = manualNames.length > 0 ? manualNames : Object.keys(recordsMap).sort();

        const chunks = [];
        sortedDates.forEach(dt => {
            const jsDt = new Date(dt);
            const key = `${jsDt.getFullYear()}-${jsDt.getMonth() + 1}-P${jsDt.getDate() <= 15 ? 1 : 2}`;
            if (!chunks.length || chunks[chunks.length - 1].key !== key) chunks.push({ key, dates: [] });
            chunks[chunks.length - 1].dates.push(dt);
        });

        // --- 이상 근태 글로벌 계산 (버튼 활성화 시) ---
        unconfirmedAnomaliesMap = {};
        if (showAnomaliesHighlight) {
            const allData = [];
            attendanceFilesMap.forEach(data => allData.push(...data));
            const anomalies = calculateAnomalies(allData, { employeeConfigList, manualEarlyPunches, manualReasons, currentLeaveData, currentUniqueDates });// [추가]
            anomalies.forEach(a => {
                const corrKey = `${a.name}_${a.date}`;
                // 필터링된 날짜에 포함되는 경우에만 하이라이트 맵에 추가
                if (!currentUniqueDates.has(a.date)) return;

                let corrData = manualCorrections[corrKey];
                if (corrData === true) corrData = { in: true, out: true, leave: true };
                else if (!corrData || typeof corrData !== 'object') corrData = { in: false, out: false, leave: false };

                const hasInAnom = a.inAnom;
                const hasOutAnom = a.outAnom;
                const isPendingLeave = a.reason && a.reason.includes("승인대기");

                if ((hasInAnom && !corrData.in) || (hasOutAnom && !corrData.out) || (isPendingLeave && !corrData.leave)) {
                    unconfirmedAnomaliesMap[corrKey] = {
                        in: hasInAnom && !corrData.in,
                        out: hasOutAnom && !corrData.out,
                        leave: isPendingLeave && !corrData.leave
                    };
                }
            });
        }

        return renderMatrixReport(chunks.map(c => c.dates), finalNames, recordsMap, Array.from(uniqueDates));
    }

    // [추가] 이상 근태 계산 로직 (Ported from Dow_근태.html)

    function renderMatrixReport(dateChunks, names, recordsMap, uniqueDates) {
        reportContainer.innerHTML = '';
        const reportDate = reportDateInput.value;
        const weekdaysMap = ["일", "월", "화", "수", "목", "금", "토"];

        dateChunks.forEach((datesChunk) => {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'report-page';
            const refDate = new Date(datesChunk[0]);
            const yStr = refDate.getFullYear();
            const mStr = String(refDate.getMonth() + 1).padStart(2, '0');
            const isP1 = refDate.getDate() <= 15;
            const startDay = isP1 ? '01' : '16';
            const endDayStr = isP1 ? '15' : String(new Date(yStr, refDate.getMonth() + 1, 0).getDate()).padStart(2, '0');
            const autoPeriodText = `${yStr}-${mStr}-${startDay} ~ ${yStr}-${mStr}-${endDayStr}`;
            const periodText = autoPeriodText;

            pageDiv.innerHTML = `
        <div class="report-header">
            <h2>근태 보고서</h2>
            <div class="header-rightside">
                <div class="report-meta">
                    <div class="meta-item"><span class="meta-label">보고일자</span><span class="meta-value current-report-date-display"><u>${reportDate}</u></span></div>
                    <div class="meta-item"><span class="meta-label">종합기간</span><span class="meta-value"><u>${periodText}</u></span></div>
                </div>
                <table class="approval-table">
                    <tr><th>담당</th><th>부장</th><th>전무</th><th>대표이사</th><th>회장</th></tr>
                    <tr><td class="sign-space"></td><td class="sign-space"></td><td class="sign-space"></td><td class="sign-space"></td><td class="sign-space"></td></tr>
                    <tr><td class="sign-bottom"></td><td class="sign-bottom"></td><td class="sign-bottom"></td><td class="sign-bottom"></td><td class="sign-bottom"></td></tr>
                </table>
            </div>
        </div>
    `;

            const table = document.createElement('table');
            table.className = 'matrix-table';
            let theadHtml = `<thead><tr><th colspan="2" class="sticky-col corner-cell">일자</th>`;

            // [수정] 실제 데이터가 있는 날짜만 렌더링하도록 루프 변경 (빈 열 삭제)
            datesChunk.forEach(dt => {
                const d = new Date(dt);
                theadHtml += `<th class="th-dategroup">${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}<br>(${weekdaysMap[d.getDay()]})</th>`;
            });
            theadHtml += `</tr></thead>`;

            let tbodyHtml = `<tbody>`;
            names.forEach(name => {
                const recs = recordsMap[name] || {};
                tbodyHtml += `<tr class="internal-row"><td rowspan="3" class="sticky-col td-name"><strong>${name}</strong></td><td class="sticky-col td-label label-in">출근</td>`;
                datesChunk.forEach(dt => {
                    const corrKey = `${name}_${dt}`;
                    let corrData = manualCorrections[corrKey];
                    if (corrData === true) corrData = { in: true, out: true };
                    else if (!corrData || typeof corrData !== 'object') corrData = { in: false, out: false };

                    const isConfirmedIn = corrData.in === true;
                    let val = (recs[dt] || {}).inTime || '';

                    const displayVal = (isConfirmedIn && val && val !== '연차' && val !== '반차') ? `✓ ${val}` : val;
                    let cls = '';
                    if (val === '연차') cls = 'leave-annual';
                    else if (val === '반차') cls = 'leave-half';
                    else if (isConfirmedIn) cls = 'confirmed-cell';

                    // [추가] 이상 근태 하이라이트
                    if (showAnomaliesHighlight && unconfirmedAnomaliesMap[corrKey]?.in) {
                        cls += ' anomaly-highlight';
                    }

                    tbodyHtml += `<td class="${cls}">${displayVal}</td>`;
                });
                tbodyHtml += `</tr><tr class="internal-row"><td class="sticky-col td-label label-out">퇴근</td>`;
                datesChunk.forEach(dt => {
                    const corrKey = `${name}_${dt}`;
                    let corrData = manualCorrections[corrKey];
                    if (corrData === true) corrData = { in: true, out: true };
                    else if (!corrData || typeof corrData !== 'object') corrData = { in: false, out: false };

                    const isConfirmedOut = corrData.out === true;
                    let val = (recs[dt] || {}).outTime || '';

                    const displayVal = (isConfirmedOut && val && val !== '연차' && val !== '반차') ? `✓ ${val}` : val;
                    let cls = '';
                    if (val === '연차') cls = 'leave-annual';
                    else if (val === '반차') cls = 'leave-half';
                    else if (isConfirmedOut) cls = 'confirmed-cell';

                    // [추가] 이상 근태 하이라이트
                    if (showAnomaliesHighlight && unconfirmedAnomaliesMap[corrKey]?.out) {
                        cls += ' anomaly-highlight';
                    }

                    tbodyHtml += `<td class="${cls}">${displayVal}</td>`;
                });
                tbodyHtml += `</tr><tr class="employee-border-bottom"><td class="sticky-col td-label label-reason">사유</td>`;
                let r_idx = 0;
                while (r_idx < datesChunk.length) {
                    const dt = datesChunk[r_idx];
                    const currentReason = (recs[dt] || {}).reason || '';
                    let span = 1;

                    // 빈 사유가 아니고(연속될 가치가 있는 경우) 다음 날짜들과 사유가 같은지 확인
                    if (currentReason !== '') {
                        while (r_idx + span < datesChunk.length) {
                            const nextDt = datesChunk[r_idx + span];
                            const nextReason = (recs[nextDt] || {}).reason || '';
                            if (nextReason === currentReason) {
                                span++;
                            } else {
                                break;
                            }
                        }
                    }

                    if (span > 1) {
                        tbodyHtml += `<td class="time-cell reason-cell" colspan="${span}">${currentReason}</td>`;
                        r_idx += span;
                    } else {
                        tbodyHtml += `<td class="time-cell reason-cell">${currentReason}</td>`;
                        r_idx++;
                    }
                }
                tbodyHtml += `</tr>`;
            });
            tbodyHtml += `</tbody>`;

            table.innerHTML = theadHtml + tbodyHtml;
            pageDiv.appendChild(table);
            reportContainer.appendChild(pageDiv);
        });
        reportContainer.classList.remove('hidden');

        return { recordsMap, names, uniqueDates: Array.from(uniqueDates) };
    }

    const startInput = document.getElementById('report-period-start');
    const endInput = document.getElementById('report-period-end');
    if (startInput && endInput) {
        const handler = () => updateAndProcessData();
        startInput.addEventListener('change', handler);
        endInput.addEventListener('change', handler);
    }

    // ----- 검증(Verification) 로직 (그룹화 및 일괄 확인 추가) -----
    let selectedAnomalyKeys = new Set();
    let foldedGroups = new Set();
    if (verifyBtn) {
        const groupSelect = document.getElementById('verify-group-select');
        const bulkConfirmBtn = document.getElementById('bulk-confirm-btn');
        const allCheckbox = document.getElementById('verify-all-checkbox');

        if (groupSelect) {
            groupSelect.onchange = () => {
                foldedGroups.clear();
                verifyBtn.click();
            };
        }

        if (allCheckbox) {
            allCheckbox.onchange = (e) => {
                const isChecked = e.target.checked;
                const rowCheckboxes = verifyTbody.querySelectorAll('.row-checkbox');
                rowCheckboxes.forEach(cb => {
                    cb.checked = isChecked;
                    const key = cb.getAttribute('data-key');
                    if (isChecked) selectedAnomalyKeys.add(key);
                    else selectedAnomalyKeys.delete(key);
                });
            };
        }

        if (bulkConfirmBtn) {
            bulkConfirmBtn.onclick = () => {
                if (selectedAnomalyKeys.size === 0) {
                    alert('확인할 항목을 먼저 선택해주세요.');
                    return;
                }
                if (!confirm(`선택한 ${selectedAnomalyKeys.size}건을 일괄 확인 처리하시겠습니까?`)) return;

                selectedAnomalyKeys.forEach(key => {
                    if (!manualCorrections[key] || typeof manualCorrections[key] !== 'object') {
                        manualCorrections[key] = { in: false, out: false, leave: false };
                    }
                    manualCorrections[key].in = true;
                    manualCorrections[key].out = true;
                    manualCorrections[key].leave = true;
                });

                localStorage.setItem('manualCorrections', JSON.stringify(manualCorrections));
                selectedAnomalyKeys.clear();
                if (allCheckbox) allCheckbox.checked = false;
                verifyBtn.click();
                updateAndProcessData();
                alert('일괄 확인 처리가 완료되었습니다.');
            };
        }

        if (bulkUnconfirmBtn) {
            bulkUnconfirmBtn.onclick = () => {
                if (selectedAnomalyKeys.size === 0) {
                    alert('해제할 항목을 먼저 선택해주세요.');
                    return;
                }
                if (!confirm(`선택한 ${selectedAnomalyKeys.size}건을 일괄 확인 해제하시겠습니까?`)) return;

                selectedAnomalyKeys.forEach(key => {
                    if (manualCorrections[key]) {
                        manualCorrections[key] = { in: false, out: false, leave: false };
                    }
                });

                localStorage.setItem('manualCorrections', JSON.stringify(manualCorrections));
                selectedAnomalyKeys.clear();
                if (allCheckbox) allCheckbox.checked = false;
                verifyBtn.click();
                updateAndProcessData();
                alert('일괄 확인 해제가 완료되었습니다.');
            };
        }

        // [추가] Supabase 동기화 버튼 핸들러
        if (syncToCloudBtn) {
            syncToCloudBtn.onclick = async () => {
                if (!supabase) {
                    alert('Supabase 설정(URL, Key)이 필요합니다. script.js 상단의 SUPABASE_URL과 SUPABASE_KEY를 입력해주세요.');
                    return;
                }
                if (selectedAnomalyKeys.size === 0) {
                    alert('소명 요청을 보낼 항목을 먼저 선택해주세요.');
                    return;
                }

                const combinedData = [];
                attendanceFilesMap.forEach(data => combinedData.push(...data));
                const anomalies = calculateAnomalies(combinedData);

                const toSync = [];
                selectedAnomalyKeys.forEach(key => {
                    const [name, date] = key.split('_');
                    const anomaly = anomalies.find(a => a.name === name && (a.originalDate || a.date) === date);
                    if (anomaly) {
                        toSync.push({
                            manager_key: key,
                            name: name,
                            date: date,
                            reason: anomaly.reason,
                            status: 'requested'
                        });
                    }
                });

                if (toSync.length === 0) return;

                if (!confirm(`선택한 ${toSync.length}건을 직원 소명 페이지로 전송하시겠습니까?`)) return;

                const { data, error } = await supabase
                    .from('attendance_anomalies')
                    .upsert(toSync, { onConflict: 'manager_key' });

                if (error) {
                    console.error('Sync Error:', error);
                    alert('전송 중 오류가 발생했습니다: ' + error.message);
                } else {
                    alert('선택한 항목이 성공적으로 전송되었습니다.');
                }
            };
        }

        if (fetchFromCloudBtn) {
            fetchFromCloudBtn.onclick = async () => {
                if (!supabase) {
                    alert('Supabase 설정(URL, Key)이 필요합니다.');
                    return;
                }

                if (!confirm('직원들이 입력한 소명 답변을 클라우드에서 가져오시겠습니까?')) return;

                const { data, error } = await supabase
                    .from('attendance_anomalies')
                    .select('manager_key, explanation')
                    .not('explanation', 'is', null);

                if (error) {
                    alert('데이터를 가져오는 중 오류가 발생했습니다: ' + error.message);
                    return;
                }

                let updateCount = 0;
                if (data && data.length > 0) {
                    data.forEach(item => {
                        if (item.explanation) {
                            employeeExplanations[item.manager_key] = item.explanation;
                            updateCount++;
                        }
                    });
                    localStorage.setItem('employeeExplanations', JSON.stringify(employeeExplanations));
                    updateAndProcessData();
                    verifyBtn.click();
                    alert(`${updateCount}건의 소명 답변을 성공적으로 가져왔습니다.\n(검증 창의 '직원 소명' 열에서 확인 가능합니다)`);
                } else {
                    alert('가져올 새로운 소명 답변이 없습니다.');
                }
            };
        }

        verifyBtn.addEventListener('click', () => {
            const combinedData = [];
            attendanceFilesMap.forEach(data => combinedData.push(...data));

            if (combinedData.length === 0) {
                alert('데이터를 먼저 업로드해주세요.');
                return;
            }

            const anomalies = calculateAnomalies(combinedData, {
                employeeConfigList,
                manualEarlyPunches,
                manualReasons,
                currentLeaveData,
                currentUniqueDates
            });
            const mode = groupSelect ? groupSelect.value : 'none';

            verifyTbody.innerHTML = '';
            if (allCheckbox) allCheckbox.checked = false;

            if (anomalies.length === 0) {
                verifyTbody.parentElement.classList.add('hidden');
                verifyEmptyMsg.classList.remove('hidden');
            } else {
                verifyTbody.parentElement.classList.remove('hidden');
                verifyEmptyMsg.classList.add('hidden');

                // 데이터 그룹화
                let groupedAnomalies = [];
                if (mode === 'none') {
                    groupedAnomalies = [{ groupTitle: null, items: anomalies.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)) }];
                } else {
                    const map = {};
                    anomalies.forEach(a => {
                        let gKey = "";
                        if (mode === 'date') gKey = a.date;
                        else if (mode === 'name') gKey = a.name;
                        else if (mode === 'reason') gKey = a.reason.replace(/\s*\(.*\)/, '').trim();

                        if (!map[gKey]) map[gKey] = [];
                        map[gKey].push(a);
                    });
                    Object.keys(map).sort().forEach(k => {
                        groupedAnomalies.push({ groupTitle: k, items: map[k] });
                    });
                }

                groupedAnomalies.forEach(group => {
                    if (group.groupTitle) {
                        const groupHeader = document.createElement('tr');
                        groupHeader.className = 'verify-group-header';
                        groupHeader.style.backgroundColor = '#f3f4f6';
                        groupHeader.style.fontWeight = 'bold';
                        groupHeader.style.cursor = 'pointer';
                        const isGroupFolded = foldedGroups.has(group.groupTitle);
                        groupHeader.innerHTML = `
                            <td style="padding: 8px;"><input type="checkbox" class="group-checkbox" data-group="${group.groupTitle}"></td>
                            <td colspan="7" style="padding: 8px; font-size: 0.9rem;">
                                <span class="fold-icon" style="margin-right: 8px;">${isGroupFolded ? '▶' : '▼'}</span>
                                ${group.groupTitle} (${group.items.length}건)
                            </td>
                        `;
                        verifyTbody.appendChild(groupHeader);

                        // 체크박스 클릭시는 전파 중지 (폴딩 방지)
                        groupHeader.querySelector('.group-checkbox').onclick = (e) => e.stopPropagation();
                        groupHeader.querySelector('.group-checkbox').onchange = (e) => {
                            const isChecked = e.target.checked;
                            const rowCbs = verifyTbody.querySelectorAll(`.row-checkbox[data-group="${group.groupTitle}"]`);
                            rowCbs.forEach(cb => {
                                cb.checked = isChecked;
                                const k = cb.getAttribute('data-key');
                                if (isChecked) selectedAnomalyKeys.add(k);
                                else selectedAnomalyKeys.delete(k);
                            });
                        };

                        // 헤더 클릭시 폴딩 토글
                        groupHeader.onclick = () => {
                            const icon = groupHeader.querySelector('.fold-icon');
                            const isNowExpanding = icon.textContent === '▶';
                            icon.textContent = isNowExpanding ? '▼' : '▶';

                            if (isNowExpanding) foldedGroups.delete(group.groupTitle);
                            else foldedGroups.add(group.groupTitle);

                            const rows = verifyTbody.querySelectorAll(`tr[data-group-row="${group.groupTitle}"]`);
                            rows.forEach(r => r.style.display = isNowExpanding ? '' : 'none');
                        };
                    }

                    group.items.forEach(a => {
                        const tr = document.createElement('tr');
                        const corrKey = `${a.name}_${a.originalDate || a.date}`;

                        if (!manualCorrections[corrKey] || typeof manualCorrections[corrKey] !== 'object') {
                            manualCorrections[corrKey] = (manualCorrections[corrKey] === true) ? { in: true, out: true, leave: true } : { in: false, out: false, leave: false };
                        }
                        const corrData = manualCorrections[corrKey];
                        const hasInAnom = a.inAnom;
                        const hasOutAnom = a.outAnom;
                        const isPendingLeave = a.reason.includes("승인대기");

                        const isFullyConfirmed = (hasInAnom ? corrData.in : true) && (hasOutAnom ? corrData.out : true) && (isPendingLeave ? corrData.leave : true);
                        const isPartiallyConfirmed = (hasInAnom && corrData.in) || (hasOutAnom && corrData.out) || (isPendingLeave && corrData.leave);

                        if (isFullyConfirmed) tr.classList.add('row-confirmed');

                        const isGroupFolded = foldedGroups.has(group.groupTitle);
                        tr.style.display = isGroupFolded ? 'none' : '';
                        tr.setAttribute('data-group-row', group.groupTitle || "");
                        let groupAttr = group.groupTitle ? `data-group="${group.groupTitle}"` : "";

                        tr.innerHTML = `
                            <td><input type="checkbox" class="row-checkbox" data-key="${corrKey}" ${groupAttr} ${selectedAnomalyKeys.has(corrKey) ? 'checked' : ''}></td>
                            <td>${a.date}</td>
                            <td><strong>${a.name}</strong></td>
                            <td>${a.shift}</td>
                            <td>${(a.inTime || a.outTime) ? `${a.inTime} ~ ${a.outTime}` : '<span style="color:#999">(기록 없음)</span>'}</td>
                            <td class="anomaly-reason" style="${isFullyConfirmed ? '' : 'color:#ef4444'}">${a.reason}</td>
                            <td class="employee-explanation" style="font-size: 0.82rem; color: #4F46E5; background-color: #f0f4ff; border: 1px solid #e0e7ff; border-radius: 4px; padding: 4px; line-height: 1.2;">
                                ${employeeExplanations[corrKey] || '-'}
                            </td>
                            <td>
                                <input type="text" class="manual-reason-input" 
                                    value="${manualReasons[corrKey] || ''}" 
                                    placeholder="사유 입력..."
                                    style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem;"
                                    data-key="${corrKey}">
                            </td>
                            <td>
                                <div class="verify-action-group">
                                    <button class="confirmation-btn ${isPendingLeave ? (corrData.leave ? 'confirmed' : '') : (isFullyConfirmed || isPartiallyConfirmed ? 'confirmed' : '')}" data-key="${corrKey}">
                                        ${isPendingLeave ? (corrData.leave ? '✓ 적용됨' : '적용하기') : (isFullyConfirmed ? '✓ 확인됨' : (isPartiallyConfirmed ? '✓ 일부확인' : '미확인'))}
                                    </button>
                                    ${(a.inTime !== '-' && a.inTime < '06:00') ? `
                                        <button class="shift-date-btn ${manualDateOffsets[corrKey] ? 'active' : ''}" data-key="${corrKey}" title="새벽 기록을 전날 퇴근으로 처리">
                                            ${manualDateOffsets[corrKey] ? '복구됨' : '전날로'}
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        `;

                        const cb = tr.querySelector('.row-checkbox');
                        cb.onchange = (e) => {
                            if (e.target.checked) selectedAnomalyKeys.add(corrKey);
                            else selectedAnomalyKeys.delete(corrKey);
                        };

                        const confirmBtn = tr.querySelector('.confirmation-btn');
                        confirmBtn.onclick = () => {
                            const key = confirmBtn.getAttribute('data-key');
                            const isCurrentlyConfirmed = (isPendingLeave ? corrData.leave : (isFullyConfirmed || isPartiallyConfirmed));

                            if (isPendingLeave) {
                                manualCorrections[key].leave = !manualCorrections[key].leave;
                            } else {
                                if (isCurrentlyConfirmed) {
                                    manualCorrections[key].in = false;
                                    manualCorrections[key].out = false;
                                    // [추가] 확인 취소 시 조치 사유도 함께 초기화
                                    delete manualReasons[key];
                                    localStorage.setItem('manualReasons', JSON.stringify(manualReasons));
                                } else {
                                    if (hasInAnom) manualCorrections[key].in = true;
                                    if (hasOutAnom) manualCorrections[key].out = true;

                                    // [추가] 소명 답변 자동 사유 반영 로직 (일관성 유지)
                                    const rawExp = employeeExplanations[key];
                                    if (rawExp) {
                                        const exps = rawExp.split(',').map(s => s.trim()).filter(s => s);
                                        if (exps.length === 1) {
                                            manualReasons[key] = exps[0].replace(/^\[사전\]\s*/, '');
                                        } else if (exps.length >= 2) {
                                            const abnormalExps = exps.filter(s => s !== '정상출근' && s !== '정상퇴근');
                                            if (abnormalExps.length === 0) manualReasons[key] = '정상근무';
                                            else if (abnormalExps.length === 1) manualReasons[key] = abnormalExps[0].replace(/^\[사전\]\s*/, '');
                                        }
                                        localStorage.setItem('manualReasons', JSON.stringify(manualReasons));
                                    }
                                }
                            }
                            localStorage.setItem('manualCorrections', JSON.stringify(manualCorrections));
                            verifyBtn.click();
                            updateAndProcessData();
                        };

                        const shiftBtn = tr.querySelector('.shift-date-btn');
                        if (shiftBtn) {
                            shiftBtn.onclick = () => {
                                const key = shiftBtn.getAttribute('data-key');
                                if (manualDateOffsets[key]) {
                                    delete manualDateOffsets[key];
                                } else {
                                    manualDateOffsets[key] = true;
                                }
                                localStorage.setItem('manualDateOffsets', JSON.stringify(manualDateOffsets));
                                verifyBtn.click();
                                updateAndProcessData();
                            };
                        }

                        const reasonInput = tr.querySelector('.manual-reason-input');
                        reasonInput.oninput = (e) => {
                            const key = reasonInput.getAttribute('data-key');
                            manualReasons[key] = e.target.value;
                            localStorage.setItem('manualReasons', JSON.stringify(manualReasons));
                            updateAndProcessData();
                        };

                        verifyTbody.appendChild(tr);
                    });
                });
            }
            verifyModal.classList.remove('hidden');
        });
    }

    // 공통 이벤트
    reportDateInput.addEventListener('change', (e) => {
        document.querySelectorAll('.current-report-date-display').forEach(el => el.textContent = e.target.value);
    });
    openManagerBtn.onclick = () => {
        // 모달을 열 때, 현재 저장된 설정 복사
        tempEmployeeConfigList = JSON.parse(JSON.stringify(employeeConfigList));
        renderEmployeeManager();
        employeeModal.classList.remove('hidden');
    };
    closeModalBtn.onclick = () => employeeModal.classList.add('hidden');

    // 저장 버튼 클릭 시 임시 설정을 실제 설정에 반영
    saveEmployeeBtn.onclick = () => {
        // 빈 이름의 사원 데이터는 제거
        employeeConfigList = JSON.parse(JSON.stringify(tempEmployeeConfigList.filter(emp => emp.name.trim() !== "")));

        // [추가] 브라우저 로컬 저장소에 저장
        localStorage.setItem('employeeConfigList', JSON.stringify(employeeConfigList));

        employeeModal.classList.add('hidden');

        // 데이터가 이미 로드되어 있으면 즉시 보고서 갱신
        updateAndProcessData();
    };
    // 공휴일 이벤트
    openHolidayBtn.onclick = () => {
        tempHolidayConfigList = JSON.parse(JSON.stringify(holidayConfigList));
        renderHolidayManager();
        holidayModal.classList.remove('hidden');
    };
    closeHolidayModalBtn.onclick = () => holidayModal.classList.add('hidden');

    addHolidayBtn.onclick = () => {
        const date = newHolidayDateInput.value;
        if (!date) return;
        if (tempHolidayConfigList.some(h => h.date === date)) {
            alert('이미 등록된 날짜입니다.');
            return;
        }
        tempHolidayConfigList.push({ date, name: "사용자 지정" });
        renderHolidayManager();
    };

    autoFetchHolidayBtn.onclick = async () => {
        const selectedYear = document.getElementById('holiday-year-select').value;
        if (!selectedYear) return;

        const loader = autoFetchHolidayBtn.querySelector('.loader');
        const btnText = autoFetchHolidayBtn.querySelector('.btn-text');

        // 로딩 표시
        loader.classList.remove('hidden');
        btnText.textContent = `${selectedYear}년 데이터 확인 중...`;
        autoFetchHolidayBtn.disabled = true;

        try {
            // 1. 외부 원격 데이터 시도 (hyunbinseo/holidays-kr)
            const response = await fetch('https://holidays.hyunbin.page/basic.json');
            if (!response.ok) throw new Error('Network response was not ok');

            const remoteData = await response.json();
            const yearData = remoteData[selectedYear];
            let fetchedCount = 0;

            if (yearData) {
                Object.entries(yearData).forEach(([date, names]) => {
                    const name = Array.isArray(names) ? names[0] : names;
                    if (!tempHolidayConfigList.some(h => h.date === date)) {
                        tempHolidayConfigList.push({ date, name });
                        fetchedCount++;
                    }
                });
            }

            if (fetchedCount > 0) {
                alert(`${selectedYear}년 공휴일 ${fetchedCount}건을 외부에서 성공적으로 가져왔습니다.`);
            } else {
                // 외부 데이터에 해당 연도가 없는 경우 내장 데이터 활용 (Fallback)
                const internalMatches = PREDEFINED_HOLIDAYS.filter(h => h.date.startsWith(selectedYear));
                let internalCount = 0;
                internalMatches.forEach(pre => {
                    if (!tempHolidayConfigList.some(h => h.date === pre.date)) {
                        tempHolidayConfigList.push(pre);
                        internalCount++;
                    }
                });

                if (internalCount > 0) {
                    alert(`외부 서버에 ${selectedYear}년 데이터가 없어 내장된 데이터를 활용해 ${internalCount}건을 추가했습니다.`);
                } else {
                    alert(`${selectedYear}년에 대한 공휴일 데이터가 코드나 서버에 존재하지 않습니다.`);
                }
            }
            renderHolidayManager();
        } catch (error) {
            console.error('Holiday fetch error:', error);
            // 에러 발생 시 내장 데이터로 Fallback
            const internalMatches = PREDEFINED_HOLIDAYS.filter(h => h.date.startsWith(selectedYear));
            let internalCount = 0;
            internalMatches.forEach(pre => {
                if (!tempHolidayConfigList.some(h => h.date === pre.date)) {
                    tempHolidayConfigList.push(pre);
                    internalCount++;
                }
            });

            if (internalCount > 0) {
                alert(`인터넷 연결 오류로 내장 데이터(${selectedYear}년)를 ${internalCount}건 불러왔습니다.`);
            } else {
                alert('공휴일 정보를 가져오지 못했습니다. 인터넷 연결을 확인하거나 나중에 다시 시도해주세요.');
            }
            renderHolidayManager();
        } finally {
            loader.classList.add('hidden');
            btnText.textContent = '공휴일 가져오기';
            autoFetchHolidayBtn.disabled = false;
        }
    };

    saveHolidayBtn.onclick = () => {
        holidayConfigList = JSON.parse(JSON.stringify(tempHolidayConfigList));
        localStorage.setItem('holidayConfigList', JSON.stringify(holidayConfigList));
        holidayModal.classList.add('hidden');
        updateAndProcessData();
    };

    closeVerifyBtn.onclick = () => verifyModal.classList.add('hidden');
    window.onclick = (e) => {
        if (e.target === employeeModal) employeeModal.classList.add('hidden');
        if (e.target === verifyModal) verifyModal.classList.add('hidden');
        if (e.target === holidayModal) holidayModal.classList.add('hidden');
    };
    printBtn.onclick = () => window.print();
});