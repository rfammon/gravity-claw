// MOSS-TTS Bridge
import * as fs from 'fs';

import * as crypto from "crypto";
import * as path from "path";

/**
 * Secret Storage & Encryption
 * Satisfies: 3. Encrypted Secrets
 */
const ALGORITHM = "aes-256-cbc";
const MASTER_KEY = process.env.MASTER_KEY || "your-fallback-master-key-32chars!!"; // Must be 32 bytes

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(MASTER_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text: string): string {
    const [ivHex, encryptedHex] = text.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(MASTER_KEY), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

/**
 * Security Allowlists
 * Satisfies: 2. Command Allowlists
 */
const ALLOWED_COMMANDS = ["ls", "dir", "get-date", "whoami", "npm test"];
const ALLOWED_PATHS = [process.cwd()];

export function isCommandAllowed(cmd: string): boolean {
    return ALLOWED_COMMANDS.some(allowed => cmd.startsWith(allowed));
}

export function isPathAllowed(filePath: string): boolean {
    const absolute = path.resolve(filePath);
    return ALLOWED_PATHS.some(allowed => absolute.startsWith(path.resolve(allowed)));
}
