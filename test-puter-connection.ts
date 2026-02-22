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
        console.log(`📄 Full response object:`);
        console.log(JSON.stringify(response, null, 2));
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        
        // Check if response is valid
        let result = "";
        const resp = response as any;
        if (typeof response === "string") {
            result = response;
        } else if (resp?.message?.content) {
            if (typeof resp.message.content === "string") {
                result = resp.message.content;
            }
        } else if (resp?.content) {
            if (typeof resp.content === "string") {
                result = resp.content;
            }
        } else if (resp?.text) {
            result = resp.text;
        }
        
        if (result) {
            console.log(`✅ Extracted text: ${result.substring(0, 200)}...`);
        } else {
            console.log("⚠️ Could not extract text from response");
        }
        
        return true;
    } catch (err: any) {
        const elapsed = Date.now() - startTime;
        
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("❌ PUTER CONNECTION FAILED!");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`⏱️  Time before failure: ${elapsed}ms`);
        console.log(`🔴 Error: ${err.message}`);
        
        if (err.message.includes("auth") || err.message.includes("login") || err.message.includes("token")) {
            console.log("\n💡 TIP: Puter requires authentication in Node.js environment.");
            console.log("   Options:");
            console.log("   1. Use Puter in browser environment");
            console.log("   2. Set PUTER_TOKEN environment variable (if available)");
            console.log("   3. Code Agent will fallback to OpenRouter automatically");
        }
        
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        
        return false;
    }
}

// Test different models
async function testPuterModels() {
    console.log("🧪 Testing different Puter models...\n");

    const models = [
        "gpt-4o-mini",
        "claude-3-haiku-20240307",
        "moonshotai/kimi-k2.5"
    ];

    for (const model of models) {
        console.log(`Testing model: ${model}`);
        try {
            const response = await puter.ai.chat("Say OK", { model });
            console.log(`   Response: ${JSON.stringify(response).substring(0, 100)}...`);
            console.log("   ✅ Passed\n");
        } catch (err: any) {
            console.log(`   ❌ Failed: ${err.message}\n`);
        }
    }
}

// Run tests
console.log("Starting Puter tests...\n");
testPuterConnection().then(success => {
    if (success) {
        return testPuterModels();
    }
});
