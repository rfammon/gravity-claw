#!/usr/bin/env node

/**
 * Post-install script
 * Runs after npm install to check platform and provide setup guidance
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🤖 Gravity Claw - Post-Install Check');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const platform = os.platform();
const arch = os.arch();
const cpus = os.cpus().length;
const totalMemMB = Math.floor(os.totalmem() / (1024 * 1024));

console.log(`📍 Platform: ${platform} (${arch})`);
console.log(`💻 CPUs: ${cpus}`);
console.log(`🧠 Memory: ${totalMemMB} MB`);

// Detect Termux
const isTermux = fs.existsSync('/data/data/com.termux') || 
                 process.env.TERMUX_VERSION ||
                 fs.existsSync(path.join(os.homedir(), '.termux'));

if (isTermux) {
    console.log('\n📱 Termux detected!');
    console.log('   Running in Android/Termux mode.');
    console.log('   Browser features will be disabled.');
    console.log('   Using sql.js for SQLite (no native compilation needed).\n');
}

// Low resource warning
if (totalMemMB < 2048) {
    console.log('\n⚠️  Low memory detected (< 2GB)');
    console.log('   Low resource mode will be enabled automatically.');
    console.log('   Some features may be limited.\n');
}

// Check .env
const envPath = path.join(process.cwd(), '.env');
const envExamplePath = path.join(process.cwd(), '.env.example');

if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
        console.log('⚠️  .env file not found!');
        console.log('   Creating from .env.example...\n');
        fs.copyFileSync(envExamplePath, envPath);
    }
    console.log('❌ Please edit .env with your API keys before running!');
    console.log('   Required: TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY, GROQ_API_KEY, ALLOWED_USER_IDS\n');
}

// Next steps
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🚀 Next Steps');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('1. Edit .env with your API keys:');
console.log('   nano .env\n');
console.log('2. Start the bot:');
console.log('   npm run dev      # Development (auto-reload)');
console.log('   npm run start    # Production\n');

if (platform === 'linux' || isTermux) {
    console.log('3. For detailed Linux/Android setup:');
    console.log('   cat ANDROID.md\n');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
