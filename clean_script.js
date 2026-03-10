const fs = require('fs');

function removeFunction(code, funcName) {
    let startIdx = code.indexOf(`function ${funcName}(`);
    if (startIdx === -1) {
        startIdx = code.indexOf(`const ${funcName} =`);
        if (startIdx === -1) return code;
    }

    // To cleanly delete, let's find the start of the line
    let lineStartIdx = code.lastIndexOf('\n', startIdx);
    if (lineStartIdx === -1) lineStartIdx = 0;

    let braceIdx = code.indexOf('{', startIdx);
    if (braceIdx === -1) return code;

    let depth = 1;
    let endIdx = braceIdx + 1;
    while (depth > 0 && endIdx < code.length) {
        if (code[endIdx] === '{') depth++;
        if (code[endIdx] === '}') depth--;
        endIdx++;
    }

    // also remove the trailing newline + semicolon if it exists
    if (code[endIdx] === ';') endIdx++;
    if (code[endIdx] === '\n') endIdx++;
    else if (code.substring(endIdx, endIdx + 2) === '\r\n') endIdx += 2;

    return code.substring(0, lineStartIdx) + '\n' + code.substring(endIdx);
}

try {
    let code = fs.readFileSync('script.js', 'utf8');

    code = code.replace(
        'const anomalies = calculateAnomalies(allData);',
        'const anomalies = calculateAnomalies(allData, { employeeConfigList, manualEarlyPunches, manualReasons, currentLeaveData, currentUniqueDates });'
    );

    code = removeFunction(code, 'calculateAnomalies');
    code = removeFunction(code, 'cleanTime');
    code = removeFunction(code, 'normalizeName');

    fs.writeFileSync('script.js', code, 'utf8');
    console.log("SUCCESS");
} catch (err) {
    console.error("FAILED", err);
}
