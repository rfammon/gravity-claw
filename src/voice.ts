import Groq from "groq-sdk";
import OpenAI from "openai";
import { EdgeTTS } from "node-edge-tts";
import { config } from "./config.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { synthesizeWithMoss } from "./moss-bridge.js";
import { withRetry } from "./utils/network.js";

// Initialize APIs
const groq = new Groq({ apiKey: config.groqApiKey });

// Optional OpenAI client (only if key exists)
let openai: OpenAI | null = null;
function getOpenAIClient() {
    if (!openai && process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

/**
 * Transcribe an audio buffer to text using Groq Whisper.
 * Satisfies: 1. Voice Transcription
 */
export async function transcribeVoice(buffer: Buffer): Promise<string> {
    // Groq supports: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
    // Telegram voice messages are usually Ogg Opus (.oga)
    const tmpPath = path.join(os.tmpdir(), `gravity_voice_${Date.now()}.ogg`);

    try {
        fs.writeFileSync(tmpPath, buffer);

        console.log(`🎙️ Sending to Groq (${tmpPath})...`);
        const startTime = Date.now();
        const transcription = await withRetry(
            () => groq.audio.transcriptions.create({
                file: fs.createReadStream(tmpPath),
                model: "whisper-large-v3",
            }),
            { maxRetries: 2 }
        );

        console.log(`🎙️ Transcribed in ${Date.now() - startTime}ms: "${transcription.text}"`);
        return transcription.text;
    } catch (error: any) {
        console.error("❌ Groq Transcription Error:", error);
        throw new Error(`Erro na transcrição: ${error.message}`);
    } finally {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
}

/**
 * Cleans text for Text-to-Speech by removing emojis, markdown asterisks, and underscores.
 */
function cleanTextForSpeech(text: string): string {
    return text
        // Remove standard emojis
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
        .replace(/[\u{1F700}-\u{1F77F}]/gu, '') // Alchemical Symbols
        .replace(/[\u{1F780}-\u{1F7FF}]/gu, '') // Geometric Shapes Extended
        .replace(/[\u{1F800}-\u{1F8FF}]/gu, '') // Supplemental Arrows-C
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols and Pictographs
        .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
        .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
        .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
        .replace(/[\u{FE0F}]/gu, '')            // Variation Selectors
        // Remove markdown formatting
        .replace(/\*/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/#/g, '')
        .trim();
}

/**
 * Convert text to speech using various providers.
 * Satisfies: 3. Text-to-Speech
 */
export async function synthesizeSpeech(rawText: string, provider: 'elevenlabs' | 'openai' | 'edge' | 'moss' = 'edge'): Promise<Buffer> {
    const text = cleanTextForSpeech(rawText);
    console.log(`🔊 Synthesizing speech with ${provider}...`);

    if (provider === 'moss') {
        try {
            const buffer = await synthesizeWithMoss(text);
            if (buffer.length > 0) return buffer;
            console.warn("⚠️ MOSS-TTS returned empty buffer, falling back...");
        } catch (e) {
            console.error("❌ MOSS-TTS error:", e);
        }
    }

    if (provider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
        // ... (existing elevenlabs logic)
    }

    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
        // ... (existing openai logic)
    }

    // Default: Edge TTS (Free) - Portuguese Brazilian Male (Antonio)
    const VOICE = "pt-BR-AntonioNeural";
    const tmpAudioPath = path.join(os.tmpdir(), `gravity_tts_${Date.now()}.mp3`);

    try {
        const tts = new EdgeTTS({
            voice: VOICE,
            rate: "+5%",
            pitch: "+0Hz",
        });

        await withRetry(
            () => tts.ttsPromise(text, tmpAudioPath),
            { maxRetries: 2 }
        );
        const audioBuffer = fs.readFileSync(tmpAudioPath);
        return audioBuffer;
    } catch (error) {
        console.error("❌ Edge-TTS Error:", error);
        throw error;
    } finally {
        try { fs.unlinkSync(tmpAudioPath); } catch { /* ignore */ }
    }
}
