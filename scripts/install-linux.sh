#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Gravity Claw - Android/Linux Installation & Verification Script
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🤖 Gravity Claw - Android/Linux Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# Detect platform
detect_platform() {
    if [ -d "/data/data/com.termux" ] || [ -n "$TERMUX_VERSION" ]; then
        echo "termux"
    elif [ "$(uname -s)" = "Linux" ]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

PLATFORM=$(detect_platform)
echo -e "${YELLOW}📍 Detected platform: ${PLATFORM}${NC}"

# ─── Check Node.js ─────────────────────────────────────────────────
echo -e "\n${BLUE}🔍 Checking Node.js...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found!${NC}"
    
    if [ "$PLATFORM" = "termux" ]; then
        echo -e "${YELLOW}Installing Node.js via pkg...${NC}"
        pkg install nodejs -y
    elif [ "$PLATFORM" = "linux" ]; then
        echo -e "${YELLOW}Please install Node.js:${NC}"
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        echo "  sudo apt-get install -y nodejs"
        exit 1
    fi
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✅ Node.js ${NODE_VERSION}${NC}"

# ─── Check npm ─────────────────────────────────────────────────────
echo -e "\n${BLUE}🔍 Checking npm...${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found!${NC}"
    exit 1
fi

NPM_VERSION=$(npm -v)
echo -e "${GREEN}✅ npm ${NPM_VERSION}${NC}"

# ─── Check Python (optional, for TTS fallback) ─────────────────────
echo -e "\n${BLUE}🔍 Checking Python (optional)...${NC}"

if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}✅ ${PYTHON_VERSION}${NC}"
else
    echo -e "${YELLOW}⚠️ Python not found (TTS features may be limited)${NC}"
fi

# ─── Install Dependencies ──────────────────────────────────────────
echo -e "\n${BLUE}📦 Installing dependencies...${NC}"

if [ "$PLATFORM" = "termux" ]; then
    # Android/Termux: Skip native modules that may fail
    echo -e "${YELLOW}Installing with --ignore-scripts (Termux mode)${NC}"
    npm install --ignore-scripts
    
    # Try to build better-sqlite3 manually
    echo -e "${YELLOW}Attempting to build better-sqlite3...${NC}"
    npm rebuild better-sqlite3 2>/dev/null || {
        echo -e "${YELLOW}⚠️ better-sqlite3 build failed, will use sql.js fallback${NC}"
    }
else
    npm install
fi

# ─── Install Platform-Specific Dependencies ────────────────────────
echo -e "\n${BLUE}📦 Installing platform-specific dependencies...${NC}"

if [ "$PLATFORM" = "termux" ]; then
    # Ensure sql.js is available as fallback
    npm install sql.js --save || true
fi

# ─── Check Environment Variables ───────────────────────────────────
echo -e "\n${BLUE}🔍 Checking environment variables...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️ .env file not found!${NC}"
    echo -e "${YELLOW}Creating .env from .env.example...${NC}"
    cp .env.example .env
    echo -e "${RED}❌ Please edit .env with your API keys before running!${NC}"
    exit 1
fi

# Check required env vars
REQUIRED_VARS=("TELEGRAM_BOT_TOKEN" "OPENROUTER_API_KEY" "GROQ_API_KEY" "ALLOWED_USER_IDS")
MISSING_VARS=()

for VAR in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${VAR}=" .env || grep -q "^${VAR}=$" .env; then
        MISSING_VARS+=("$VAR")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing required environment variables:${NC}"
    for VAR in "${MISSING_VARS[@]}"; do
        echo -e "   ${RED}• ${VAR}${NC}"
    done
    exit 1
fi

echo -e "${GREEN}✅ All required environment variables are set${NC}"

# ─── TypeScript Check ──────────────────────────────────────────────
echo -e "\n${BLUE}🔍 Checking TypeScript compilation...${NC}"

if npx tsc --noEmit 2>/dev/null; then
    echo -e "${GREEN}✅ TypeScript compiles successfully${NC}"
else
    echo -e "${RED}❌ TypeScript compilation failed!${NC}"
    exit 1
fi

# ─── Memory Check ───────────────────────────────────────────────────
echo -e "\n${BLUE}🔍 Checking system resources...${NC}"

TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))

if [ "$TOTAL_MEM_MB" -lt 1024 ]; then
    echo -e "${YELLOW}⚠️ Low memory detected (${TOTAL_MEM_MB}MB)${NC}"
    echo -e "${YELLOW}   Browser features will be disabled${NC}"
    echo -e "${YELLOW}   Low resource mode will be enabled${NC}"
else
    echo -e "${GREEN}✅ Memory: ${TOTAL_MEM_MB}MB${NC}"
fi

# ─── Final Summary ─────────────────────────────────────────────────
echo -e "\n${GREEN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Installation Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

echo -e "${BLUE}Platform:${NC} $PLATFORM"
echo -e "${BLUE}Node.js:${NC} $NODE_VERSION"
echo -e "${BLUE}Memory:${NC} ${TOTAL_MEM_MB}MB"

if [ "$PLATFORM" = "termux" ]; then
    echo -e "\n${YELLOW}📱 Termux-specific notes:${NC}"
    echo "   • Browser features are disabled (low resource mode)"
    echo "   • Using sql.js for SQLite (no native compilation needed)"
    echo "   • Run with: npm run start"
else
    echo -e "\n${BLUE}🚀 To start:${NC}"
    echo "   npm run dev     # Development (with auto-reload)"
    echo "   npm run start   # Production"
fi

echo -e "\n${BLUE}📚 Documentation:${NC}"
echo "   README.md       # General docs"
echo "   ANDROID.md      # Android/Termux guide"

echo ""
