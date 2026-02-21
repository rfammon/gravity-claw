import { registerTool } from "./registry.js";
import {
  setSecret,
  getSecret,
  hasSecret,
  deleteSecret,
  listSecrets,
  getSecretMetadata,
  rotateMasterKey,
  clearSecretCache,
  initializeSecrets
} from "../secrets.js";

// Register all secret management tools
export function registerSecretTools(): void {
  // Initialize secrets at module load
  initializeSecrets();

  registerTool({
    name: "secret_set",
    description: "Store an encrypted secret. The value will be encrypted at rest with AES-256-CBC. Use this to securely store API keys, tokens, and passwords.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Unique identifier for the secret (e.g., 'OPENAI_API_KEY')" },
        value: { type: "string", description: "The secret value to encrypt and store" },
        description: { type: "string", description: "Optional description of what this secret is for" }
      },
      required: ["key", "value"]
    },
    execute: async ({ key, value, description }) => {
      try {
        const metadata = description ? { description: String(description) } : undefined;
        setSecret(String(key), String(value), metadata);
        return JSON.stringify({ 
          success: true, 
          message: `Secret '${key}' stored securely`,
          hint: "Value is encrypted at rest. Use secret_get to retrieve at runtime."
        });
      } catch (err) {
        return JSON.stringify({ 
          success: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    }
  });

  registerTool({
    name: "secret_get",
    description: "Retrieve a secret value. ONLY use when you actually need the value (e.g., to make an API call). Never expose secrets in responses to users.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The secret key to retrieve" },
        mask: { type: "boolean", description: "If true, returns masked value (*****) instead of actual value", default: true }
      },
      required: ["key"]
    },
    execute: async ({ key, mask }) => {
      try {
        const value = getSecret(String(key));
        if (value === null) {
          return JSON.stringify({ success: false, error: `Secret '${key}' not found` });
        }

        // By default, mask the value for safety
        if (mask !== false) {
          const masked = value.length > 4 
            ? value.substring(0, 2) + "*****" + value.substring(value.length - 2)
            : "*****";
          return JSON.stringify({ 
            success: true, 
            key: String(key),
            value: masked,
            masked: true,
            hint: "Use mask=false to get actual value (be careful!)"
          });
        }

        return JSON.stringify({ 
          success: true, 
          key: String(key),
          value: value,
          warning: "Actual secret value returned - handle with care!"
        });
      } catch (err) {
        return JSON.stringify({ 
          success: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    }
  });

  registerTool({
    name: "secret_exists",
    description: "Check if a secret exists without retrieving its value. Safe to use.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The secret key to check" }
      },
      required: ["key"]
    },
    execute: async ({ key }) => {
      const exists = hasSecret(String(key));
      return JSON.stringify({ key: String(key), exists });
    }
  });

  registerTool({
    name: "secret_list",
    description: "List all stored secret keys (not values). Safe to use.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const keys = listSecrets();
      const details = keys.map(key => {
        const meta = getSecretMetadata(key);
        return {
          key,
          createdAt: meta?.createdAt,
          updatedAt: meta?.updatedAt,
          description: meta?.metadata?.description
        };
      });
      
      return JSON.stringify({
        count: keys.length,
        secrets: details
      });
    }
  });

  registerTool({
    name: "secret_delete",
    description: "Delete a secret from the encrypted vault. This action is irreversible.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The secret key to delete" }
      },
      required: ["key"]
    },
    execute: async ({ key }) => {
      const deleted = deleteSecret(String(key));
      return JSON.stringify({
        success: deleted,
        message: deleted 
          ? `Secret '${key}' deleted` 
          : `Secret '${key}' not found`
      });
    }
  });

  registerTool({
    name: "secret_rotate_key",
    description: "Rotate the master encryption key. All secrets will be re-encrypted. IMPORTANT: Save the new master key!",
    parameters: {
      type: "object",
      properties: {
        newKey: { type: "string", description: "Optional new master key. If not provided, a random key will be generated." }
      },
      required: []
    },
    execute: async ({ newKey }) => {
      try {
        rotateMasterKey(newKey ? String(newKey) : undefined);
        return JSON.stringify({
          success: true,
          message: "Master key rotated. All secrets re-encrypted.",
          warning: "Update your MASTER_KEY environment variable with the new key!"
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  });

  registerTool({
    name: "secret_clear_cache",
    description: "Clear the in-memory secret cache. Use this if you suspect cached values are stale.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      clearSecretCache();
      return JSON.stringify({ success: true, message: "Secret cache cleared" });
    }
  });

  console.log("🔧 Registered secret tools: secret_set, secret_get, secret_exists, secret_list, secret_delete, secret_rotate_key, secret_clear_cache");
}
