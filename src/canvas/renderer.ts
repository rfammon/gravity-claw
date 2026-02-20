import { chromium, type Browser } from "playwright";

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (!browserInstance) {
        browserInstance = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browserInstance;
}

export async function renderHtmlToImage(html: string): Promise<Buffer> {
    const browser = await getBrowser();
    const context = await browser.newContext({
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 2, // High DPI for better readability
    });

    // Create a very generic dark mode wrapper to ensure widgets look good
    const wrappedHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {
                background-color: #1a1a1a;
                color: #ffffff;
                font-family: 'Segoe UI', system-ui, sans-serif;
                margin: 0;
                padding: 40px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                box-sizing: border-box;
            }
            .canvas-container {
                width: 100%;
                max-width: 100%;
                background: #2a2a2a;
                border: 1px solid #333;
                border-radius: 12px;
                padding: 24px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
        </style>
    </head>
    <body>
        <div class="canvas-container" id="target-element">
            ${html}
        </div>
        <script>
            // Easiest way to force any embedded scripts to execute
            setTimeout(() => {
                const event = new Event('DOMContentLoaded');
                document.dispatchEvent(event);
            }, 50);
        </script>
    </body>
    </html>
    `;

    const page = await context.newPage();

    try {
        await page.setContent(wrappedHtml, { waitUntil: 'networkidle' });

        // Let any animations or minor layout shifts settle
        await page.waitForTimeout(500);

        // Try to snap just the widget to avoid massive black borders, 
        // but fallback to the whole page if it fails.
        let buffer: Buffer;
        try {
            const locator = page.locator('#target-element');
            buffer = await locator.screenshot({ type: 'png' });
        } catch {
            buffer = await page.screenshot({ type: 'png', fullPage: false });
        }

        return buffer;
    } finally {
        await page.close();
        await context.close();
    }
}

// Graceful shutdown helper
export async function closeRenderer() {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}
