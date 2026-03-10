import sys

try:
    with open("Dow_근태.html", "r", encoding="utf-8") as f:
        lines = f.readlines()

    norm_lines = lines[1347:1353]
    clean_lines = lines[2084:2108]
    calc_lines = lines[2546:2855]

    calc_lines[0] = calc_lines[0].replace('function calculateAnomalies(combinedData)', 'function calculateAnomalies(combinedData, config)')
    calc_lines.insert(1, '    const { employeeConfigList = [], manualEarlyPunches = {}, currentLeaveData = [], currentUniqueDates = new Set() } = config || {};\n')

    with open("shared_logic.js", "w", encoding="utf-8") as out:
        out.write("// shared_logic.js\n\n")
        
        for line in norm_lines:
            line = line.replace('const normalizeName = (name) =>', 'function normalizeName(name)')
            out.write(line.lstrip() if '{' in line else line)
        
        out.write("\n\n")
        
        for line in clean_lines:
            out.write(line)
            
        out.write("\n\n")
        
        for line in calc_lines:
            out.write(line)
    print("SUCCESS")
except Exception as e:
    print(f"FAILED: {e}")
