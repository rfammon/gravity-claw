import { getLatestJudgments } from "./src/db-provider.js";

async function main() {
    console.log("Calling getLatestJudgments...");
    try {
        const judgments = await getLatestJudgments("6666022588");
        console.log("Returned Judgments:");
        console.log(judgments);
    } catch (err) {
        console.error("Caught Error:", err);
    } finally {
        process.exit(0);
    }
}

main();
