/**
 * Adaptive Browser Tool
 * 
 * Works across all platforms with automatic fallbacks:
 * - Full Playwright (Linux/Windows with Chromium)
 * - Puppeteer (alternative)
 * - Fetch-only mode (Android/Termux, no browser)
 * 
 * Respects platform resource limits.
 */

import * as fs from "fs";
import * as path from "path";
import { getPlatformInfo, getDataDir } from "./platform.js";

export interface BrowserResult {
  success: boolean;
  content: string;
  type: "html" | "text" | "screenshot" | "error";
  metadata?: {
    url: string;
    loadTime: number;
    platform: string;
  };
}

type BrowserMode = "playwright" | "puppeteer" | "fetch" | "disabled";

let browserMode: BrowserMode | null = null;
let browserInstance: any = null;

/**
 * Detect available browser mode
 */
async function detectBrowserMode(): Promise<BrowserMode> {
  const platformInfo = await getPlatformInfo();

  // Low resource mode: disable browser entirely
  if (platformInfo.lowResourceMode) {
    console.log("🌐 Browser: Disabled (low resource mode)");
    return "disabled";
  }

  // Check for Chromium availability
  if (!platformInfo.hasChromium) {
    console.log("🌐 Browser: Fetch-only mode (no Chromium)");
    return "fetch";
  }

  // Try Playwright first
  try {
    await import("playwright");
    console.log("🌐 Browser: Playwright mode");
    return "playwright";
  } catch {
    // Try Puppeteer as fallback
    try {
      // @ts-ignore - puppeteer is an optional dependency
      await import("puppeteer");
      console.log("🌐 Browser: Puppeteer mode");
      return "puppeteer";
    } catch {
      console.log("🌐 Browser: Fetch-only mode (no browser library)");
      return "fetch";
    }
  }
}

/**
 * Initialize browser based on available mode
 */
async function initBrowser(): Promise<void> {
  if (browserMode) return;

  browserMode = await detectBrowserMode();

  if (browserMode === "playwright") {
    const { chromium } = await import("playwright");
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer"
      ]
    });
  } else if (browserMode === "puppeteer") {
    // @ts-ignore - puppeteer is an optional dependency
    const puppeteer = await import("puppeteer");
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
  }
}

/**
 * Browse a URL with automatic mode selection
 */
export async function browseUrl(
  url: string,
  action: "extract" | "screenshot" | "html" = "extract"
): Promise<BrowserResult> {
  await initBrowser();
  const startTime = Date.now();
  const platformInfo = await getPlatformInfo();

  try {
    // Fetch-only mode: use simple HTTP fetch
    if (browserMode === "fetch" || browserMode === "disabled") {
      return await fetchUrl(url, action);
    }

    // Browser mode: use Playwright or Puppeteer
    if (browserMode === "playwright") {
      return await browsePlaywright(url, action, startTime);
    } else if (browserMode === "puppeteer") {
      return await browsePuppeteer(url, action, startTime);
    }

    // Fallback to fetch
    return await fetchUrl(url, action);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // If browser fails, try fetch as fallback
    if (browserMode !== "fetch" && browserMode !== "disabled") {
      console.log(`⚠️ Browser failed, falling back to fetch: ${errorMessage}`);
      return await fetchUrl(url, action);
    }

    return {
      success: false,
      content: `Error browsing URL: ${errorMessage}`,
      type: "error",
      metadata: {
        url,
        loadTime: Date.now() - startTime,
        platform: platformInfo.platform
      }
    };
  }
}

/**
 * Browse using Playwright
 */
async function browsePlaywright(
  url: string,
  action: "extract" | "screenshot" | "html",
  startTime: number
): Promise<BrowserResult> {
  const page = await browserInstance.newPage();
  
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    let content: string;
    let type: "text" | "html" | "screenshot";

    if (action === "screenshot") {
      const dataDir = getDataDir();
      const screenshotPath = path.join(dataDir, `screenshot-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const buffer = fs.readFileSync(screenshotPath);
      content = `Screenshot saved (${buffer.length} bytes): ${screenshotPath}`;
      type = "screenshot";
    } else if (action === "html") {
      content = await page.content();
      type = "html";
    } else {
      content = await page.innerText("body");
      type = "text";
    }

    return {
      success: true,
      content: content.substring(0, 50000), // Limit content size
      type,
      metadata: {
        url,
        loadTime: Date.now() - startTime,
        platform: "playwright"
      }
    };
  } finally {
    await page.close();
  }
}

/**
 * Browse using Puppeteer
 */
async function browsePuppeteer(
  url: string,
  action: "extract" | "screenshot" | "html",
  startTime: number
): Promise<BrowserResult> {
  const page = await browserInstance.newPage();
  
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    let content: string;
    let type: "text" | "html" | "screenshot";

    if (action === "screenshot") {
      const dataDir = getDataDir();
      const screenshotPath = path.join(dataDir, `screenshot-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const buffer = fs.readFileSync(screenshotPath);
      content = `Screenshot saved (${buffer.length} bytes): ${screenshotPath}`;
      type = "screenshot";
    } else if (action === "html") {
      content = await page.content();
      type = "html";
    } else {
      content = await page.evaluate(() => document.body?.innerText || "");
      type = "text";
    }

    return {
      success: true,
      content: content.substring(0, 50000),
      type,
      metadata: {
        url,
        loadTime: Date.now() - startTime,
        platform: "puppeteer"
      }
    };
  } finally {
    await page.close();
  }
}

/**
 * Simple HTTP fetch (works everywhere)
 */
async function fetchUrl(
  url: string,
  action: "extract" | "screenshot" | "html"
): Promise<BrowserResult> {
  const startTime = Date.now();
  const platformInfo = await getPlatformInfo();

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GravityClaw/1.0)"
      }
    });

    if (!response.ok) {
      return {
        success: false,
        content: `HTTP ${response.status}: ${response.statusText}`,
        type: "error",
        metadata: { url, loadTime: Date.now() - startTime, platform: "fetch" }
      };
    }

    let content = await response.text();

    // Simple text extraction: remove HTML tags
    if (action === "extract") {
      content = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    return {
      success: true,
      content: content.substring(0, 50000),
      type: action === "html" ? "html" : "text",
      metadata: {
        url,
        loadTime: Date.now() - startTime,
        platform: "fetch"
      }
    };
  } catch (err) {
    return {
      success: false,
      content: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
      type: "error",
      metadata: { url, loadTime: Date.now() - startTime, platform: "fetch" }
    };
  }
}

/**
 * Close browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore errors on close
    }
    browserInstance = null;
  }
  browserMode = null;
}

/**
 * Get current browser mode
 */
export function getBrowserMode(): string {
  return browserMode || "not initialized";
}
