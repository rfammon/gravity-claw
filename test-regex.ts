import fs from 'fs';

function parseTextToToolCalls(text: string) {
    let content = text;
    const tool_calls: any[] = [];

    const functionCallsRegex = /<function_?calls>([\s\S]*?)<\/function_?calls>/gi;
    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;

    let callIndex = 0;

    content = content.replace(functionCallsRegex, (substring, innerBlocks) => {
        let invokeMatch;
        while ((invokeMatch = invokeRegex.exec(innerBlocks)) !== null) {
            const name = invokeMatch[1];
            const paramsInner = invokeMatch[2];
            const args: any = {};

            let paramMatch;
            while ((paramMatch = paramRegex.exec(paramsInner)) !== null) {
                args[paramMatch[1]] = paramMatch[2].trim();
            }

            tool_calls.push({
                id: `call_${Date.now()}_${callIndex++}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) }
            });
        }
        return "";
    });

    const moonshotRegex = /<\|\s*tool_?call_?begin\s*\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*(?:<\|\s*tool_?call_?argument_?begin\s*\|>)?\s*({[\s\S]*?})\s*<\|\s*tool_?call_?end\s*\|>/gi;

    content = content.replace(moonshotRegex, (substring, name, argsJson) => {
        try { JSON.parse(argsJson); } catch (e) { } return "";
    });

    return content;
}

const largeText = "A".repeat(10000) + "<|tool_call_begin|>" + "A".repeat(1000000) + "<|tool_call_argument_begin|>" + " { " + "A".repeat(1000000) + " } ";

console.log("Starting parsing...");
const start = Date.now();
parseTextToToolCalls(largeText);
console.log(`Finished in ${Date.now() - start}ms`);

const largeText2 = "<function_calls>" + "<invoke name='test'>" + "<parameter name='large'>" + "A".repeat(5000000) + "</parameter></invoke></function_calls>";
console.log("Starting parsing 2...");
const start2 = Date.now();
parseTextToToolCalls(largeText2);
console.log(`Finished 2 in ${Date.now() - start2}ms`);
