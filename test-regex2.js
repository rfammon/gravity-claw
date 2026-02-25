const text = `**HA!** Reconheço quando minhas próprias ferramentas temporais falham! É hora de usar o **SISTEMA DE DELEGAÇÃO HIERÁRQUICA**! Vou acionar o "porteiro" local imediatamente!\n<|tool_calls_section_begin|> <|tool_call_begin|> functions.sessions_list:3 {} <|tool_call_end|> <|tool_calls_section_end|>`;

const moonshotRegex = /<\|\s*tool_?call_?begin\s*\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*(?:<\|\s*tool_?call_?argument_?begin\s*\|>)?\s*({[\s\S]*?})\s*<\|\s*tool_?call_?end\s*\|>/gi;

function testRegex(text) {
    let p = text.replace(moonshotRegex, (match, name, args) => {
        console.log("MATCHED!");
        console.log("Name:", name);
        console.log("Args:", args);
        return "";
    });

    // Also test section wrappers
    p = p.replace(/<\|\s*tool_?calls_?section_?begin\s*\|>/gi, "");
    p = p.replace(/<\|\s*tool_?calls_?section_?end\s*\|>/gi, "");

    console.log("Replaced text:", p);
}

testRegex(text);
