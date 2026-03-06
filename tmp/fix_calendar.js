const fs = require('fs');

const path = 'c:/gravityclaw/src/tools/calendar-tool.ts';
let code = fs.readFileSync(path, 'utf8');

// Fix escaped backticks
code = code.replace(/\\`/g, '`');

// Fix return type of execute
code = code.replace(
    'execute: async (input: Record<string, unknown>) => {',
    'execute: async (input: Record<string, unknown>): Promise<string | import(\'./registry.js\').ToolResult> => {'
);

fs.writeFileSync(path, code);
console.log('Fixed calendar-tool.ts!');
