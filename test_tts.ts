import { EdgeTTS } from "node-edge-tts";
import * as fs from "fs";

async function run() {
    try {
        console.log("Synthesizing...");
        const tts = new EdgeTTS({ voice: "pt-BR-FranciscaNeural" });
        await tts.ttsPromise("Testando 1 2 3", "output.mp3");
        const buf = fs.readFileSync("output.mp3");
        console.log("Success! Buf len:", buf.length);
    } catch (e) {
        console.error("Failed:", e);
    }
}
run();
