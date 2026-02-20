import { config } from "./config.js";

// ─── OCR Space API (Primary) ────────────────────────────────────────
async function ocrSpaceExtract(imageBuffer: Buffer, language: string = "por"): Promise<string> {
    const base64 = `data:image/png;base64,${imageBuffer.toString("base64")}`;

    const form = new URLSearchParams();
    form.append("apikey", config.ocrSpaceApiKey);
    form.append("base64Image", base64);
    form.append("language", language);
    form.append("isOverlayRequired", "false");
    form.append("detectOrientation", "true");
    form.append("scale", "true");
    form.append("OCREngine", "2"); // Engine 2 is better for most cases

    console.log(`👁️ OCR Space: sending ${(imageBuffer.length / 1024).toFixed(0)}KB image (lang=${language})...`);
    const startTime = Date.now();

    const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: form,
    });

    if (!response.ok) {
        throw new Error(`OCR Space HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as any;

    if (data.IsErroredOnProcessing) {
        const errorMsg = data.ErrorMessage?.join(", ") || "Unknown OCR error";
        throw new Error(`OCR Space error: ${errorMsg}`);
    }

    const parsedResults = data.ParsedResults;
    if (!parsedResults || parsedResults.length === 0) {
        return "";
    }

    const text = parsedResults
        .map((r: any) => r.ParsedText || "")
        .join("\n")
        .trim();

    console.log(`✅ OCR Space: extracted ${text.length} chars in ${Date.now() - startTime}ms`);
    return text;
}

// ─── Tesseract.js (Fallback) ────────────────────────────────────────
async function tesseractExtract(imageBuffer: Buffer, language: string = "por"): Promise<string> {
    console.log(`📦 Tesseract.js: processing ${(imageBuffer.length / 1024).toFixed(0)}KB image (lang=${language})...`);
    const startTime = Date.now();

    const Tesseract = await import("tesseract.js");
    const { data } = await Tesseract.recognize(imageBuffer, language, {
        logger: () => { }, // suppress progress logs
    });

    const text = data.text?.trim() || "";
    console.log(`✅ Tesseract.js: extracted ${text.length} chars in ${Date.now() - startTime}ms`);
    return text;
}

// ─── Public API ─────────────────────────────────────────────────────
export interface OcrResult {
    text: string;
    engine: "ocr-space" | "tesseract" | "none";
}

/**
 * Extract text from an image buffer using dual-engine OCR.
 * Primary: OCR Space API | Fallback: Tesseract.js (local)
 */
export async function extractTextFromImage(
    imageBuffer: Buffer,
    language: string = "por"
): Promise<OcrResult> {
    // Try OCR Space first (if API key is configured)
    if (config.ocrSpaceApiKey) {
        try {
            const text = await ocrSpaceExtract(imageBuffer, language);
            if (text.length > 0) {
                return { text, engine: "ocr-space" };
            }
            console.log("⚠️ OCR Space returned empty — trying Tesseract.js...");
        } catch (err) {
            console.warn("⚠️ OCR Space failed, falling back to Tesseract.js:", err);
        }
    } else {
        console.log("ℹ️ No OCR Space API key — using Tesseract.js directly");
    }

    // Fallback to Tesseract.js
    try {
        const text = await tesseractExtract(imageBuffer, language);
        if (text.length > 0) {
            return { text, engine: "tesseract" };
        }
    } catch (err) {
        console.error("❌ Tesseract.js also failed:", err);
    }

    return { text: "", engine: "none" };
}
