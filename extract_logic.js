const fs = require('fs');

try {
    const lines = fs.readFileSync('Dow_근태.html', 'utf8').split('\n');

    // Make sure we have enough lines
    if (lines.length < 2855) {
        throw new Error('Not enough lines in Dow_근태.html');
    }

    const norm_lines = lines.slice(1347, 1353);
    const clean_lines = lines.slice(2084, 2108);
    const calc_lines = lines.slice(2546, 2855);

    calc_lines[0] = calc_lines[0].replace('function calculateAnomalies(combinedData)', 'function calculateAnomalies(combinedData, config)');
    calc_lines.splice(1, 0, '    const { employeeConfigList = [], manualEarlyPunches = {}, currentLeaveData = [], currentUniqueDates = new Set() } = config || {};');

    let outContent = '// shared_logic.js\n\n';

    norm_lines.forEach(line => {
        let l = line.replace('const normalizeName = (name) =>', 'function normalizeName(name)');
        if (l.includes('{')) l = l.trimStart();
        outContent += l + '\n';
    });

    outContent += '\n\n';

    clean_lines.forEach(line => {
        outContent += line + '\n';
    });

    outContent += '\n\n';

    calc_lines.forEach(line => {
        outContent += line + '\n';
    });

    fs.writeFileSync('shared_logic.js', outContent, 'utf8');
    console.log("SUCCESS");
} catch (err) {
    console.error("FAILED:", err);
}
