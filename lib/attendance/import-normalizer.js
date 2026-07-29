(function exposeAttendanceImport(root, factory) {
    const sharedLogic = typeof module === 'object' && module.exports
        ? require('../../shared_logic')
        : root;
    const api = factory(sharedLogic, () => root?.XLSX?.SSF?.parse_date_code);

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AttendanceImportNormalizer = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAttendanceImportNormalizer(shared, getDefaultDateParser) {
    const ATTENDANCE_HEADER_KEYWORDS = Object.freeze([
        '날짜', '일자', '이름', '성명', '사원명',
        '출근', '퇴근', '발생시각', '상태', '근무조'
    ]);
    const TIME_MARKERS = Object.freeze([
        '연차', '반차', '오전반차', '오후반차', '외근', '출장'
    ]);
    const ATTENDANCE_COLUMN_RULES = Object.freeze({
        날짜: Object.freeze({
            exact: Object.freeze(['날짜']),
            containsAny: Object.freeze(['날짜', '일자'])
        }),
        이름: Object.freeze({
            exact: Object.freeze(['이름']),
            containsAny: Object.freeze(['이름', '성명', '사원명'])
        }),
        출근: Object.freeze({
            exact: Object.freeze(['출근', '출']),
            containsAny: Object.freeze(['출입']),
            containsAll: Object.freeze([
                Object.freeze(['출근', '시간']),
                Object.freeze(['출근', '시각'])
            ])
        }),
        퇴근: Object.freeze({
            exact: Object.freeze(['퇴근', '퇴']),
            containsAll: Object.freeze([
                Object.freeze(['퇴근', '시간']),
                Object.freeze(['퇴근', '시각'])
            ])
        }),
        근무조: Object.freeze({
            exact: Object.freeze(['근무조', '조']),
            containsAny: Object.freeze(['근무조'])
        })
    });
    const REASON_HEADER_KEYWORDS = Object.freeze(['비고', '부재', '예외', '사유']);
    const REASON_VALUE_RULES = Object.freeze([
        Object.freeze({ keyword: '외근', label: '외근' }),
        Object.freeze({ keyword: '생일자', label: '생일' })
    ]);

    function getDateParser(options = {}) {
        return options.parseDateCode || getDefaultDateParser?.() || null;
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function isPackedSingleColumnSheet(rows) {
        const nonEmptyRows = (rows || [])
            .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== ''))
            .slice(0, 20);
        if (nonEmptyRows.length === 0) return false;

        const packedRows = nonEmptyRows.filter((row) => {
            const cells = row.map((cell) => String(cell || '').trim()).filter(Boolean);
            if (cells.length !== 1) return false;
            const text = cells[0];
            const delimiterParts = text.split(/,|\t|;|\|/).map((part) => part.trim()).filter(Boolean);
            const hasExpectedWords = /(날짜|일자|이름|성명|사원명|출근|퇴근|근무조|비고|발생시각)/.test(text);
            const hasDateAndTime = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)
                && /\d{1,2}:\d{2}/.test(text);
            return delimiterParts.length >= 3
                || (hasExpectedWords && /\s+/.test(text))
                || hasDateAndTime;
        });

        return packedRows.length >= Math.min(3, nonEmptyRows.length)
            || (nonEmptyRows.length <= 2 && packedRows.length > 0);
    }

    function getAttendanceField(row, names) {
        for (const name of names) {
            if (row && row[name] !== undefined && String(row[name]).trim() !== '') {
                return row[name];
            }
        }
        return '';
    }

    function findSourceHeader(headers, canonical) {
        const rule = ATTENDANCE_COLUMN_RULES[canonical];
        if (!rule) return null;

        const normalizedHeaders = headers.map((source) => ({
            source,
            value: String(source || '').trim()
        }));
        const exact = normalizedHeaders.find(({ value }) => rule.exact?.includes(value));
        if (exact) return exact.source;

        const all = normalizedHeaders.find(({ value }) =>
            rule.containsAll?.some((keywords) => keywords.every((keyword) => value.includes(keyword)))
        );
        if (all) return all.source;

        const any = normalizedHeaders.find(({ value }) =>
            rule.containsAny?.some((keyword) => value.includes(keyword))
        );
        return any?.source || null;
    }

    function createCanonicalHeaderMap(headers) {
        return Object.keys(ATTENDANCE_COLUMN_RULES).reduce((result, canonical) => {
            const source = findSourceHeader(headers, canonical);
            if (source && source !== canonical) result[source] = canonical;
            return result;
        }, {});
    }

    function findHeaderRowIndex(rows, keywords = ATTENDANCE_HEADER_KEYWORDS, minMatches = 2) {
        let bestIdx = -1;
        let bestScore = 0;
        (rows || []).slice(0, 12).forEach((row, idx) => {
            if (!Array.isArray(row)) return;
            const cells = row.map((value) => String(value || '').trim()).filter(Boolean);
            const score = cells.reduce(
                (sum, cell) => sum + (keywords.some((keyword) => cell.includes(keyword)) ? 1 : 0),
                0
            );
            if (score > bestScore) {
                bestScore = score;
                bestIdx = idx;
            }
        });
        return bestScore >= minMatches ? bestIdx : -1;
    }

    function parseAttendanceDate(value, options = {}) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            const parsed = getDateParser(options)?.(value);
            if (parsed?.y && parsed?.m && parsed?.d) {
                return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
            }
        }

        const rawText = String(value || '').trim();
        if (/^\d{4}-\d{1,2}-\d{1,2}T.*Z$/i.test(rawText)) {
            const parsedDate = new Date(rawText);
            if (!Number.isNaN(parsedDate.getTime())) {
                return `${parsedDate.getFullYear()}-${pad2(parsedDate.getMonth() + 1)}-${pad2(parsedDate.getDate())}`;
            }
        }

        const text = rawText
            .replace(/\./g, '-')
            .replace(/\//g, '-')
            .replace('T', ' ')
            .split(' ')[0];
        let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!match) {
            const shortMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
            if (shortMatch) {
                match = [
                    `20${shortMatch[3]}-${shortMatch[1]}-${shortMatch[2]}`,
                    `20${shortMatch[3]}`,
                    shortMatch[1],
                    shortMatch[2]
                ];
            }
        }
        return match ? `${match[1]}-${pad2(match[2])}-${pad2(match[3])}` : null;
    }

    function isValidAttendanceTime(value) {
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 && value < 1;
        const text = String(value).trim();
        if (!text || text === '-') return false;
        if (TIME_MARKERS.some((keyword) => text.includes(keyword))) return true;

        const cleaned = text.replace(':', '').trim();
        if (!/^\d{3,4}$/.test(cleaned)) return false;
        const padded = cleaned.padStart(4, '0');
        const hour = parseInt(padded.substring(0, 2), 10);
        const minute = parseInt(padded.substring(2, 4), 10);
        return hour >= 0 && hour <= 29 && minute >= 0 && minute <= 59;
    }

    function isLikelyPersonName(value, options = {}) {
        const text = String(value || '').trim().replace(/\s+/g, '');
        if (text.length < 2 || text.length > 20) return false;
        if (parseAttendanceDate(text, options) || isValidAttendanceTime(text)) return false;
        if (/날짜|일자|출근|퇴근|상태|근무|시간|시각|부서|부문|팀|합계|총계/.test(text)) return false;
        return /^[가-힣A-Za-z·.]+$/.test(text);
    }

    function parseAttendanceDateTime(value, options = {}) {
        if (value === null || value === undefined || value === '') return null;

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return {
                date: `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`,
                time: `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`
            };
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            const parsed = getDateParser(options)?.(value);
            if (parsed) {
                return {
                    date: `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`,
                    time: `${pad2(parsed.H || 0)}:${pad2(parsed.M || 0)}:${pad2(Math.floor(parsed.S || 0))}`
                };
            }
        }

        const text = String(value).trim().replace('T', ' ');
        const match = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!match) return null;

        return {
            date: `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`,
            time: `${pad2(match[4])}:${pad2(match[5])}:${pad2(match[6] || '00')}`
        };
    }

    function validateAttendanceUpload(fileName, sheetRows, normalizedRows, options = {}) {
        const logger = options.logger || console;
        const nonEmptySheetRows = (sheetRows || [])
            .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== ''));

        if (nonEmptySheetRows.length === 0) {
            return { ok: false, message: `${fileName}: 읽을 수 있는 데이터가 없습니다.` };
        }

        if (isPackedSingleColumnSheet(sheetRows)) {
            return {
                ok: false,
                message: `${fileName}: 여러 열로 나뉘어야 할 값이 A열 한 칸에 몰려 있습니다. 엑셀의 '텍스트 나누기' 또는 CSV 구분자 설정을 확인한 뒤 다시 업로드해 주세요.`
            };
        }

        const maxColumnCount = Math.max(
            ...nonEmptySheetRows.map((row) => row.filter((cell) => String(cell || '').trim() !== '').length)
        );
        if (maxColumnCount < 2) {
            return {
                ok: false,
                message: `${fileName}: 유효한 열이 너무 적습니다. 컬럼이 분리되어 있는지 확인해 주세요.`
            };
        }

        const headerIdx = findHeaderRowIndex(sheetRows);
        if (headerIdx !== -1) {
            const rows = (normalizedRows || [])
                .filter((row) => row && Object.values(row).some((value) => String(value || '').trim() !== ''));
            const hasRecognizedAttendanceRow = rows.slice(0, 150).some((row) => {
                const date = getAttendanceField(row, ['날짜', '일자']);
                const name = getAttendanceField(row, ['이름', '성명', '사원명']);
                const inTime = getAttendanceField(row, ['출근', '출근시간', '출근시각']);
                const outTime = getAttendanceField(row, ['퇴근', '퇴근시간', '퇴근시각']);
                const eventTime = getAttendanceField(row, ['발생시각']);
                return (
                    parseAttendanceDate(date, options)
                    && isLikelyPersonName(name, options)
                    && (isValidAttendanceTime(inTime) || isValidAttendanceTime(outTime))
                ) || (
                    isLikelyPersonName(name, options)
                    && parseAttendanceDateTime(eventTime, options)
                );
            });

            if (!hasRecognizedAttendanceRow) {
                logger.warn?.(
                    `[UPLOAD] ${fileName}: 헤더는 찾았지만 검증 가능한 출퇴근 행을 찾지 못했습니다. 기존 호환성을 위해 업로드는 허용합니다.`
                );
            }
        }

        return { ok: true };
    }

    function previousDateString(dateStr) {
        const date = new Date(`${dateStr}T00:00:00`);
        if (Number.isNaN(date.getTime())) return dateStr;
        date.setDate(date.getDate() - 1);
        return shared.formatLocalDateValue(date);
    }

    function getAttendanceLogBucket(time) {
        const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
        if (!match) return '';
        const minutes = Number(match[1]) * 60 + Number(match[2]);
        if (minutes <= 299) return 'prevOut';
        if (minutes <= 719) return 'in';
        if (minutes <= 779) return 'lunch';
        return 'out';
    }

    function toPreviousDayOutTime(time) {
        const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
        if (!match) return time;
        return `${String(Number(match[1]) + 24).padStart(2, '0')}:${match[2]}`;
    }

    function normalizeRows(rawData, options = {}) {
        if (!rawData || rawData.length === 0) return rawData;

        const headers = Object.keys(rawData[0]);

        if (headers.includes('발생시각') && !headers.includes('출근')) {
            const grouped = {};
            rawData.forEach((row) => {
                const name = shared.normalizeName(row['이름']);
                const parsedDateTime = parseAttendanceDateTime(row['발생시각'], options);
                const shift = String(row['근무조'] || '').trim();
                if (!name || !parsedDateTime) return;

                const { date, time } = parsedDateTime;
                const bucket = getAttendanceLogBucket(time);
                const recordDate = bucket === 'prevOut' ? previousDateString(date) : date;
                const key = `${name}_${recordDate}`;
                if (!grouped[key]) {
                    grouped[key] = {
                        date: recordDate,
                        name,
                        shift,
                        ins: [],
                        lunches: [],
                        outs: []
                    };
                }
                if (shift && !grouped[key].shift) grouped[key].shift = shift;

                if (bucket === 'in') grouped[key].ins.push(time);
                else if (bucket === 'lunch') grouped[key].lunches.push(time);
                else if (bucket === 'out') grouped[key].outs.push(time);
                else if (bucket === 'prevOut') grouped[key].outs.push(toPreviousDayOutTime(time));
            });

            return Object.values(grouped).map((group) => {
                const inTimes = group.ins.sort();
                const lunchTimes = group.lunches.sort();
                const outTimes = group.outs.sort();
                return {
                    날짜: group.date,
                    이름: group.name,
                    출근: inTimes[0] || lunchTimes[0] || '',
                    퇴근: outTimes[outTimes.length - 1] || lunchTimes[lunchTimes.length - 1] || '',
                    근무조: group.shift
                };
            });
        }

        const canonicalMap = createCanonicalHeaderMap(headers);
        const reasonHeaders = headers.filter((header) =>
            REASON_HEADER_KEYWORDS.some((keyword) => header.includes(keyword))
        );

        return rawData.map((row) => {
            const newRow = { ...row };
            Object.entries(canonicalMap).forEach(([source, destination]) => {
                if (source in newRow && !(destination in newRow)) {
                    newRow[destination] = newRow[source];
                }
            });

            if (newRow['근무조']) {
                newRow['근무조'] = shared.expandShift(newRow['근무조']);
            }

            let combinedReason = '';
            reasonHeaders.forEach((header) => {
                const value = String(newRow[header] || '');
                REASON_VALUE_RULES.forEach(({ keyword, label }) => {
                    if (value.includes(keyword) && !combinedReason.includes(label)) {
                        if (combinedReason) combinedReason += ', ';
                        combinedReason += label;
                    }
                });
            });
            newRow['비고'] = combinedReason;
            return newRow;
        });
    }

    return Object.freeze({
        ATTENDANCE_HEADER_KEYWORDS,
        ATTENDANCE_COLUMN_RULES,
        isPackedSingleColumnSheet,
        getAttendanceField,
        findSourceHeader,
        createCanonicalHeaderMap,
        findHeaderRowIndex,
        parseAttendanceDate,
        isValidAttendanceTime,
        isLikelyPersonName,
        parseAttendanceDateTime,
        validateAttendanceUpload,
        getAttendanceLogBucket,
        normalizeRows
    });
}));
