import { syncAllBoards } from "./trello-sync.js";

/**
 * Heartbeat System
 * Satisfies: 21. Heartbeat System
 * - Syncs Trello data every 15 minutes
 * - Can be extended with calendar, weather, etc.
 */
export function startHeartbeat() {
    // Run initial sync immediately
    syncAllBoards().catch(err => console.error("❌ Initial Trello sync failed:", err.message));

    setInterval(async () => {
        console.log("💓 Heartbeat: Running periodic sync...");
        try {
            await syncAllBoards();
        } catch (err: any) {
            console.error("❌ Heartbeat Trello sync failed:", err.message);
        }
    }, 60000 * 15); // Every 15 minutes
}
