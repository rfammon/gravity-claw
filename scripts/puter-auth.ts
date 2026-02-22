/**
 * Puter Authentication Script
 * 
 * Run this ONCE to authenticate with Puter.
 * It will open a browser window for login.
 * 
 * Usage: npx tsx scripts/puter-auth.ts
 */

import { init, getAuthToken } from "@heyputer/puter.js/src/init.cjs";

async function authenticate() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔐 Puter Authentication");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n📱 This will open a browser window.");
    console.log("   Please log in with your Puter account.");
    console.log("   Wait for the success message in the terminal.\n");

    try {
        // This opens a browser for authentication
        const authToken = await getAuthToken();
        
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("✅ AUTHENTICATION SUCCESSFUL!");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("\n📝 Your auth token:");
        console.log(authToken.substring(0, 50) + "...");
        
        // Save token to file for later use
        const fs = await import("fs");
        const tokenPath = "./.puter-token";
        fs.writeFileSync(tokenPath, authToken);
        console.log(`\n💾 Token saved to: ${tokenPath}`);
        console.log("   You can set this in your .env as PUTER_TOKEN");
        
    } catch (err) {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("❌ AUTHENTICATION FAILED");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`Error: ${err}`);
    }
}

authenticate();
