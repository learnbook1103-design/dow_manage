// shared_logic.js

function normalizeName(name) {
    if (!name) return "";
    let n = String(name).trim();
    if (n === "한옥연") return "한옥련";
    return n;
};


function cleanTime(timeStr) {
    if (!timeStr) return "";
    if (typeof timeStr === 'number') {
        const totalSecs = Math.round(timeStr * 86400);
        const h = Math.floor(totalSecs / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }
    const str = String(timeStr).trim();
    if (str === "-") return "";

    // [추가] 휴가 관련 텍스트 키워드 보장 및 확장 (생일자 추가)
    const leaveKeywords = ['연차', '반차', '오전반차', '오후반차', '조퇴', '외출', '외근', '경조', '휴가', '공가', '병가', '청원', '대체', '포상', '출장', '생일자', '생일'];
    if (leaveKeywords.some(k => str.includes(k))) return str;

    const t = str.split(' ').length > 1 ? str.split(' ')[1] : str.split(' ')[0];
    const hm = t.split(':');
    if (hm.length >= 2) {
        const h = hm[0].padStart(2, '0');
        const m = hm[1].padStart(2, '0');
        if (!isNaN(parseInt(h)) && !isNaN(parseInt(m))) return `${h}:${m}`;
    }
    return "";
}

function expandShift(shiftStr) {
    if (!shiftStr) return "0800-1700";
    let s = String(shiftStr).trim();
    if (s.includes('-') || s.includes('~')) return s;

    // 숫지만 추출
    let digits = s.replace(/[^0-9]/g, '');
    if (digits.length === 3) digits = '0' + digits; // 830 -> 0830
    if (digits.length === 4) {
        let h = parseInt(digits.substring(0, 2));
        let m = digits.substring(2, 4);
        let outH = String(h + 9).padStart(2, '0');
        // 보통 오후 24시를 넘는 경우는 없으므로 단순 처리
        return digits + "-" + outH + m;
    }
    return s;
}


function calculateAnomalies(combinedData, config) {
    const {
        employeeConfigList = [],
        manualEarlyPunches = {},
        manualReasons = {},
        currentLeaveData = [],
        currentUniqueDates = new Set()
    } = config || {};
    const anomalies = [];
    const manualNames = employeeConfigList.map(e => e.name.trim()).filter(n => n.length > 0);
    const ceoNames = new Set(employeeConfigList.filter(e => e.org === "대표이사").map(e => normalizeName(e.name)));

    // 이름과 날짜별로 데이터 통합 (중복 제거)
    const groupedMap = {};
    combinedData.forEach(row => {
        let dateValInput = row["날짜"];
        const nameVal = normalizeName(row["이름"]);

        // [추가] 대표이사 제외
        if (ceoNames.has(nameVal)) return;

        let jsDateOrig = null;
        if (typeof dateValInput === 'number') jsDateOrig = new Date(Math.round((dateValInput - 25569) * 86400 * 1000));
        else if (dateValInput) jsDateOrig = new Date(String(dateValInput).split(' ')[0]);

        const originalDateStr = (jsDateOrig && !isNaN(jsDateOrig)) ? jsDateOrig.toISOString().split('T')[0] : String(dateValInput).split(' ')[0];
        const manualKey = `${nameVal}_${originalDateStr}`;

        let inValRaw = cleanTime(row["출근"]);
        let outValRaw = cleanTime(row["퇴근"]);

        let inVal = inValRaw;
        let outVal = outValRaw;

        const isEarly = (inValRaw && inValRaw < '06:00') || (outValRaw && outValRaw < '06:00');
        const mode = manualEarlyPunches[manualKey] || "";

        const empInfo = employeeConfigList.find(e => normalizeName(e.name) === nameVal);
        const defaultShift = (empInfo && empInfo.shift) ? empInfo.shift : "0800-1700";

        // 1. 해당 일자의 기본 정보를 보장 (검증 목록 유지를 위해)
        if (!groupedMap[manualKey]) {
            groupedMap[manualKey] = {
                date: originalDateStr,
                name: nameVal,
                in: "", out: "", minOut: "",
                shift: defaultShift,
                originalDate: originalDateStr,
                hasEarly: false,
                reason: manualReasons[manualKey] || "" // [추가] 수동 사유 연동
            };
        }
        if (isEarly) groupedMap[manualKey].hasEarly = true;

        // [추가] 행 자체에 사유가 있다면 합침
        const rowReason = row["비고"] || row["reason"] || "";
        if (rowReason && !groupedMap[manualKey].reason.includes(rowReason)) {
            groupedMap[manualKey].reason = (groupedMap[manualKey].reason ? groupedMap[manualKey].reason + ", " : "") + rowReason;
        }


        // 2. 수동 오버라이드 모드 적용 및 데이터 배분
        if (mode === "forceIn" && isEarly) {
            if (outValRaw && outValRaw < '06:00') {
                inVal = outValRaw;
                outVal = "";
            }
        }

        const shiftStr = String(row["근무조"] || "").trim() || defaultShift;
        groupedMap[manualKey].shift = shiftStr;

        if (jsDateOrig && !isNaN(jsDateOrig)) {
            if (mode === "shift" && isEarly) {
                // 전날로 시프팅하여 배분
                const jsDatePrev = new Date(jsDateOrig);
                jsDatePrev.setDate(jsDatePrev.getDate() - 1);

                const expand = (t) => {
                    if (t && t < '06:00') {
                        const [h, m] = t.split(':');
                        return (parseInt(h) + 24) + ":" + m;
                    }
                    return t;
                };
                const newIn = expand(inVal);
                const newOut = expand(outVal);

                const shiftedDateStr = jsDatePrev.toISOString().split('T')[0];
                const prevKey = `${nameVal}_${shiftedDateStr}`;
                if (!groupedMap[prevKey]) {
                    groupedMap[prevKey] = { date: shiftedDateStr, name: nameVal, in: newIn, out: newOut, minOut: newOut, shift: shiftStr, originalDate: originalDateStr, hasEarly: false };
                } else {
                    if (newIn && (!groupedMap[prevKey].in || newIn < groupedMap[prevKey].in)) groupedMap[prevKey].in = newIn;
                    if (newOut) {
                        if (!groupedMap[prevKey].out || newOut > groupedMap[prevKey].out) groupedMap[prevKey].out = newOut;
                        if (!groupedMap[prevKey].minOut || newOut < groupedMap[prevKey].minOut) groupedMap[prevKey].minOut = newOut;
                    }
                }
                // 원본 일자(manualKey)에는 데이타를 합치지 않음 (시프팅 되었으므로)
                return;
            }
        }

        // 일반 기록 또는 시프팅되지 않은 기록 합치기
        const g = groupedMap[manualKey];
        if (inVal && (!g.in || inVal < g.in)) g.in = inVal;
        if (outVal) {
            if (!g.out || outVal > g.out) g.out = outVal;
            if (!g.minOut || outVal < g.minOut) g.minOut = outVal;
        }
    });

    // [추가] 휴가 데이터가 존재하지만 출퇴근 기록이 아예 없는 날짜도 검증 대상에 포함
    if (typeof currentLeaveData !== 'undefined' && currentLeaveData && currentLeaveData.length > 0) {
        currentLeaveData.forEach(lv => {
            const nameVal = normalizeName(lv.name);
            const getJsDate = (num) => (typeof num === 'number') ? new Date(Math.round((num - 25569) * 86400 * 1000)) : new Date(String(num).replace(/\./g, '-'));
            const startDt = getJsDate(lv.start);
            const endDt = getJsDate(lv.end || lv.start);

            let curDay = new Date(startDt);
            while (curDay <= endDt) {
                const fDate = curDay.toISOString().split('T')[0];
                if (typeof currentUniqueDates !== 'undefined' && currentUniqueDates && currentUniqueDates.has(fDate)) {
                    const manualKey = `${nameVal}_${fDate}`;
                    if (!groupedMap[manualKey]) {
                        groupedMap[manualKey] = {
                            date: fDate,
                            name: nameVal,
                            in: "", out: "", minOut: "",
                            shift: "0800-1700",
                            originalDate: fDate,
                            hasEarly: false
                        };
                    }
                }
                curDay.setDate(curDay.getDate() + 1);
            }
        });
    }

    // [추가] 기간 내 모든 지정된 요약 사원에 대해 모든 유효 날짜(평일 등) 검증 대상에 강제 포함 (기록이 하나도 없는 날짜도 포착)
    if (employeeConfigList && employeeConfigList.length > 0 && typeof currentUniqueDates !== 'undefined' && currentUniqueDates && currentUniqueDates.size > 0) {
        currentUniqueDates.forEach(fDate => {
            employeeConfigList.forEach(emp => {
                const nameVal = normalizeName(emp.name);
                if (!nameVal || ceoNames.has(nameVal)) return;

                // 입사일/퇴사일 범위 확인
                if (emp.joinDate && fDate < emp.joinDate) return;
                if (emp.leaveDate && fDate > emp.leaveDate) return;

                const manualKey = `${nameVal}_${fDate}`;
                if (!groupedMap[manualKey]) {
                    groupedMap[manualKey] = {
                        date: fDate,
                        name: nameVal,
                        in: "", out: "", minOut: "",
                        shift: "0800-1700",
                        originalDate: fDate,
                        hasEarly: false,
                        reason: manualReasons[manualKey] || ""
                    };
                }
            });
        });
    }

    // 통합된 데이터를 바탕으로 검증 수행
    Object.values(groupedMap).forEach(group => {
        // [특정 사용자 근무조 하드코딩]
        if (group.name === "박주연") group.shift = "0900-1800";

        const dateVal = group.date;
        const nameVal = group.name;
        const inVal = group.in;
        const outVal = group.out;
        const shiftStr = group.shift;

        // 표에 나타나지 않은 날짜(기록/휴가 둘 다 없는 날짜)는 검증에서 제외
        // [수정] currentUniqueDates가 비어있어도 클라우드 데이터가 있다면 검사가 가능하도록 함
        if (currentUniqueDates && currentUniqueDates.size > 0 && !currentUniqueDates.has(dateVal)) return;

        if (manualNames.length > 0 && !manualNames.includes(nameVal)) return;

        // [추가] 재직 기간 외 데이터 검증 제외 (사용자 요청)
        const empInfo = employeeConfigList.find(e => normalizeName(e.name) === nameVal);
        if (empInfo) {
            if (empInfo.joinDate && dateVal < empInfo.joinDate) return;
            if (empInfo.leaveDate && dateVal > empInfo.leaveDate) return;
        }

        // 휴가 데이터 연동 검증
        let isFullLeave = false;
        let isAMHalf = false;
        let isPMHalf = false;
        let otherLeaveType = "";

        let isResolved = false;
        // [수정] 수동 사유(클라우드 복구분) 및 행 사유 결합
        const manualReason = group.reason || "";
        const combinedReason = manualReason;

        const leaveKeywords = ['연차', '반차', '오전반차', '오후반차', '조퇴', '외출', '외근', '경조', '휴가', '공가', '병가', '청원', '대체', '포상', '출장', '생일자', '생일'];
        if (leaveKeywords.some(k => combinedReason.includes(k) || String(inVal).includes(k) || String(outVal).includes(k))) {
            const checkStr = combinedReason + " " + String(inVal) + " " + String(outVal);
            // [수정] '연차,반차'와 같이 키워드가 섞인 경우 반차로 우선 처리하기 위해 조건 수정
            const isPartialKeyword = checkStr.includes("반차") || checkStr.includes("조퇴") || checkStr.includes("외출") || checkStr.includes("생일자");
            if ((checkStr.includes("연차") || checkStr.includes("경조") || checkStr.includes("휴가") || checkStr.includes("공가") || checkStr.includes("병가") || checkStr.includes("청원") || checkStr.includes("대체") || checkStr.includes("포상") || checkStr.includes("출장")) && !isPartialKeyword) {
                isFullLeave = true;
            } else if (checkStr.includes("오전반차")) {
                isAMHalf = true;
            } else if (checkStr.includes("오후반차") || checkStr.includes("반차") || checkStr.includes("생일자") || checkStr.includes("생일")) {
                // [수정] '조퇴' 키워드는 이상 사유이므로 '반차' 판정 키워드에서 제외 (사용자 요청 대응)
                isPMHalf = true;
            } else {
                otherLeaveType = checkStr;
                // [추가] 정식 휴가나 사전 등록 사유가 있는 경우 '처리됨' 플래그 설정
                isResolved = true;
            }
        }

        if (currentLeaveData && currentLeaveData.length > 0) {
            currentLeaveData.forEach(lv => {
                if (normalizeName(lv.name) === nameVal) {
                    const getJsDate = (num) => new Date(Math.round((num - 25569) * 86400 * 1000)).toISOString().split('T')[0];
                    const start = getJsDate(lv.start);
                    const end = getJsDate(lv.end || lv.start);

                    if (dateVal >= start && dateVal <= end) {
                        const type = lv.type || "";
                        if (lv.days < 1 || type.includes("반차") || type.includes("조퇴") || type.includes("생일자")) {
                            // [수정] 여기서도 '조퇴' 단독인 경우 반차로 오판하지 않도록 체크 (단, 휴가 파일에 '조퇴'라고 명시된 경우는 보통 조기퇴근 허가이므로 유지할 수도 있음)
                            // 일단 '조퇴' 키워드만 있는 경우는 제외
                            const isJustEarly = type.trim() === '조퇴';
                            if (!isJustEarly) {
                                const raw = lv.raw || "";
                                let detectedAM = !raw.includes("오후");

                                const inT = inVal ? inVal.replace(':', '') : null;
                                const outT = outVal ? outVal.replace(':', '') : null;

                                if (inT && inT.length >= 4) {
                                    const inMin = parseInt(inT.substring(0, 2)) * 60 + parseInt(inT.substring(2, 4));
                                    if (inMin >= 660) detectedAM = true;
                                    else detectedAM = false;
                                } else if (outT && outT.length >= 4) {
                                    const outMin = parseInt(outT.substring(0, 2)) * 60 + parseInt(outT.substring(2, 4));
                                    if (outMin <= 840) detectedAM = false;
                                    else detectedAM = true;
                                }

                                if (detectedAM) isAMHalf = true;
                                else isPMHalf = true;
                            }
                        } else if (lv.days >= 1 || type.includes("연차")) {
                            isFullLeave = true;
                        } else {
                            otherLeaveType = type;
                        }
                    }
                }
            });
        }

        // 승인완료된 연차(isFullLeave)는 검증 대상에서 완전 제외
        if (isFullLeave) return;                          // ← 수정 1 (319라인)

        // 기타 휴가(경조, 보건, 외근 등)
        let isLeaveResolved = false;
        if (otherLeaveType) {
            isLeaveResolved = true;
            isResolved = true;                            // ← 수정 2 (325라인)
        }

        const cleanShift = expandShift(shiftStr);
        const parts = cleanShift.split(/[-~]/);
        const padTime = (s) => {
            if (!s) return "";
            s = String(s).replace(/[^0-9]/g, '');
            if (s.length === 3) s = '0' + s;
            return s.length === 4 ? s.substring(0, 2) + ':' + s.substring(2, 4) : "";
        };

        const expIn = padTime(parts[0]);
        const expOut = padTime(parts[1] || "");

        let reasons = [];
        let inAnom = false;
        let outAnom = false;

        const isValidTime = (t) => t && t.includes(':') && !isNaN(parseInt(t.replace(':', '')));
        const isLeaveMarker = (t) => t && leaveKeywords.some(k => t.includes(k));

        if (!isAMHalf && !isPMHalf) {
            // 일반 근무 — isResolved면 전체 건너뜀
            if (!isResolved) {                            // ← 수정 3 (349라인)
                if (!isValidTime(inVal) && !isLeaveMarker(inVal)) {
                    inAnom = true;
                    reasons.push("출근 기록 없음");
                } else if (isValidTime(inVal) && inVal > expIn) {
                    reasons.push("지각");
                    inAnom = true;
                }

                if (!isValidTime(outVal) && !isLeaveMarker(outVal)) {
                    reasons.push("퇴근 기록 없음");
                    outAnom = true;
                } else if (isValidTime(outVal) && outVal < expOut) {
                    reasons.push("조기퇴근");
                    outAnom = true;
                }

                if (isValidTime(inVal) && isValidTime(outVal) && inVal > outVal) {
                    reasons.push("출근 기록 없음");
                    reasons.push("퇴근 기록 없음");
                    inAnom = true;
                    outAnom = true;
                }
            }
        } else if (isAMHalf) {
            // 오전 반차 (오전 휴가 → 오후 출근)
            // 출근 기록 없음은 정상 (오전 쉬므로), 퇴근만 체크
            if (!isResolved) {
                if (!isValidTime(outVal) && !isLeaveMarker(outVal)) {
                    // 퇴근 기록도 없으면 이상 — 단, 출근 기록 자체가 없을 때는 제외
                    // (오전 반차인데 출근 기록도 없으면 아예 안 온 것이므로 이상 아님)
                    if (isValidTime(inVal)) {
                        reasons.push("퇴근 기록 없음");
                        outAnom = true;
                    }
                } else if (isValidTime(outVal) && outVal < expOut) {
                    reasons.push("조기퇴근");
                    outAnom = true;
                }
                // 출근 기록 없음은 오전 반차이므로 이상 아님 — 체크하지 않음
            }
        } else if (isPMHalf) {
            // 오후 반차 (오전 근무 → 오후 휴가)
            // 퇴근 기록 없음은 정상 (오후 반차이므로), 출근만 체크
            if (!isResolved) {
                if (!isValidTime(inVal) && !isLeaveMarker(inVal)) {
                    inAnom = true;
                    reasons.push("출근 기록 없음");
                } else if (isValidTime(inVal) && inVal > expIn) {
                    reasons.push("지각");
                    inAnom = true;
                }
                // 퇴근 기록 없음은 오후 반차이므로 이상 아님 — 체크하지 않음
            }
        }
        const hasEarly = group.hasEarly;

        if (reasons.length > 0 || hasEarly) {
            anomalies.push({
                date: dateVal,
                name: nameVal,
                shift: shiftStr,
                inTime: inVal || "",
                outTime: outVal || "",
                reason: reasons.length > 0 ? [...new Set(reasons)].join(", ") : "",
                hasEarly: hasEarly,
                originalDate: group.originalDate,
                inAnom: inAnom,
                outAnom: outAnom,
                isResolved: isResolved
            });
        }
    });

    // [추가] 승인대기 휴가 체크
    if (currentLeaveData) {
        currentLeaveData.forEach(lv => {
            if (lv.status && lv.status.includes("승인대기")) {
                const getJsDate = (num) => (typeof num === 'number') ? new Date(Math.round((num - 25569) * 86400 * 1000)) : new Date(String(num).replace(/\./g, '-'));
                const startDate = getJsDate(lv.start);
                const endDate = getJsDate(lv.end);

                let curDay = new Date(startDate);
                while (curDay <= endDate) {
                    const fDate = curDay.toISOString().split('T')[0];
                    if (currentUniqueDates.has(fDate)) {
                        anomalies.push({
                            date: fDate,
                            name: lv.name,
                            shift: "-",
                            inTime: "",
                            outTime: "",
                            reason: "출근 기록 없음, 퇴근 기록 없음", // 승인대기 휴가는 기록 없음으로 통일 (사용자 요청 4종 기준)
                            originalDate: fDate
                        });
                    }
                    curDay.setDate(curDay.getDate() + 1);
                }
            }
        });
    }

    return anomalies;
}