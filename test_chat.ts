import { config } from "./src/config.js";
config.moltguardGatewayUrl = "";

import "./src/tools/index.js";
import { chat } from "./src/llm.js";

async function test() {
    try {
        console.log("SENDING CHAT REQUEST...");
        const res = await chat([{ role: "user", content: "hello. what tasks are on my trello board?" }]);
        console.log("RESPONSE RECEIVED:");
        console.log(JSON.stringify(res, null, 2));
    } catch (e) {
        console.error("FATAL ERROR:", e);
    }
}

test();
