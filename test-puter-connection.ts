/**
 * Puter Connection Test
 * Tests if Puter AI is working correctly
 */

import puter from "@heyputer/puter.js";

async function testPuterConnection() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🧪 Testing Puter AI Connection");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const testMessage = "Say 'Hello from Puter!' in Brazilian Portuguese.";
    const model = process.env.PUTER_DEFAULT_MODEL || "moonshotai/kimi-k2.5";

    console.log(`📤 Sending test message with model: ${model}`);
    console.log(`   Message: "${testMessage}"\n`);

    const startTime = Date.now();

    try {
        const response = await puter.ai.chat(testMessage, { model });
        const elapsed = Date.now() - startTime;

        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("✅ PUTER CONNECTION SUCCESSFUL!");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`⏱️  Response time: ${elapsed}ms`);
        console.log(`📝 Response type: ${typeof response}`);
        console.log(`📄 Response:\n${response}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        
        return true;
    } catch (err: any) {
        const elapsed = Date.now() - startTime;
        
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("❌ PUTER CONNECTION FAILED!");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`⏱️  Time before failure: ${elapsed}ms`);
        console.log(`🔴 Error: ${err.message}`);
        
        if (err.message.includes("auth") || err.message.includes("login")) {
            console.log("\n💡 TIP: Puter requires authentication.");
            console.log("   Try running in a browser first or check credentials.");
        }
        
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        
        return false;
    }
}

// Also test with different response formats
async function testPuterFormats() {
    console.log("🧪 Testing Puter response formats...\n");

    // Test 1: Simple string
    console.log("Test 1: Simple string prompt");
    try {
        const response = await puter.ai.chat("Say 'OK'", { model: "gpt-4o-mini" });
        console.log(`   Response: ${JSON.stringify(response).substring(0, 100)}...`);
        console.log("   ✅ Passed\n");
    } catch (err: any) {
        console.log(`   ❌ Failed: ${err.message}\n`);
    }

    // Test 2: Array format (conversation)
    console.log("Test 2: Array format (conversation)");
    try {
        const response = await puter.ai.chat([
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Say 'OK'" }
        ], { model: "gpt-4o-mini" });
        console.log(`   Response: ${JSON.stringify(response).substring(0, 100)}...`);
        console.log("   ✅ Passed\n");
    } catch (err: any) {
        console.log(`   ❌ Failed: ${err.message}\n`);
    }

    // Test 3: Kimi model
    console.log("Test 3: Kimi K2.5 model");
    try {
        const response = await puter.ai.chat("Diga 'OK'", { model: "moonshotai/kimi-k2.5" });
        console.log(`   Response: ${JSON.stringify(response).substring(0, 100)}...`);
        console.log("   ✅ Passed\n");
    } catch (err: any) {
        console.log(`   ❌ Failed: ${err.message}\n`);
    }
}

// Run tests
console.log("Starting Puter tests...\n");
testPuterConnection().then(success => {
    if (success) {
        return testPuterFormats();
    }
});
