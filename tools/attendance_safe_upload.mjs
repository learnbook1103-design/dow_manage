import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const SERVER_PATH = path.join(ROOT, 'server.js');
const BACKUP_ROOT = path.join(ROOT, 'backups');
const SOURCE_ROOT = 'C:\\Users\\dow\\Desktop\\근태_휴가';
const SOURCE_PERIOD_START = '2026-01-01';
const SOURCE_PERIOD_END = '2026-06-30';
const MISSING_ATTENDANCE_START = '2026-03-01';
const MISSING_ATTENDANCE_END = '2026-03-15';

const ATTENDANCE_FILES = [
  'dv_1월.xlsx',
  'dv_2월.xlsx',
  'dv_3월하반.xlsx',
  '4~6월 출입자료.xlsx',
  'vp_1-2월.csv',
  'vp_3월하반.csv',
  'vp_4-5월.csv',
  'vp_6월.csv',
];

const LEAVE_FILES = [
  '휴가_1-2월.xlsx',
  '휴가_3월.xlsx',
  '휴가_4-6월.xlsx',
];

const TABLES = [
  { name: 'attendance_records', order: 'manager_key', required: true },
  { name: 'attendance_anomalies', order: 'id', required: true },
  { name: 'attendance_supplements', order: 'id', required: true },
  { name: 'attendance_holidays', order: 'date', required: true },
  { name: 'employees', order: 'name', required: true },
  { name: 'attendance_reports', order: null, required: true },
  { name: 'approvals', order: 'id', required: true },
  { name: 'app_settings', order: null, required: true },
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\..+$/, 'Z');
}

async function createSupabaseClient() {
  const serverText = await fs.readFile(SERVER_PATH, 'utf8');
  const url = serverText.match(/const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  const key = serverText.match(/const SUPABASE_KEY\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (!url || !key) throw new Error('server.js에서 Supabase 연결 설정을 찾지 못했습니다.');
  const timedFetch = (input, init = {}) => fetch(input, {
    ...init,
    signal: AbortSignal.timeout(45_000),
  });
  return {
    url,
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: timedFetch },
    }),
  };
}

async function withRetries(label, operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`${label}: ${lastError?.message || lastError}`);
}

async function fetchAllRows(client, table, orderColumn) {
  const PAGE_SIZE = 1000;
  const rows = [];
  let expectedCount = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await withRetries(`${table} ${from}행부터 백업`, async () => {
      let query = client
        .from(table)
        .select('*', from === 0 ? { count: 'exact' } : undefined)
        .range(from, from + PAGE_SIZE - 1);
      if (orderColumn) query = query.order(orderColumn, { ascending: true });
      const result = await query;
      if (result.error) throw result.error;
      return result;
    });
    if (from === 0) expectedCount = page.count;
    rows.push(...(page.data || []));
    if (!page.data || page.data.length < PAGE_SIZE) break;
  }
  if (expectedCount !== null && rows.length !== expectedCount) {
    throw new Error(`${table} 백업 행 수 불일치: 조회 ${rows.length}, DB count ${expectedCount}`);
  }
  return { rows, expectedCount };
}

async function writeVerifiedJson(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, text, 'utf8');
  const readBack = await fs.readFile(filePath, 'utf8');
  if (sha256(readBack) !== sha256(text)) throw new Error(`${filePath} 백업 파일 검증 실패`);
  return { bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

async function createBackup() {
  const startedAt = new Date();
  const backupDir = path.join(BACKUP_ROOT, `attendance_preupload_${timestampForPath(startedAt)}`);
  await fs.mkdir(backupDir, { recursive: true });

  const { client, url } = await createSupabaseClient();
  const manifest = {
    format: 'dow-manage-supabase-json-backup-v1',
    purpose: 'attendance pre-upload safety backup',
    created_at: startedAt.toISOString(),
    project_url: url,
    tables: {},
  };

  for (const table of TABLES) {
    try {
      const { rows, expectedCount } = await fetchAllRows(client, table.name, table.order);
      const fileName = `${table.name}.json`;
      const verification = await writeVerifiedJson(path.join(backupDir, fileName), rows);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      manifest.tables[table.name] = {
        file: fileName,
        rows: rows.length,
        expected_count: expectedCount,
        columns,
        ...verification,
      };
      console.log(`BACKUP ${table.name} ${rows.length}`);
    } catch (error) {
      manifest.tables[table.name] = { error: error.message };
      if (table.required) {
        await writeVerifiedJson(path.join(backupDir, 'manifest.failed.json'), manifest);
        throw new Error(`필수 테이블 ${table.name} 백업 실패: ${error.message}`);
      }
    }
  }

  manifest.completed_at = new Date().toISOString();
  const manifestCheck = await writeVerifiedJson(path.join(backupDir, 'manifest.json'), manifest);
  const requiredFailures = TABLES.filter(t => t.required && manifest.tables[t.name]?.error);
  if (requiredFailures.length > 0) throw new Error(`필수 백업 실패: ${requiredFailures.map(t => t.name).join(', ')}`);
  console.log(`BACKUP_DIR ${backupDir}`);
  console.log(`MANIFEST_SHA256 ${manifestCheck.sha256}`);
  return backupDir;
}

async function loadSharedLogic() {
  const source = await fs.readFile(path.join(ROOT, 'shared_logic.js'), 'utf8');
  const sandbox = {
    XLSX,
    console: { log() {}, warn() {}, error: console.error },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.__logic = { normalizeName, cleanTime, expandShift, formatLocalDateValue, normalizeAttendanceDateValue, timeToMinutesForHalfDay, detectHalfDayIsAM, calculateAnomalies };`, sandbox);
  return sandbox.__logic;
}

function stripAccessLogReason(value) {
  return String(value || '')
    .replace(/(?:^|,\s*)출입기록 있음(?:\s*\([^)]*\))?/g, '')
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
}

function mergeReasons(...values) {
  const result = [];
  for (const value of values) {
    for (const item of stripAccessLogReason(value).split(',').map(v => v.trim()).filter(Boolean)) {
      if (!result.includes(item)) result.push(item);
    }
  }
  return result.join(', ');
}

function previousDateString(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function parseAttendanceDateTime(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      date: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
      time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`,
    };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return {
        date: `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`,
        time: `${String(parsed.H || 0).padStart(2, '0')}:${String(parsed.M || 0).padStart(2, '0')}:${String(Math.floor(parsed.S || 0)).padStart(2, '0')}`,
      };
    }
  }
  const match = String(value || '').trim().replace('T', ' ')
    .match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    date: `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`,
    time: `${String(match[4]).padStart(2, '0')}:${String(match[5]).padStart(2, '0')}:${String(match[6] || '00').padStart(2, '0')}`,
  };
}

function findHeaderRowIndex(rows, keywords, minMatches = 2) {
  let bestIndex = -1;
  let bestScore = 0;
  rows.slice(0, 12).forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const score = row
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .reduce((sum, cell) => sum + (keywords.some(keyword => cell.includes(keyword)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= minMatches ? bestIndex : -1;
}

function readFirstSheet(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`${path.basename(filePath)} 첫 번째 시트를 읽지 못했습니다.`);
  return sheet;
}

function parseAttendanceFile(filePath, logic) {
  const sheet = readFirstSheet(filePath);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIndex = findHeaderRowIndex(matrix, ['날짜', '일자', '이름', '성명', '사원명', '출근', '퇴근', '발생시각', '상태', '근무조']);
  if (headerIndex < 0) throw new Error(`${path.basename(filePath)} 헤더를 찾지 못했습니다.`);
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerIndex });
  const headers = Object.keys(rawRows[0] || {});

  if (headers.includes('발생시각') && !headers.includes('출근')) {
    const grouped = new Map();
    for (const row of rawRows) {
      const name = logic.normalizeName(row['이름']);
      const parsed = parseAttendanceDateTime(row['발생시각']);
      if (!name || !parsed) continue;
      const [hour, minute] = parsed.time.split(':').map(Number);
      const minutes = hour * 60 + minute;
      const bucket = minutes <= 299 ? 'previousOut' : minutes <= 719 ? 'in' : minutes <= 779 ? 'lunch' : 'out';
      const recordDate = bucket === 'previousOut' ? previousDateString(parsed.date) : parsed.date;
      const key = `${name}_${recordDate}`;
      if (!grouped.has(key)) grouped.set(key, { date: recordDate, name, shift: '', ins: [], lunches: [], outs: [] });
      const group = grouped.get(key);
      const shift = String(row['근무조'] || '').trim();
      if (shift && !group.shift) group.shift = shift;
      if (bucket === 'in') group.ins.push(parsed.time);
      else if (bucket === 'lunch') group.lunches.push(parsed.time);
      else if (bucket === 'out') group.outs.push(parsed.time);
      else group.outs.push(`${String(hour + 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${parsed.time.split(':')[2] || '00'}`);
    }
    const normalizedRows = [...grouped.values()].map(group => {
      group.ins.sort();
      group.lunches.sort();
      group.outs.sort();
      return {
        날짜: group.date,
        이름: group.name,
        출근: group.ins[0] || group.lunches[0] || '',
        퇴근: group.outs.at(-1) || group.lunches.at(-1) || '',
        근무조: group.shift,
        비고: '',
      };
    });
    return { file: path.basename(filePath), rawRows: rawRows.length, normalizedRows, format: 'event-log' };
  }

  const canonical = {};
  const mapFirst = (target, tests) => {
    for (const test of tests) {
      const source = headers.find(header => test(header));
      if (source) {
        canonical[source] = target;
        return;
      }
    }
  };
  mapFirst('날짜', [h => h === '날짜', h => h.includes('날짜') || h.includes('일자')]);
  mapFirst('이름', [h => h === '이름', h => h.includes('이름') || h.includes('성명') || h.includes('사원명')]);
  mapFirst('출근', [h => h === '출근', h => h === '출', h => h.includes('출근') && (h.includes('시간') || h.includes('시각')), h => h.includes('출입')]);
  mapFirst('퇴근', [h => h === '퇴근', h => h === '퇴', h => h.includes('퇴근') && (h.includes('시간') || h.includes('시각'))]);
  mapFirst('근무조', [h => h === '근무조', h => h.includes('근무조'), h => h === '조']);
  const reasonHeaders = headers.filter(header => ['비고', '부재', '예외', '사유'].some(keyword => header.includes(keyword)));
  const normalizedRows = rawRows.map(row => {
    const normalized = { ...row };
    for (const [source, target] of Object.entries(canonical)) {
      if (normalized[source] !== undefined && normalized[target] === undefined) normalized[target] = normalized[source];
    }
    if (normalized['근무조']) normalized['근무조'] = logic.expandShift(normalized['근무조']);
    let reason = '';
    for (const header of reasonHeaders) {
      const text = String(normalized[header] || '');
      if (text.includes('외근')) reason = mergeReasons(reason, '외근');
      if (text.includes('생일자')) reason = mergeReasons(reason, '생일');
    }
    normalized['비고'] = reason;
    return normalized;
  });
  return { file: path.basename(filePath), rawRows: rawRows.length, normalizedRows, format: 'matrix' };
}

function parseLeaveFile(filePath, logic) {
  const sheet = readFirstSheet(filePath);
  let range;
  if (sheet['!ref']) {
    range = XLSX.utils.decode_range(sheet['!ref']);
    range.s.r = 0;
    range.s.c = 0;
  }
  const rawData = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    range: range ? XLSX.utils.encode_range(range) : undefined,
  });
  const keywords = ['이름', '성명', '시작', '종료', '상태', '결재'];
  let bestHeaderIndex = -1;
  let maxMatches = 0;
  for (let index = 0; index < Math.min(10, rawData.length); index += 1) {
    const row = rawData[index];
    if (!Array.isArray(row)) continue;
    const matches = row.filter(value => keywords.some(keyword => String(value).includes(keyword))).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      bestHeaderIndex = index;
    }
  }
  const fixedLayout = bestHeaderIndex === -1 || maxMatches < 2;
  if (fixedLayout) bestHeaderIndex = -1;
  const header = fixedLayout ? [] : rawData[bestHeaderIndex];
  const findColumn = names => header.findIndex(value => names.some(name => String(value).includes(name)));
  const indexes = {
    name: fixedLayout ? 1 : findColumn(['이름', '성명', '사원명']),
    start: fixedLayout ? 4 : findColumn(['휴가 시작일', '시작일', '시작']),
    end: fixedLayout ? 5 : findColumn(['휴가 종료일', '종료일', '종료']),
    type: fixedLayout ? 6 : findColumn(['항목', '종류', '구분', '휴가구분']),
    days: fixedLayout ? 7 : findColumn(['사용시간(일)', '일수', '사용일']),
    status: fixedLayout ? 9 : findColumn(['처리상태', '문서상태', '결재', '상태', '결재상태']),
  };
  const leaves = [];
  let canceledRows = 0;
  let invalidRows = 0;
  rawData.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || rowIndex <= bestHeaderIndex) return;
    const texts = row.map(value => String(value ?? '').trim());
    let status = indexes.status >= 0 ? texts[indexes.status] : '';
    if (!status) status = texts.find(value => ['승인', '완료', '대기', '취소', '반려', '삭제'].some(keyword => value.includes(keyword))) || '';
    if (['취소', '반려', '삭제'].some(keyword => status.includes(keyword))) {
      canceledRows += 1;
      return;
    }
    const name = logic.normalizeName(indexes.name >= 0 ? texts[indexes.name] : '');
    const start = logic.normalizeAttendanceDateValue(indexes.start >= 0 ? row[indexes.start] : '');
    const end = logic.normalizeAttendanceDateValue(indexes.end >= 0 ? row[indexes.end] : row[indexes.start]);
    let type = indexes.type >= 0 ? texts[indexes.type] : '';
    const typeKeywords = ['연차', '반차', '오전반차', '오후반차', '조퇴', '외출', '경조', '휴가', '공가', '병가', '청원', '대체', '포상', '출장'];
    if (!typeKeywords.some(keyword => type.includes(keyword))) {
      type = texts.find(value => typeKeywords.some(keyword => value.includes(keyword))) || type;
    }
    const dayText = indexes.days >= 0 ? texts[indexes.days] : '';
    const days = Number.parseFloat(dayText) || 1;
    if (!name || !start) {
      if (texts.some(Boolean)) invalidRows += 1;
      return;
    }
    leaves.push({
      name,
      start,
      end: end || start,
      type,
      days,
      status,
      raw: JSON.stringify(row),
      source_file: path.basename(filePath),
    });
  });
  return { file: path.basename(filePath), rawRows: rawData.length, leaves, canceledRows, invalidRows };
}

function isActualPunch(value) {
  return /^\d{1,2}:\d{2}/.test(String(value || '').trim());
}

function isLeaveMarker(value) {
  const text = String(value || '');
  return text.includes('연차') || text.includes('반차');
}

function isBusinessDate(dateString, holidaySet) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || holidaySet.has(dateString)) return false;
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function dateRange(start, end) {
  const values = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last) {
    values.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return values;
}

function normalizeNullable(value) {
  return value === undefined || value === '' ? null : value;
}

const RECORD_FIELDS = [
  'manager_key', 'name', 'date', 'shift', 'in_time', 'out_time',
  'status_in', 'status_out', 'status_leave', 'manager_reason',
  'employee_explanation', 'early_punch_mode', 'is_anomalous', 'reason',
];

function recordPayload(record) {
  const result = {};
  for (const field of RECORD_FIELDS) result[field] = record[field] ?? (['status_in', 'status_out', 'status_leave', 'is_anomalous'].includes(field) ? false : null);
  result.manager_reason = result.manager_reason || '';
  result.employee_explanation = result.employee_explanation || '';
  result.early_punch_mode = result.early_punch_mode || '';
  result.reason = result.reason || '';
  return result;
}

function sameRecord(left, right) {
  return RECORD_FIELDS.every(field => {
    const leftValue = left?.[field] ?? (['status_in', 'status_out', 'status_leave', 'is_anomalous'].includes(field) ? false : null);
    const rightValue = right?.[field] ?? (['status_in', 'status_out', 'status_leave', 'is_anomalous'].includes(field) ? false : null);
    return leftValue === rightValue;
  });
}

async function readBackupTable(backupDir, table) {
  return JSON.parse(await fs.readFile(path.join(backupDir, `${table}.json`), 'utf8'));
}

async function sourceFileDetails() {
  const details = [];
  for (const file of [...ATTENDANCE_FILES, ...LEAVE_FILES]) {
    const fullPath = path.join(SOURCE_ROOT, file);
    const bytes = await fs.readFile(fullPath);
    const stat = await fs.stat(fullPath);
    details.push({ file, bytes: stat.size, modified_at: stat.mtime.toISOString(), sha256: sha256(bytes) });
  }
  return details;
}

function summarizeReasons(rows) {
  const summary = {};
  for (const row of rows) {
    const reason = String(row.reason || '(blank)');
    summary[reason] = (summary[reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')));
}

function proposalHash(operations) {
  const stable = {
    record_upserts: [...operations.recordUpserts].sort((a, b) => a.manager_key.localeCompare(b.manager_key, 'ko')),
    anomaly_upserts: [...operations.anomalyUpserts].sort((a, b) => a.manager_key.localeCompare(b.manager_key, 'ko')),
    anomaly_deletes: [...operations.anomalyDeletes].sort(),
  };
  return sha256(JSON.stringify(stable));
}

async function buildProposal(backupDir) {
  const logic = await loadSharedLogic();
  const [existingRecords, existingAnomalies, supplements, holidays, employees] = await Promise.all([
    readBackupTable(backupDir, 'attendance_records'),
    readBackupTable(backupDir, 'attendance_anomalies'),
    readBackupTable(backupDir, 'attendance_supplements'),
    readBackupTable(backupDir, 'attendance_holidays'),
    readBackupTable(backupDir, 'employees'),
  ]);
  const holidaySet = new Set(holidays.map(row => row.date).filter(Boolean));
  const existingByKey = new Map(existingRecords.map(row => [row.manager_key, row]));
  const existingAnomalyByKey = new Map(existingAnomalies.map(row => [row.manager_key, row]));
  const employeeConfigList = employees.map(row => ({
    org: row.org || '',
    name: logic.normalizeName(row.name),
    joinDate: row.join_date || '',
    leaveDate: row.leave_date || '',
    shift: row.shift || '',
  }));
  const employeeByName = new Map(employeeConfigList.map(row => [logic.normalizeName(row.name), row]));

  const attendanceParsed = ATTENDANCE_FILES.map(file => parseAttendanceFile(path.join(SOURCE_ROOT, file), logic));
  const leaveParsed = LEAVE_FILES.map(file => parseLeaveFile(path.join(SOURCE_ROOT, file), logic));
  const currentLeaveData = leaveParsed.flatMap(result => result.leaves);
  const recordsMap = new Map();
  const attendanceEligibleDates = new Set();
  const sourceNames = new Set();

  const ensureRecord = (name, date) => {
    const key = `${name}_${date}`;
    if (!recordsMap.has(key)) recordsMap.set(key, { name, date, inTime: '', outTime: '', shiftStart: '', reason: '' });
    return recordsMap.get(key);
  };

  for (const parsed of attendanceParsed) {
    for (const row of parsed.normalizedRows) {
      const date = logic.normalizeAttendanceDateValue(row['날짜']);
      const name = logic.normalizeName(row['이름']);
      if (!date || !name || date < SOURCE_PERIOD_START || date > SOURCE_PERIOD_END) continue;
      if (!isBusinessDate(date, holidaySet)) continue;
      attendanceEligibleDates.add(date);
      sourceNames.add(name);
      let inTime = logic.cleanTime(row['출근']);
      let outTime = logic.cleanTime(row['퇴근']);
      let shift = String(row['근무조'] || '');
      if (name === '박주연') shift = '0900-1800';
      if (!shift) shift = employeeByName.get(name)?.shift || '';
      const reason = stripAccessLogReason(row['비고'] || row.reason || '');
      if (reason && !isLeaveMarker(reason) && ['외부교육', '교육', '외근', '출장', '훈련', '파견', '현장'].some(keyword => reason.includes(keyword))) {
        if (isLeaveMarker(inTime)) inTime = '';
        if (isLeaveMarker(outTime)) outTime = '';
      }
      if (!inTime && !outTime && !reason) continue;
      const record = ensureRecord(name, date);
      if (inTime && (!record.inTime || inTime < record.inTime)) record.inTime = inTime;
      if (outTime && (!record.outTime || outTime > record.outTime)) record.outTime = outTime;
      if (shift) record.shiftStart = logic.expandShift(shift);
      record.reason = mergeReasons(record.reason, reason);
    }
  }

  const seedFromExisting = (name, date) => {
    const key = `${name}_${date}`;
    if (recordsMap.has(key)) return recordsMap.get(key);
    const existing = existingByKey.get(key);
    if (!existing) return ensureRecord(name, date);
    const seeded = {
      name,
      date,
      inTime: existing.in_time || '',
      outTime: existing.out_time || '',
      shiftStart: existing.shift || '',
      reason: stripAccessLogReason(existing.reason || ''),
    };
    recordsMap.set(key, seeded);
    return seeded;
  };

  for (const leave of currentLeaveData) {
    for (const date of dateRange(leave.start, leave.end || leave.start)) {
      if (date < SOURCE_PERIOD_START || date > SOURCE_PERIOD_END || !isBusinessDate(date, holidaySet)) continue;
      const key = `${leave.name}_${date}`;
      const existing = existingByKey.get(key);
      const status = leave.status || '';
      const manuallyApplied = status.includes('대기') && existing?.status_leave === true;
      const defaultApproved = status === '' || ((status.includes('승인') || status.includes('완료')) && !['대기', '취소', '반려', '삭제'].some(keyword => status.includes(keyword)));
      if (!defaultApproved && !manuallyApplied) continue;
      const record = seedFromExisting(leave.name, date);
      sourceNames.add(leave.name);
      const hasActual = isActualPunch(record.inTime) || isActualPunch(record.outTime);
      const isHalf = leave.days < 1 || leave.type.includes('반차');
      if (isHalf) {
        const detectedAM = logic.detectHalfDayIsAM(`${leave.type} ${leave.raw || ''}`, record.inTime, record.outTime);
        const inMinutes = logic.timeToMinutesForHalfDay(record.inTime);
        const outMinutes = logic.timeToMinutesForHalfDay(record.outTime);
        const singleLunchPunch = record.inTime && record.inTime === record.outTime && inMinutes !== null && inMinutes >= 720 && inMinutes <= 779;
        if (detectedAM) {
          record.inTime = '반차';
          if (record.outTime === '반차' || singleLunchPunch) record.outTime = '';
        } else {
          record.outTime = '반차';
          if (record.inTime === '반차' || singleLunchPunch) record.inTime = '';
        }
        void outMinutes;
      } else if (leave.type.includes('연차')) {
        if (!hasActual) {
          record.inTime = '연차';
          record.outTime = '';
        }
      } else if (leave.type) {
        record.reason = mergeReasons(record.reason, leave.type.includes('생일자') ? '생일' : leave.type);
      }
    }
  }

  const incomingRecords = [];
  for (const record of recordsMap.values()) {
    if (record.date < SOURCE_PERIOD_START || record.date > SOURCE_PERIOD_END) continue;
    const key = `${record.name}_${record.date}`;
    const existing = existingByKey.get(key);
    const incomingIn = normalizeNullable(record.inTime);
    const incomingOut = normalizeNullable(record.outTime);
    const proposed = recordPayload({
      manager_key: key,
      name: record.name,
      date: record.date,
      shift: normalizeNullable(record.shiftStart) || existing?.shift || null,
      in_time: incomingIn ?? existing?.in_time ?? null,
      out_time: incomingOut ?? existing?.out_time ?? null,
      status_in: existing?.status_in || false,
      status_out: existing?.status_out || false,
      status_leave: existing?.status_leave || false,
      manager_reason: existing?.manager_reason || '',
      employee_explanation: existing?.employee_explanation || '',
      early_punch_mode: existing?.early_punch_mode || '',
      is_anomalous: existing?.is_anomalous || false,
      reason: mergeReasons(existing?.reason || '', record.reason || ''),
    });
    incomingRecords.push(proposed);
  }

  const finalRecordsByKey = new Map(existingRecords.map(row => [row.manager_key, recordPayload(row)]));
  for (const record of incomingRecords) finalRecordsByKey.set(record.manager_key, record);

  const manualReasons = Object.fromEntries(existingRecords.map(row => [row.manager_key, row.manager_reason || '']));
  const manualEarlyPunches = Object.fromEntries(existingRecords.filter(row => row.early_punch_mode).map(row => [row.manager_key, row.early_punch_mode]));
  const preemptiveSupplements = Object.fromEntries(supplements.map(row => {
    const key = `${logic.normalizeName(row.name)}_${row.date}`;
    return [key, `${row.type || ''}${row.details ? ` (${row.details})` : ''}`.trim()];
  }));
  const combinedData = [...finalRecordsByKey.values()].map(row => ({
    날짜: row.date,
    이름: row.name,
    출근: row.in_time || '',
    퇴근: row.out_time || '',
    근무조: row.shift || '',
    비고: stripAccessLogReason(row.reason || ''),
  }));

  const calculated = logic.calculateAnomalies(combinedData, {
    employeeConfigList,
    manualEarlyPunches,
    manualReasons,
    currentLeaveData,
    currentUniqueDates: attendanceEligibleDates,
    holidayDates: [...holidaySet],
    preemptiveSupplements,
    skipMissingEmployeeExpansion: true,
  });
  const activeByKey = new Map();
  for (const anomaly of calculated) {
    if (anomaly.isResolved || !attendanceEligibleDates.has(anomaly.date)) continue;
    const key = `${logic.normalizeName(anomaly.name)}_${anomaly.date}`;
    if (anomaly.date >= MISSING_ATTENDANCE_START && anomaly.date <= MISSING_ATTENDANCE_END) continue;
    if (!activeByKey.has(key)) activeByKey.set(key, { ...anomaly, name: logic.normalizeName(anomaly.name) });
    else activeByKey.get(key).reason = mergeReasons(activeByKey.get(key).reason, anomaly.reason);
  }

  const scopedExistingAnomalies = existingAnomalies.filter(row => attendanceEligibleDates.has(row.date));
  const anomalyDeletes = scopedExistingAnomalies
    .filter(row => (!row.status || row.status === 'auto') && !activeByKey.has(row.manager_key))
    .map(row => row.manager_key)
    .sort();
  const anomalyUpserts = [];
  for (const [key, anomaly] of activeByKey) {
    const existing = existingAnomalyByKey.get(key);
    const row = {
      manager_key: key,
      name: anomaly.name,
      date: anomaly.date,
      reason: anomaly.reason || '',
      status: existing?.status || 'auto',
    };
    if (!existing || existing.name !== row.name || existing.date !== row.date || existing.reason !== row.reason || (existing.status || 'auto') !== row.status) {
      anomalyUpserts.push(row);
    }
  }

  // 기존 활성 anomaly에 맞춰 attendance_records 플래그를 대량 변경하지 않는다.
  // 원본 업로드와 직접 관련 없는 일괄 플래그 갱신을 피하고, 해소되어 삭제되는
  // 자동 anomaly의 플래그만 false로 정리한다.
  for (const key of anomalyDeletes) {
    const record = finalRecordsByKey.get(key);
    if (record) record.is_anomalous = false;
  }

  const affectedRecordKeys = new Set([
    ...incomingRecords.map(row => row.manager_key),
    ...activeByKey.keys(),
    ...anomalyDeletes,
  ]);
  const recordUpserts = [...affectedRecordKeys]
    .map(key => finalRecordsByKey.get(key))
    .filter(Boolean)
    .filter(row => !sameRecord(row, existingByKey.get(row.manager_key)))
    .map(recordPayload)
    .sort((a, b) => a.manager_key.localeCompare(b.manager_key, 'ko'));

  const newRecords = recordUpserts.filter(row => !existingByKey.has(row.manager_key));
  const changedRecords = recordUpserts.filter(row => existingByKey.has(row.manager_key));
  const changedFieldCounts = {};
  const upsertsByMonth = {};
  for (const row of recordUpserts) {
    const month = row.date.slice(0, 7);
    upsertsByMonth[month] = (upsertsByMonth[month] || 0) + 1;
    const existing = existingByKey.get(row.manager_key);
    if (!existing) {
      changedFieldCounts['(new row)'] = (changedFieldCounts['(new row)'] || 0) + 1;
      continue;
    }
    for (const field of RECORD_FIELDS) {
      const before = recordPayload(existing)[field];
      const after = row[field];
      if (before !== after) changedFieldCounts[field] = (changedFieldCounts[field] || 0) + 1;
    }
  }
  const gapAttendanceDates = [...attendanceEligibleDates].filter(date => date >= MISSING_ATTENDANCE_START && date <= MISSING_ATTENDANCE_END);
  const gapRecordUpserts = recordUpserts.filter(row => row.date >= MISSING_ATTENDANCE_START && row.date <= MISSING_ATTENDANCE_END);
  const newAnomalies = [...activeByKey.keys()].filter(key => !existingAnomalyByKey.has(key));
  const scopedExistingCount = scopedExistingAnomalies.length;
  const activeCount = activeByKey.size;
  const guardChecks = {
    source_files_present: (await sourceFileDetails()).length === ATTENDANCE_FILES.length + LEAVE_FILES.length,
    no_attendance_coverage_in_missing_march_half: gapAttendanceDates.length === 0,
    no_anomalies_in_missing_march_half: [...activeByKey.values()].every(row => row.date < MISSING_ATTENDANCE_START || row.date > MISSING_ATTENDANCE_END),
    parsed_records_nonempty: incomingRecords.length > 0,
    anomaly_total_not_spiking: activeCount <= Math.ceil(scopedExistingCount * 1.25) + 25,
    new_anomalies_bounded: newAnomalies.length <= 75,
    record_changes_bounded: recordUpserts.length <= 1500,
  };
  const safeToApply = Object.values(guardChecks).every(Boolean);
  const operations = { recordUpserts, anomalyUpserts, anomalyDeletes };
  const recordChangeDetails = recordUpserts.map(row => {
    const existing = existingByKey.get(row.manager_key);
    const changedFields = existing
      ? RECORD_FIELDS.filter(field => recordPayload(existing)[field] !== row[field])
      : ['(new row)'];
    return {
      manager_key: row.manager_key,
      changed_fields: changedFields,
      before: existing ? Object.fromEntries(changedFields.filter(field => field !== '(new row)').map(field => [field, recordPayload(existing)[field]])) : null,
      after: Object.fromEntries(changedFields.filter(field => field !== '(new row)').map(field => [field, row[field]])),
    };
  });
  const anomalyDeleteDetails = anomalyDeletes.map(key => {
    const row = existingAnomalyByKey.get(key);
    return { manager_key: key, date: row?.date || null, name: row?.name || null, reason: row?.reason || '', status: row?.status || 'auto' };
  });
  const unknownNames = [...sourceNames].filter(name => !employeeByName.has(name)).sort((a, b) => a.localeCompare(b, 'ko'));
  const preflight = {
    format: 'dow-manage-attendance-preflight-v1',
    created_at: new Date().toISOString(),
    backup_dir: backupDir,
    source_period: { start: SOURCE_PERIOD_START, end: SOURCE_PERIOD_END },
    known_missing_attendance_period: { start: MISSING_ATTENDANCE_START, end: MISSING_ATTENDANCE_END },
    source_files: await sourceFileDetails(),
    parsing: {
      attendance: attendanceParsed.map(row => ({ file: row.file, format: row.format, raw_rows: row.rawRows, normalized_rows: row.normalizedRows.length })),
      leave: leaveParsed.map(row => ({ file: row.file, raw_rows: row.rawRows, accepted_rows: row.leaves.length, canceled_rows: row.canceledRows, invalid_rows: row.invalidRows })),
      attendance_eligible_dates: attendanceEligibleDates.size,
      attendance_date_min: [...attendanceEligibleDates].sort()[0] || null,
      attendance_date_max: [...attendanceEligibleDates].sort().at(-1) || null,
      source_people: sourceNames.size,
      unknown_employee_names: unknownNames,
    },
    records: {
      incoming_keys: incomingRecords.length,
      upserts: recordUpserts.length,
      new: newRecords.length,
      changed: changedRecords.length,
      unchanged: incomingRecords.length - incomingRecords.filter(row => !sameRecord(row, existingByKey.get(row.manager_key))).length,
      missing_march_half_upserts: gapRecordUpserts.length,
      upserts_by_month: upsertsByMonth,
      changed_field_counts: Object.fromEntries(Object.entries(changedFieldCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
      change_details: recordChangeDetails,
    },
    anomalies: {
      existing_in_scope: scopedExistingCount,
      predicted_active_in_scope: activeCount,
      new_keys: newAnomalies.length,
      upserts: anomalyUpserts.length,
      auto_deletes: anomalyDeletes.length,
      net_key_change: newAnomalies.length - anomalyDeletes.length,
      existing_reason_counts: summarizeReasons(scopedExistingAnomalies),
      predicted_reason_counts: summarizeReasons([...activeByKey.values()]),
      upsert_details: anomalyUpserts,
      auto_delete_details: anomalyDeleteDetails,
    },
    guard_checks: guardChecks,
    safe_to_apply: safeToApply,
    proposal_sha256: proposalHash(operations),
  };
  return { preflight, operations, existingRecords, existingAnomalies };
}

async function createPreflight(backupDir) {
  const { preflight } = await buildProposal(backupDir);
  await writeVerifiedJson(path.join(backupDir, 'preflight.json'), preflight);
  console.log(`PREFLIGHT_SAFE ${preflight.safe_to_apply}`);
  console.log(`RECORD_UPSERTS ${preflight.records.upserts} NEW ${preflight.records.new} CHANGED ${preflight.records.changed}`);
  console.log(`ANOMALIES EXISTING_SCOPE ${preflight.anomalies.existing_in_scope} PREDICTED ${preflight.anomalies.predicted_active_in_scope} NEW ${preflight.anomalies.new_keys} DELETE_AUTO ${preflight.anomalies.auto_deletes}`);
  console.log(`MISSING_MARCH_HALF_RECORD_UPSERTS ${preflight.records.missing_march_half_upserts}`);
  console.log(`PROPOSAL_SHA256 ${preflight.proposal_sha256}`);
  return preflight;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function tableDigest(rows, orderColumn) {
  const sorted = [...rows];
  if (orderColumn) sorted.sort((a, b) => String(a[orderColumn] ?? '').localeCompare(String(b[orderColumn] ?? ''), 'ko'));
  return sha256(JSON.stringify(canonicalize(sorted)));
}

async function assertDatabaseUnchanged(client, backupDir) {
  const checkTables = TABLES.filter(table => [
    'attendance_records',
    'attendance_anomalies',
    'attendance_supplements',
    'attendance_holidays',
    'employees',
  ].includes(table.name));
  const result = {};
  for (const table of checkTables) {
    const backupRows = await readBackupTable(backupDir, table.name);
    const { rows: currentRows } = await fetchAllRows(client, table.name, table.order);
    const backupHash = tableDigest(backupRows, table.order);
    const currentHash = tableDigest(currentRows, table.order);
    result[table.name] = {
      backup_rows: backupRows.length,
      current_rows: currentRows.length,
      unchanged: backupHash === currentHash,
    };
    if (backupHash !== currentHash) {
      throw new Error(`${table.name} 테이블이 백업 후 변경되어 업로드를 중단했습니다. 새 백업과 사전 검증이 필요합니다.`);
    }
  }
  return result;
}

async function upsertChunks(client, table, rows, conflictColumn, selectColumn) {
  const saved = [];
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const result = await withRetries(`${table} 업서트`, async () => {
      const response = await client
        .from(table)
        .upsert(chunk, { onConflict: conflictColumn })
        .select(selectColumn);
      if (response.error) throw response.error;
      return response;
    }, 2);
    saved.push(...(result.data || []));
  }
  return saved;
}

async function deleteAnomalyKeys(client, keys) {
  const deleted = [];
  for (let index = 0; index < keys.length; index += 50) {
    const chunk = keys.slice(index, index + 50);
    const response = await client
      .from('attendance_anomalies')
      .delete()
      .in('manager_key', chunk)
      .eq('status', 'auto')
      .select('manager_key');
    if (response.error) throw response.error;
    deleted.push(...(response.data || []));
  }
  return deleted;
}

async function fetchRowsByKeys(client, table, keys) {
  const rows = [];
  for (let index = 0; index < keys.length; index += 100) {
    const chunk = keys.slice(index, index + 100);
    if (chunk.length === 0) continue;
    const response = await client.from(table).select('*').in('manager_key', chunk);
    if (response.error) throw response.error;
    rows.push(...(response.data || []));
  }
  return rows;
}

async function rollbackOperations(client, backupDir, operations) {
  const backupRecords = await readBackupTable(backupDir, 'attendance_records');
  const backupAnomalies = await readBackupTable(backupDir, 'attendance_anomalies');
  const recordByKey = new Map(backupRecords.map(row => [row.manager_key, row]));
  const anomalyByKey = new Map(backupAnomalies.map(row => [row.manager_key, row]));
  const touchedRecordKeys = operations.recordUpserts.map(row => row.manager_key);
  const restoreRecords = touchedRecordKeys.map(key => recordByKey.get(key)).filter(Boolean);
  const newRecordKeys = touchedRecordKeys.filter(key => !recordByKey.has(key));
  if (restoreRecords.length > 0) await upsertChunks(client, 'attendance_records', restoreRecords, 'manager_key', 'manager_key');
  for (let index = 0; index < newRecordKeys.length; index += 50) {
    const response = await client.from('attendance_records').delete().in('manager_key', newRecordKeys.slice(index, index + 50));
    if (response.error) throw response.error;
  }
  const touchedAnomalyKeys = [...new Set([
    ...operations.anomalyUpserts.map(row => row.manager_key),
    ...operations.anomalyDeletes,
  ])];
  const restoreAnomalies = touchedAnomalyKeys.map(key => anomalyByKey.get(key)).filter(Boolean);
  const newAnomalyKeys = touchedAnomalyKeys.filter(key => !anomalyByKey.has(key));
  if (restoreAnomalies.length > 0) await upsertChunks(client, 'attendance_anomalies', restoreAnomalies, 'manager_key', 'manager_key');
  for (let index = 0; index < newAnomalyKeys.length; index += 50) {
    const response = await client.from('attendance_anomalies').delete().in('manager_key', newAnomalyKeys.slice(index, index + 50));
    if (response.error) throw response.error;
  }
}

async function applyProposal(backupDir) {
  const storedPreflight = JSON.parse(await fs.readFile(path.join(backupDir, 'preflight.json'), 'utf8'));
  if (!storedPreflight.safe_to_apply) throw new Error('사전 검증이 안전 상태가 아니므로 업로드를 중단했습니다.');
  const { preflight, operations } = await buildProposal(backupDir);
  if (!preflight.safe_to_apply) throw new Error('재계산한 사전 검증이 안전 상태가 아닙니다.');
  if (preflight.proposal_sha256 !== storedPreflight.proposal_sha256) {
    throw new Error('원본 파일 또는 계산 결과가 사전 검증 후 변경되어 업로드를 중단했습니다.');
  }
  const storedSources = new Map(storedPreflight.source_files.map(row => [row.file, row.sha256]));
  if (preflight.source_files.some(row => storedSources.get(row.file) !== row.sha256)) {
    throw new Error('원본 파일 해시가 사전 검증 결과와 다릅니다.');
  }
  if (preflight.anomalies.new_keys !== 0) {
    throw new Error(`새 anomaly ${preflight.anomalies.new_keys}건이 예상되어 안전 업로드 정책에 따라 중단했습니다.`);
  }
  if (preflight.records.missing_march_half_upserts !== 0) {
    throw new Error('3월 상반 누락 기간을 변경하려는 레코드가 있어 업로드를 중단했습니다.');
  }

  const { client } = await createSupabaseClient();
  const unchangedCheck = await assertDatabaseUnchanged(client, backupDir);
  const startedAt = new Date();
  let writesStarted = false;
  try {
    writesStarted = true;
    const savedRecords = await upsertChunks(client, 'attendance_records', operations.recordUpserts, 'manager_key', 'manager_key');
    if (savedRecords.length !== operations.recordUpserts.length) {
      throw new Error(`attendance_records 저장 확인 불일치: 예상 ${operations.recordUpserts.length}, 확인 ${savedRecords.length}`);
    }
    const savedAnomalies = await upsertChunks(client, 'attendance_anomalies', operations.anomalyUpserts, 'manager_key', 'manager_key');
    if (savedAnomalies.length !== operations.anomalyUpserts.length) {
      throw new Error(`attendance_anomalies 저장 확인 불일치: 예상 ${operations.anomalyUpserts.length}, 확인 ${savedAnomalies.length}`);
    }
    const deletedAnomalies = await deleteAnomalyKeys(client, operations.anomalyDeletes);
    if (deletedAnomalies.length !== operations.anomalyDeletes.length) {
      throw new Error(`attendance_anomalies 삭제 확인 불일치: 예상 ${operations.anomalyDeletes.length}, 확인 ${deletedAnomalies.length}`);
    }

    const [verifiedRecords, verifiedAnomalies, deletedCheck, recordCountResult, anomalyCountResult] = await Promise.all([
      fetchRowsByKeys(client, 'attendance_records', operations.recordUpserts.map(row => row.manager_key)),
      fetchRowsByKeys(client, 'attendance_anomalies', operations.anomalyUpserts.map(row => row.manager_key)),
      fetchRowsByKeys(client, 'attendance_anomalies', operations.anomalyDeletes),
      client.from('attendance_records').select('*', { count: 'exact', head: true }),
      client.from('attendance_anomalies').select('*', { count: 'exact', head: true }),
    ]);
    const verifiedRecordMap = new Map(verifiedRecords.map(row => [row.manager_key, row]));
    for (const expected of operations.recordUpserts) {
      if (!sameRecord(expected, verifiedRecordMap.get(expected.manager_key))) throw new Error(`${expected.manager_key} 근태 레코드 사후 검증 실패`);
    }
    const verifiedAnomalyMap = new Map(verifiedAnomalies.map(row => [row.manager_key, row]));
    for (const expected of operations.anomalyUpserts) {
      const actual = verifiedAnomalyMap.get(expected.manager_key);
      if (!actual || actual.name !== expected.name || actual.date !== expected.date || actual.reason !== expected.reason || actual.status !== expected.status) {
        throw new Error(`${expected.manager_key} anomaly 사후 검증 실패`);
      }
    }
    if (deletedCheck.length !== 0) throw new Error(`삭제 대상 anomaly ${deletedCheck.length}건이 DB에 남아 있습니다.`);
    if (recordCountResult.error) throw recordCountResult.error;
    if (anomalyCountResult.error) throw anomalyCountResult.error;

    const result = {
      format: 'dow-manage-attendance-apply-result-v1',
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      backup_dir: backupDir,
      proposal_sha256: preflight.proposal_sha256,
      database_unchanged_before_write: unchangedCheck,
      applied: {
        attendance_record_upserts: operations.recordUpserts.length,
        anomaly_upserts: operations.anomalyUpserts.length,
        anomaly_auto_deletes: operations.anomalyDeletes.length,
        new_anomaly_keys: preflight.anomalies.new_keys,
        missing_march_half_record_upserts: preflight.records.missing_march_half_upserts,
      },
      post_counts: {
        attendance_records: recordCountResult.count,
        attendance_anomalies: anomalyCountResult.count,
      },
      verification: {
        records_match: true,
        anomaly_upserts_match: true,
        anomaly_deletes_absent: true,
      },
    };
    await writeVerifiedJson(path.join(backupDir, 'apply_result.json'), result);
    console.log(`APPLY_RECORD_UPSERTS ${operations.recordUpserts.length}`);
    console.log(`APPLY_ANOMALY_UPSERTS ${operations.anomalyUpserts.length}`);
    console.log(`APPLY_ANOMALY_AUTO_DELETES ${operations.anomalyDeletes.length}`);
    console.log(`POST_COUNTS records=${recordCountResult.count} anomalies=${anomalyCountResult.count}`);
    console.log('VERIFY_OK true');
    return result;
  } catch (error) {
    if (writesStarted) {
      try {
        await rollbackOperations(client, backupDir, operations);
        throw new Error(`${error.message} (백업 데이터로 자동 롤백 완료)`);
      } catch (rollbackError) {
        if (rollbackError.message.includes('자동 롤백 완료')) throw rollbackError;
        throw new Error(`${error.message} (자동 롤백 실패: ${rollbackError.message})`);
      }
    }
    throw error;
  }
}

async function verifyUserDataPreservation(backupDir) {
  const { client } = await createSupabaseClient();
  const tableSpecs = {
    attendance_records: 'manager_key',
    attendance_anomalies: 'id',
    attendance_supplements: 'id',
    attendance_reports: null,
  };
  const backup = {};
  const current = {};
  for (const [table, order] of Object.entries(tableSpecs)) {
    backup[table] = await readBackupTable(backupDir, table);
    current[table] = (await fetchAllRows(client, table, order)).rows;
  }

  const currentRecordByKey = new Map(current.attendance_records.map(row => [row.manager_key, row]));
  const protectedRecordFields = [
    'manager_reason', 'employee_explanation', 'early_punch_mode',
    'status_in', 'status_out', 'status_leave',
  ];
  const recordMismatches = [];
  for (const before of backup.attendance_records) {
    const after = currentRecordByKey.get(before.manager_key);
    if (!after) {
      recordMismatches.push({ manager_key: before.manager_key, issue: 'missing row' });
      continue;
    }
    const fields = protectedRecordFields.filter(field => (before[field] ?? null) !== (after[field] ?? null));
    if (fields.length > 0) recordMismatches.push({ manager_key: before.manager_key, fields });
  }

  const currentAnomalyByKey = new Map(current.attendance_anomalies.map(row => [row.manager_key, row]));
  const protectedAnomalies = backup.attendance_anomalies.filter(row =>
    String(row.explanation || '').trim() !== '' || (row.status && row.status !== 'auto')
  );
  const anomalyMismatches = [];
  for (const before of protectedAnomalies) {
    const after = currentAnomalyByKey.get(before.manager_key);
    if (!after) {
      anomalyMismatches.push({ manager_key: before.manager_key, issue: 'missing row' });
      continue;
    }
    const fields = ['explanation', 'status', 'reason'].filter(field => (before[field] ?? null) !== (after[field] ?? null));
    if (fields.length > 0) anomalyMismatches.push({ manager_key: before.manager_key, fields });
  }

  const preflight = JSON.parse(await fs.readFile(path.join(backupDir, 'preflight.json'), 'utf8'));
  const deletedKeys = new Set(preflight.anomalies.auto_delete_details.map(row => row.manager_key));
  const deletedRows = backup.attendance_anomalies.filter(row => deletedKeys.has(row.manager_key));
  const deletedWithUserContent = deletedRows.filter(row =>
    String(row.explanation || '').trim() !== '' || (row.status && row.status !== 'auto')
  );

  const supplementsUnchanged = tableDigest(backup.attendance_supplements, 'id') === tableDigest(current.attendance_supplements, 'id');
  const reportsUnchanged = tableDigest(backup.attendance_reports, null) === tableDigest(current.attendance_reports, null);
  const result = {
    format: 'dow-manage-user-data-preservation-verification-v1',
    verified_at: new Date().toISOString(),
    protected_attendance_record_rows: backup.attendance_records.length,
    protected_attendance_fields: protectedRecordFields,
    attendance_record_mismatches: recordMismatches,
    protected_user_anomalies: protectedAnomalies.length,
    user_anomaly_mismatches: anomalyMismatches,
    deleted_auto_anomalies: deletedRows.length,
    deleted_anomalies_with_user_content: deletedWithUserContent.length,
    attendance_supplements_unchanged: supplementsUnchanged,
    attendance_reports_unchanged: reportsUnchanged,
    preserved: recordMismatches.length === 0
      && anomalyMismatches.length === 0
      && deletedWithUserContent.length === 0
      && supplementsUnchanged
      && reportsUnchanged,
  };
  await writeVerifiedJson(path.join(backupDir, 'preservation_verification.json'), result);
  console.log(`PRESERVED ${result.preserved}`);
  console.log(`RECORD_FIELD_MISMATCHES ${recordMismatches.length}`);
  console.log(`USER_ANOMALY_MISMATCHES ${anomalyMismatches.length}`);
  console.log(`DELETED_WITH_USER_CONTENT ${deletedWithUserContent.length}`);
  console.log(`SUPPLEMENTS_UNCHANGED ${supplementsUnchanged}`);
  console.log(`REPORTS_UNCHANGED ${reportsUnchanged}`);
  return result;
}

async function main() {
  const command = process.argv[2];
  if (command === 'backup') {
    await createBackup();
    return;
  }
  if (command === 'preflight') {
    const backupDir = path.resolve(process.argv[3] || '');
    if (!process.argv[3]) throw new Error('preflight에는 백업 디렉터리가 필요합니다.');
    await createPreflight(backupDir);
    return;
  }
  if (command === 'apply') {
    const backupDir = path.resolve(process.argv[3] || '');
    if (!process.argv[3]) throw new Error('apply에는 백업 디렉터리가 필요합니다.');
    await applyProposal(backupDir);
    return;
  }
  if (command === 'verify-preservation') {
    const backupDir = path.resolve(process.argv[3] || '');
    if (!process.argv[3]) throw new Error('verify-preservation에는 백업 디렉터리가 필요합니다.');
    await verifyUserDataPreservation(backupDir);
    return;
  }
  throw new Error('사용법: node tools/attendance_safe_upload.mjs <backup|preflight|apply|verify-preservation> [backup-dir]');
}

main().catch(error => {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
});
