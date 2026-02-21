import puter from "@heyputer/puter.js";
import { config } from "./src/config.js";

async function testPuter() {
    console.log("Checking puter object properties...");
    console.log(Object.keys(puter));

    // Check if auth or login methods exist
    console.log("\nAuth methods:");
    if ('auth' in puter) console.log(Object.keys((puter as any).auth));

    // Set a token directly if possible
    console.log("\nTrying to set token if supported...");
    // Let's see what happens if we just try to chat
    try {
        console.log("Attempting chat...");
        const response = await puter.ai.chat("Say hello", { model: config.puterDefaultModel });
        console.log("Success:", response);
    } catch (e: any) {
        console.error("Chat Error:", e.message);
    }
}

testPuter();
