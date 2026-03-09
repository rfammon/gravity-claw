import fs from "fs/promises";
import path from "path";
import { registerTool } from "./registry.js";
import { config } from "../config.js"; // Assuming we have config or we can just use process.env

// Helper to get and validate the vault path
async function getVaultPath(): Promise<string> {
    const vaultPathRaw = process.env.OBSIDIAN_VAULT_PATH;
    if (!vaultPathRaw) {
        throw new Error("OBSIDIAN_VAULT_PATH is not defined in .env");
    }

    // Resolve ~ to home directory if necessary (common in termux/linux)
    const vaultPath = vaultPathRaw.replace(/^~(?=$|\/|\\)/, process.env.HOME || process.env.USERPROFILE || "");
    const resolvedPath = path.resolve(vaultPath);

    try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
            throw new Error(`Path is not a directory: ${resolvedPath}`);
        }
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            // Create the directory if it doesn't exist to make setup easier
            await fs.mkdir(resolvedPath, { recursive: true });
        } else {
            throw e;
        }
    }

    return resolvedPath;
}

// Helper to safely resolve a file path inside the vault to prevent directory traversal
function resolveSafePath(vaultPath: string, subPath: string): string {
    const safePath = path.resolve(vaultPath, subPath);
    if (!safePath.startsWith(vaultPath)) {
        throw new Error("Security Error: Attempted to access path outside of Obsidian Vault");
    }
    // ensure it has a markdown extension for safety unless it's a directory check
    return safePath;
}

/**
 * Tool: obsidian_list_notes
 */
registerTool({
    name: "obsidian_list_notes",
    description: "List markdown notes in the Obsidian Vault. Optionally specify a folder path to list files within that folder.",
    parameters: {
        type: "object",
        properties: {
            folder: {
                type: "string",
                description: "Optional folder path relative to the vault root (e.g., 'projects' or ''). Defaults to root."
            }
        }
    },
    execute: async (args) => {
        try {
            const vaultPath = await getVaultPath();
            const targetFolder = args.folder ? String(args.folder) : "";
            const safePath = resolveSafePath(vaultPath, targetFolder);

            const entries = await fs.readdir(safePath, { withFileTypes: true });
            const files = entries
                .filter(e => e.isFile() && e.name.endsWith(".md"))
                .map(e => e.name);
            const dirs = entries
                .filter(e => e.isDirectory() && !e.name.startsWith(".")) // Ignore .obsidian etc
                .map(e => e.name + "/");

            return `📁 Folder: /${targetFolder}\n\nDirectories:\n${dirs.join("\n")}\n\nNotes:\n${files.join("\n")}`;
        } catch (error: any) {
            return `❌ Failed to list notes: ${error.message}`;
        }
    }
});

/**
 * Tool: obsidian_read_note
 */
registerTool({
    name: "obsidian_read_note",
    description: "Read the exact content of a markdown note from the Obsidian Vault.",
    parameters: {
        type: "object",
        properties: {
            filepath: {
                type: "string",
                description: "The path to the note relative to the vault root, including the .md extension (e.g., 'ideas/app.md')."
            }
        },
        required: ["filepath"]
    },
    execute: async ({ filepath }) => {
        try {
            const vaultPath = await getVaultPath();
            const safePath = resolveSafePath(vaultPath, String(filepath));

            if (!safePath.endsWith(".md")) {
                return "❌ Error: Can only read .md files.";
            }

            const content = await fs.readFile(safePath, "utf-8");
            return `📄 Content of ${filepath}:\n\n${content}`;
        } catch (error: any) {
            return `❌ Failed to read note: ${error.message}`;
        }
    }
});

/**
 * Tool: obsidian_write_note
 */
registerTool({
    name: "obsidian_write_note",
    description: "Create a new markdown note or completely overwrite an existing one in the Obsidian Vault.",
    parameters: {
        type: "object",
        properties: {
            filepath: {
                type: "string",
                description: "The path to the note relative to the vault root, including the .md extension (e.g., 'ideas/app.md')."
            },
            content: {
                type: "string",
                description: "The full markdown content to write to the file."
            }
        },
        required: ["filepath", "content"]
    },
    execute: async ({ filepath, content }) => {
        try {
            const vaultPath = await getVaultPath();
            const safePath = resolveSafePath(vaultPath, String(filepath));

            if (!safePath.endsWith(".md")) {
                return "❌ Error: Can only write .md files.";
            }

            // Ensure directory exists
            await fs.mkdir(path.dirname(safePath), { recursive: true });

            await fs.writeFile(safePath, String(content), "utf-8");
            return `✅ Successfully wrote to ${filepath}`;
        } catch (error: any) {
            return `❌ Failed to write note: ${error.message}`;
        }
    }
});

/**
 * Tool: obsidian_append_note
 */
registerTool({
    name: "obsidian_append_note",
    description: "Append text to the end of an existing markdown note in the Obsidian Vault. Useful for adding daily logs or new ideas.",
    parameters: {
        type: "object",
        properties: {
            filepath: {
                type: "string",
                description: "The path to the note relative to the vault root, including the .md extension (e.g., 'ideas/app.md')."
            },
            content: {
                type: "string",
                description: "The markdown content to append to the end of the file."
            }
        },
        required: ["filepath", "content"]
    },
    execute: async ({ filepath, content }) => {
        try {
            const vaultPath = await getVaultPath();
            const safePath = resolveSafePath(vaultPath, String(filepath));

            if (!safePath.endsWith(".md")) {
                return "❌ Error: Can only append to .md files.";
            }

            // Ensure directory exists just in case the file doesn't exist yet
            await fs.mkdir(path.dirname(safePath), { recursive: true });

            // Add a newline before appending to ensure it starts on a new line
            const appendContent = `\n${content}`;
            await fs.appendFile(safePath, appendContent, "utf-8");

            return `✅ Successfully appended to ${filepath}`;
        } catch (error: any) {
            return `❌ Failed to append to note: ${error.message}`;
        }
    }
});
