import { chromium, Browser, Page } from "playwright";

/**
 * Browser Automation Tool
 * Satisfies: 1. Browser Automation
 */
class BrowserTool {
    private browser: Browser | null = null;

    async ensureBrowser() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
        }
        return this.browser;
    }

    async browse(url: string, action: 'screenshot' | 'extract' | 'pdf' = 'extract'): Promise<string | Buffer> {
        const browser = await this.ensureBrowser();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'networkidle' });

            if (action === 'screenshot') {
                return await page.screenshot();
            }

            if (action === 'extract') {
                const text = await page.innerText('body');
                return text.trim();
            }

            return "Action not supported yet.";
        } finally {
            await page.close();
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

export const browserTool = new BrowserTool();
