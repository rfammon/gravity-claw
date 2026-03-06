// Test using the FIXED regex from config.ts
const token = "8191628060:AAHAahQCX_nhaUB-44kEUXneNMlTdkk3R5Q";

// Old buggy regex (double-escaped = strips letters n, r, s)
const buggyResult = token.replace(/['"\\s\\r\\n>]/g, '');

// New fixed regex (proper escapes)
const fixedResult = token.replace(/['">\r\n]/g, '').trim();

console.log("Original:     ", token);
console.log("Buggy regex:  ", buggyResult, buggyResult === token ? "✅" : "❌ CORRUPTED!");
console.log("Fixed regex:  ", fixedResult, fixedResult === token ? "✅" : "❌ CORRUPTED!");
