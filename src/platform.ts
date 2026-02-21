/**
 * Platform Detection & Adaptation System
 * 
 * Detects the runtime platform and provides optimized configurations
 * for Android (Termux), Linux, and Windows environments.
 * 
 * Platform-specific considerations:
 * - Android/Termux: Limited resources, no native modules sometimes
 * - Linux: Full support, optimized for servers
 * - Windows: Full support, development environment
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";

export type Platform = "android" | "linux" | "windows" | "macos" | "unknown";

export interface PlatformInfo {
  platform: Platform;
  isTermux: boolean;
  isMobile: boolean;
  arch: string;
  cpus: number;
  totalMemoryMB: number;
  hasNativeSqlite: boolean;
  hasChromium: boolean;
  homeDir: string;
  tempDir: string;
  recommendedConcurrency: number;
  lowResourceMode: boolean;
}

let cachedInfo: PlatformInfo | null = null;

/**
 * Detect the current platform
 */
export function detectPlatform(): Platform {
  const platform = os.platform();
  const hostname = os.hostname();

  // Check for Termux/Android
  if (platform === "android" || 
      hostname.includes("localhost") && fs.existsSync("/data/data/com.termux")) {
    return "android";
  }

  // Check for Linux
  if (platform === "linux") {
    return "linux";
  }

  // Check for Windows
  if (platform === "win32") {
    return "windows";
  }

  // Check for macOS
  if (platform === "darwin") {
    return "macos";
  }

  return "unknown";
}

/**
 * Check if running in Termux environment
 */
function isTermuxEnvironment(): boolean {
  const env = process.env;
  return !!(
    env.TERMUX_VERSION ||
    env.TERMUX_MAIN_PACKAGE_FORMAT ||
    fs.existsSync("/data/data/com.termux") ||
    fs.existsSync(path.join(os.homedir(), ".termux"))
  );
}

/**
 * Check if better-sqlite3 native module is available
 */
async function checkNativeSqlite(): Promise<boolean> {
  try {
    await import("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Chromium is available for Playwright
 */
async function checkChromium(): Promise<boolean> {
  try {
    // Check common paths for Chromium
    const paths = [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
      path.join(os.homedir(), ".cache/ms-playwright")
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }

    // On Windows, check Program Files
    if (os.platform() === "win32") {
      const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
      const chromePath = path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe");
      if (fs.existsSync(chromePath)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get complete platform information
 */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (cachedInfo) {
    return cachedInfo;
  }

  const platform = detectPlatform();
  const isTermux = isTermuxEnvironment();
  const cpus = os.cpus();
  const totalMemoryMB = Math.floor(os.totalmem() / (1024 * 1024));
  
  // Low resource mode: less than 2GB RAM or running on mobile
  const lowResourceMode = totalMemoryMB < 2048 || platform === "android";

  // Recommended concurrency based on resources
  let recommendedConcurrency = Math.min(cpus.length, 4);
  if (lowResourceMode) {
    recommendedConcurrency = Math.min(cpus.length, 2);
  }

  const hasNativeSqlite = await checkNativeSqlite();
  const hasChromium = await checkChromium();

  cachedInfo = {
    platform,
    isTermux,
    isMobile: platform === "android",
    arch: os.arch(),
    cpus: cpus.length,
    totalMemoryMB,
    hasNativeSqlite,
    hasChromium,
    homeDir: os.homedir(),
    tempDir: os.tmpdir(),
    recommendedConcurrency,
    lowResourceMode
  };

  return cachedInfo;
}

/**
 * Log platform information at startup
 */
export async function logPlatformInfo(): Promise<void> {
  const info = await getPlatformInfo();
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🖥️  Platform Detection");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   Platform: ${info.platform.toUpperCase()}`);
  console.log(`   Architecture: ${info.arch}`);
  console.log(`   CPUs: ${info.cpus}`);
  console.log(`   Memory: ${info.totalMemoryMB} MB`);
  console.log(`   Low Resource Mode: ${info.lowResourceMode ? "YES" : "no"}`);
  console.log(`   Native SQLite: ${info.hasNativeSqlite ? "YES" : "NO (will use sql.js)"}`);
  console.log(`   Chromium: ${info.hasChromium ? "YES" : "NO (browser tool disabled)"}`);
  console.log(`   Recommended Concurrency: ${info.recommendedConcurrency}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

/**
 * Get platform-specific configuration
 */
export async function getPlatformConfig(): Promise<{
  dbBackend: "better-sqlite3" | "sql.js";
  enableBrowserTool: boolean;
  maxConcurrentTools: number;
  memoryLimitMB: number;
  cacheTTL: number;
  voiceEnabled: boolean;
}> {
  const info = await getPlatformInfo();

  return {
    dbBackend: info.hasNativeSqlite ? "better-sqlite3" : "sql.js",
    enableBrowserTool: info.hasChromium && !info.lowResourceMode,
    maxConcurrentTools: info.recommendedConcurrency,
    memoryLimitMB: info.lowResourceMode ? 256 : 512,
    cacheTTL: info.lowResourceMode ? 60000 : 300000, // 1 min vs 5 min
    voiceEnabled: !info.isTermux // Voice may have issues in Termux
  };
}

/**
 * Get the appropriate data directory for the platform
 */
export function getDataDir(): string {
  const info = cachedInfo || { platform: detectPlatform(), homeDir: os.homedir() };
  
  // Android/Termux: Use home directory
  if (info.platform === "android") {
    return path.join(info.homeDir, ".gravity_claw");
  }

  // Linux/macOS: Use XDG or home
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) {
    return path.join(xdgData, "gravity-claw");
  }

  // Windows: Use AppData
  if (info.platform === "windows") {
    const appData = process.env.APPDATA || path.join(info.homeDir, "AppData", "Roaming");
    return path.join(appData, "gravity-claw");
  }

  // Default: home directory
  return path.join(info.homeDir, ".gravity_claw");
}

/**
 * Ensure data directory exists
 */
export function ensureDataDir(): string {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`📂 Created data directory: ${dataDir}`);
  }
  return dataDir;
}

// Re-export for convenience
export { cachedInfo as platformInfo };
