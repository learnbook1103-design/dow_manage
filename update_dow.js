const fs = require('fs');

try {
    const lines = fs.readFileSync('Dow_근태.html', 'utf8').split('\n');

    // 1. Update the call site. It's at line 2338 (index 2337). Let's search inside instead of hardcoding to be safe.
    let callIdx = lines.findIndex(l => l.includes('const anomalies = calculateAnomalies(allData);'));
    if (callIdx !== -1) {
        lines[callIdx] = lines[callIdx].replace(
            'calculateAnomalies(allData)',
            'calculateAnomalies(allData, { employeeConfigList, manualEarlyPunches, manualReasons, currentLeaveData, currentUniqueDates })'
        );
    } else {
        console.warn('Could not find call site to update!');
    }

    // 2. Delete calculateAnomalies
    let calcStart = lines.findIndex(l => l.includes('function calculateAnomalies(combinedData) {'));
    if (calcStart !== -1) {
        lines.splice(calcStart, 309);
    } else {
        console.warn('Could not find calculateAnomalies to delete!');
    }

    // 3. Delete cleanTime
    let cleanStart = lines.findIndex(l => l.includes('function cleanTime(timeStr) {'));
    if (cleanStart !== -1) {
        lines.splice(cleanStart, 24);
    } else {
        console.warn('Could not find cleanTime to delete!');
    }

    // 4. Delete normalizeName 
    // Wait, the line is let normalizeName = (name) => { or const normalizeName ...
    let normStart = lines.findIndex(l => l.includes('const normalizeName = (name) => {'));
    if (normStart !== -1) {
        lines.splice(normStart, 6);
    } else {
        console.warn('Could not find normalizeName to delete!');
    }

    // 5. Inject script tag in head
    let headIdx = lines.findIndex(l => l.includes('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'));
    if (headIdx !== -1) {
        lines.splice(headIdx + 1, 0, '    <script src="shared_logic.js"></script>');
    } else {
        console.warn('Could not find supabase script tag!');
    }

    fs.writeFileSync('Dow_근태.html', lines.join('\n'), 'utf8');
    console.log("SUCCESS");
} catch (err) {
    console.error("FAILED:", err);
}
