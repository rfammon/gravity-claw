import { syncAllBoards } from "./trello-sync.js";
import cron from "node-cron";

/**
 * Heartbeat System
 * Satisfies: 21. Heartbeat System
 * - Syncs Trello data at 07:30, 12:00, and 15:00
 * - Can be extended with calendar, weather, etc.
 */
export function startHeartbeat() {
    // Run initial sync immediately
    syncAllBoards().catch(err => console.error("❌ Initial Trello sync failed:", err.message));

    const scheduleRuns = ["30 7 * * *", "0 12 * * *", "0 15 * * *"];

    for (const time of scheduleRuns) {
        cron.schedule(time, async () => {
            console.log(`💓 Heartbeat: Running periodic sync (${time})...`);
            try {
                await syncAllBoards();
            } catch (err: any) {
                console.error("❌ Heartbeat Trello sync failed:", err.message);
            }
        });
    }
}
