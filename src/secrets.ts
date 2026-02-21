/**
 * Encrypted Secrets Storage
 * 
 * AES-256-CBC encrypted storage for API keys and sensitive data.
 * - Secrets are encrypted at rest with a master key
 * - Decryption only happens at runtime (in-memory)
 * - Master key can be provided via MASTER_KEY env var or generated on first run
 * 
 * Security Model:
 * - Secrets file is encrypted blob (unreadable without master key)
 * - Master key should be stored securely (env var, key manager, etc.)
 * - In-memory cache with automatic expiration
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
const SECRETS_FILE = path.join(GRAVITY_DIR, "secrets.enc");
const KEY_FILE = path.join(GRAVITY_DIR, "master.key");

interface SecretEntry {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

interface SecretsVault {
  version: number;
  createdAt: string;
  updatedAt: string;
  secrets: SecretEntry[];
}

class SecretManager {
  private masterKey: Buffer | null = null;
  private vault: SecretsVault | null = null;
  private cache: Map<string, { value: string; expires: number }> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize the secret manager with a master key
   */
  initialize(): void {
    if (!fs.existsSync(GRAVITY_DIR)) {
      fs.mkdirSync(GRAVITY_DIR, { recursive: true });
    }

    // Try to get master key from env first
    const envKey = process.env.MASTER_KEY;
    if (envKey) {
      this.masterKey = this.deriveKey(envKey, "gravity-claw-salt");
      console.log("🔐 Secret Manager: Using MASTER_KEY from environment");
    } else if (fs.existsSync(KEY_FILE)) {
      // Load existing master key
      const keyData = fs.readFileSync(KEY_FILE, "utf-8");
      this.masterKey = Buffer.from(keyData, "hex");
      console.log("🔐 Secret Manager: Loaded existing master key");
    } else {
      // Generate new master key
      this.masterKey = crypto.randomBytes(KEY_LENGTH);
      fs.writeFileSync(KEY_FILE, this.masterKey.toString("hex"), { mode: 0o600 });
      console.log("🔐 Secret Manager: Generated new master key (save this!):");
      console.log(`   export MASTER_KEY="${this.masterKey.toString("hex")}"`);
    }

    // Load or create vault
    this.loadVault();
  }

  /**
   * Derive a key from a password using PBKDF2
   */
  private deriveKey(password: string, salt: string): Buffer {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
  }

  /**
   * Load the encrypted vault from disk
   */
  private loadVault(): void {
    if (!fs.existsSync(SECRETS_FILE)) {
      this.vault = {
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        secrets: []
      };
      this.saveVault();
      console.log("🔐 Secret Manager: Created new secrets vault");
      return;
    }

    try {
      const encrypted = fs.readFileSync(SECRETS_FILE);
      const decrypted = this.decrypt(encrypted);
      this.vault = JSON.parse(decrypted);
      console.log("🔐 Secret Manager: Loaded secrets vault");
    } catch (err) {
      console.error("❌ Failed to load secrets vault:", err);
      throw new Error("Failed to decrypt secrets vault. Check MASTER_KEY.");
    }
  }

  /**
   * Save the vault to disk (encrypted)
   */
  private saveVault(): void {
    if (!this.vault || !this.masterKey) {
      throw new Error("Vault not initialized");
    }

    this.vault.updatedAt = new Date().toISOString();
    const plaintext = JSON.stringify(this.vault);
    const encrypted = this.encrypt(Buffer.from(plaintext));
    
    fs.writeFileSync(SECRETS_FILE, encrypted, { mode: 0o600 });
  }

  /**
   * Encrypt data using AES-256-CBC
   */
  private encrypt(data: Buffer): Buffer {
    if (!this.masterKey) {
      throw new Error("Master key not initialized");
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);

    // Prepend IV to encrypted data
    return Buffer.concat([iv, encrypted]);
  }

  /**
   * Decrypt data using AES-256-CBC
   */
  private decrypt(data: Buffer): string {
    if (!this.masterKey) {
      throw new Error("Master key not initialized");
    }

    const iv = data.subarray(0, IV_LENGTH);
    const encrypted = data.subarray(IV_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString("utf-8");
  }

  /**
   * Store a secret (encrypts and saves to vault)
   */
  setSecret(key: string, value: string, metadata?: Record<string, unknown>): void {
    if (!this.vault) {
      throw new Error("Vault not initialized");
    }

    const now = new Date().toISOString();
    const existingIndex = this.vault.secrets.findIndex(s => s.key === key);

    if (existingIndex >= 0) {
      this.vault.secrets[existingIndex] = {
        ...this.vault.secrets[existingIndex],
        value,
        updatedAt: now,
        metadata
      };
    } else {
      this.vault.secrets.push({
        key,
        value,
        createdAt: now,
        updatedAt: now,
        metadata
      });
    }

    this.saveVault();
    this.cache.delete(key); // Invalidate cache
    console.log(`🔐 Secret stored: ${key}`);
  }

  /**
   * Retrieve a secret (decrypts at runtime, caches in memory)
   */
  getSecret(key: string): string | null {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    if (!this.vault) {
      throw new Error("Vault not initialized");
    }

    const entry = this.vault.secrets.find(s => s.key === key);
    if (!entry) {
      return null;
    }

    // Cache for TTL
    this.cache.set(key, {
      value: entry.value,
      expires: Date.now() + this.cacheTTL
    });

    return entry.value;
  }

  /**
   * Check if a secret exists
   */
  hasSecret(key: string): boolean {
    if (!this.vault) return false;
    return this.vault.secrets.some(s => s.key === key);
  }

  /**
   * Delete a secret
   */
  deleteSecret(key: string): boolean {
    if (!this.vault) return false;

    const index = this.vault.secrets.findIndex(s => s.key === key);
    if (index < 0) return false;

    this.vault.secrets.splice(index, 1);
    this.saveVault();
    this.cache.delete(key);
    console.log(`🔐 Secret deleted: ${key}`);
    return true;
  }

  /**
   * List secret keys (not values!)
   */
  listSecrets(): string[] {
    if (!this.vault) return [];
    return this.vault.secrets.map(s => s.key);
  }

  /**
   * Get secret metadata (without value)
   */
  getSecretMetadata(key: string): { createdAt: string; updatedAt: string; metadata?: Record<string, unknown> } | null {
    if (!this.vault) return null;
    const entry = this.vault.secrets.find(s => s.key === key);
    if (!entry) return null;
    
    return {
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      metadata: entry.metadata
    };
  }

  /**
   * Rotate the master key
   */
  rotateMasterKey(newMasterKey?: string): void {
    const oldKey = this.masterKey;
    
    if (newMasterKey) {
      this.masterKey = this.deriveKey(newMasterKey, "gravity-claw-salt");
    } else {
      this.masterKey = crypto.randomBytes(KEY_LENGTH);
    }

    // Update key file
    fs.writeFileSync(KEY_FILE, this.masterKey.toString("hex"), { mode: 0o600 });
    
    // Re-save vault with new key
    this.saveVault();
    
    console.log("🔐 Master key rotated successfully");
    console.log(`   New MASTER_KEY: ${this.masterKey.toString("hex")}`);
  }

  /**
   * Clear in-memory cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log("🔐 Secret cache cleared");
  }

  /**
   * Export vault (for backup - still encrypted)
   */
  exportVault(): Buffer {
    if (!fs.existsSync(SECRETS_FILE)) {
      throw new Error("No secrets vault exists");
    }
    return fs.readFileSync(SECRETS_FILE);
  }

  /**
   * Import vault (from backup)
   */
  importVault(encryptedData: Buffer): void {
    fs.writeFileSync(SECRETS_FILE, encryptedData, { mode: 0o600 });
    this.loadVault();
    console.log("🔐 Vault imported successfully");
  }
}

// Singleton instance
let secretManager: SecretManager | null = null;

/**
 * Get the global secret manager instance
 */
export function getSecretManager(): SecretManager {
  if (!secretManager) {
    secretManager = new SecretManager();
    secretManager.initialize();
  }
  return secretManager;
}

/**
 * Initialize secret manager (call at startup)
 */
export function initializeSecrets(): void {
  getSecretManager();
}

// Convenience exports
export const setSecret = (key: string, value: string, metadata?: Record<string, unknown>) => 
  getSecretManager().setSecret(key, value, metadata);

export const getSecret = (key: string): string | null => 
  getSecretManager().getSecret(key);

export const hasSecret = (key: string): boolean => 
  getSecretManager().hasSecret(key);

export const deleteSecret = (key: string): boolean => 
  getSecretManager().deleteSecret(key);

export const listSecrets = (): string[] => 
  getSecretManager().listSecrets();

export const getSecretMetadata = (key: string) => 
  getSecretManager().getSecretMetadata(key);

export const rotateMasterKey = (newKey?: string) => 
  getSecretManager().rotateMasterKey(newKey);

export const clearSecretCache = () => 
  getSecretManager().clearCache();
