import Groq from "groq-sdk";
import OpenAI from "openai";
import { tts as edgeTts } from "edge-tts";
import { config } from "./config.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { synthesizeWithMoss } from "./moss-bridge.js";

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
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tmpPath),
            model: "whisper-large-v3",
        });

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
 * Convert text to speech using various providers.
 * Satisfies: 3. Text-to-Speech
 */
export async function synthesizeSpeech(text: string, provider: 'elevenlabs' | 'openai' | 'edge' | 'moss' = 'edge'): Promise<Buffer> {
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

    // Default: Edge TTS (Free) - Portuguese Brazilian Female (Francisca)
    const VOICE = "pt-BR-FranciscaNeural";
    try {
        const audioBuffer = await edgeTts(text, {
            voice: VOICE,
            rate: "+5%",
            pitch: "+0Hz",
        });
        return audioBuffer;
    } catch (error) {
        console.error("❌ Edge-TTS Error:", error);
        throw error;
    }
}
