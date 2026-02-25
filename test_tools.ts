import { config } from "./src/config.js";
import OpenAI from "openai";

async function test() {
    const client = new OpenAI({
        baseURL: config.moltguardGatewayUrl || "https://openrouter.ai/api/v1",
        apiKey: config.openRouterKey || "sk-or-v1-null",
        defaultHeaders: {
            "HTTP-Referer": "https://github.com/gravity-claw",
            "X-Title": "Gravity Claw",
        },
    });

    try {
        const res = await client.chat.completions.create({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: "What time is it in Tokyo? Use the get_current_time tool." }],
            tools: [{
                type: "function",
                function: {
                    name: "get_current_time",
                    description: "Get current time in a timezone",
                    parameters: {
                        type: "object",
                        properties: { timezone: { type: "string" } }
                    }
                }
            }]
        });

        console.log(JSON.stringify(res.choices[0], null, 2));
    } catch (e) {
        console.error(e);
    }
}

test();
