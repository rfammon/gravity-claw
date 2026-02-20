import * as fs from "fs";
import * as path from "path";
import { registerTool } from "./tools/registry.js";

/**
 * Skills System
 * Satisfies: 5. Skills System
 */
export let cachedSkills = "";

/**
 * Skills System
 * Satisfies: 5. Skills System
 */
export async function loadSkills(): Promise<string> {
    const skillsDir = path.join(process.cwd(), "skills");
    if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir);
    }

    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith(".md"));
    let allSkills = "";

    for (const file of files) {
        const content = fs.readFileSync(path.join(skillsDir, file), "utf-8");
        const skillName = path.basename(file, ".md");
        console.log(`🌟 Skill content ready: ${skillName}`);
        allSkills += `\n--- SKILL: ${skillName} ---\n${content}\n`;
    }

    cachedSkills = allSkills;
    return allSkills;
}
