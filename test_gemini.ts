import { chat } from "./src/llm.js";
import { getOpenAITools } from "./src/tools/registry.js";

// Manually register tools by importing their modules
import "./src/tools/trello.js";
import "./src/tools/web-search.js";

async function test() {
    console.log("--- STARTING GEMINI TOOL TEST ---");
    const tools = getOpenAITools();
    console.log(`Tools registered: ${tools.map(t => t.function.name).join(", ")}`);

    const messages = [
        { role: "system", content: "Você é o Megamind, um assistente inteligente. Use as ferramentas disponíveis se necessário." },
        { role: "user", content: "Quais são as minhas tarefas no Trello?" }
    ];

    console.log("Sending request to Gemini...");
    try {
        const response = await chat(messages as any);
        console.log("--- RESPONSE ---");
        console.log(JSON.stringify(response.choices[0].message, null, 2));

        if (response.choices[0].message.tool_calls) {
            console.log("✅ GEMINI CALLED A TOOL!");
        } else {
            console.log("❌ GEMINI DID NOT CALL A TOOL.");
        }
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
