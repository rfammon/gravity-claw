import Database from "better-sqlite3";
import axios from "axios";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// ─── Database Setup ──────────────────────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const DB_PATH = path.join(GRAVITY_DIR, "memory.sqlite");

const db = new Database(DB_PATH);

// Create cache tables
db.exec(`
  CREATE TABLE IF NOT EXISTS trello_boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS trello_lists (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    name TEXT NOT NULL,
    pos REAL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS trello_cards (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    name TEXT NOT NULL,
    desc TEXT,
    due TEXT,
    due_complete INTEGER DEFAULT 0,
    labels TEXT,
    pos REAL,
    url TEXT,
    attachment_count INTEGER DEFAULT 0,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("🗄️ Trello cache tables ready");

// Migration: add attachment_count if missing (for existing DBs)
try { db.exec("ALTER TABLE trello_cards ADD COLUMN attachment_count INTEGER DEFAULT 0"); } catch { /* already exists */ }

// ─── Trello API helpers ──────────────────────────────────────────────
const TRELLO_BASE = "https://api.trello.com/1";

function getAuth() {
    const key = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    if (!key || !token) throw new Error("❌ Missing TRELLO_API_KEY or TRELLO_TOKEN");
    return { key, token };
}

// ─── Sync Logic ──────────────────────────────────────────────────────
export async function syncAllBoards(): Promise<{ boards: number; lists: number; cards: number }> {
    const { key, token } = getAuth();
    const now = new Date().toISOString();

    // 1. Fetch all boards
    const boardsRes = await axios.get(`${TRELLO_BASE}/members/me/boards`, {
        params: { key, token, fields: "name,url" }
    });
    const boards = boardsRes.data as any[];

    const upsertBoard = db.prepare(
        `INSERT INTO trello_boards (id, name, url, synced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, synced_at=excluded.synced_at`
    );

    let totalLists = 0;
    let totalCards = 0;

    const upsertList = db.prepare(
        `INSERT INTO trello_lists (id, board_id, name, pos, synced_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id, name=excluded.name, pos=excluded.pos, synced_at=excluded.synced_at`
    );

    const upsertCard = db.prepare(
        `INSERT INTO trello_cards (id, list_id, board_id, name, desc, due, due_complete, labels, pos, url, attachment_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       list_id=excluded.list_id, board_id=excluded.board_id, name=excluded.name, desc=excluded.desc,
       due=excluded.due, due_complete=excluded.due_complete, labels=excluded.labels,
       pos=excluded.pos, url=excluded.url, attachment_count=excluded.attachment_count, synced_at=excluded.synced_at`
    );

    // Clean stale cards before re-syncing (delete cards that no longer exist)
    const deleteStaleCards = db.prepare(`DELETE FROM trello_cards WHERE board_id = ? AND synced_at < ?`);
    const deleteStaleLists = db.prepare(`DELETE FROM trello_lists WHERE board_id = ? AND synced_at < ?`);

    for (const board of boards) {
        upsertBoard.run(board.id, board.name, board.url, now);

        // 2. Fetch lists for this board
        try {
            const listsRes = await axios.get(`${TRELLO_BASE}/boards/${board.id}/lists`, {
                params: { key, token, fields: "name,pos" }
            });
            const lists = listsRes.data as any[];

            for (const list of lists) {
                upsertList.run(list.id, board.id, list.name, list.pos, now);
                totalLists++;

                // 3. Fetch cards for this list
                const cardsRes = await axios.get(`${TRELLO_BASE}/lists/${list.id}/cards`, {
                    params: { key, token, fields: "name,desc,due,dueComplete,labels,pos,url", attachments: "true", attachment_fields: "id" }
                });
                const cards = cardsRes.data as any[];

                for (const card of cards) {
                    const labelStr = card.labels?.map((l: any) => l.name || l.color).join(", ") || "";
                    const attachCount = card.attachments?.length || 0;
                    upsertCard.run(
                        card.id, list.id, board.id, card.name, card.desc || "",
                        card.due || null, card.dueComplete ? 1 : 0, labelStr,
                        card.pos, card.url || "", attachCount, now
                    );
                    totalCards++;
                }
            }

            // Remove cards/lists that disappeared from this board
            deleteStaleCards.run(board.id, now);
            deleteStaleLists.run(board.id, now);
        } catch (err: any) {
            console.error(`⚠️ Failed to sync board "${board.name}":`, err.message);
        }
    }

    console.log(`🔄 Trello sync complete: ${boards.length} boards, ${totalLists} lists, ${totalCards} cards`);
    return { boards: boards.length, lists: totalLists, cards: totalCards };
}

// ─── Cache Readers ───────────────────────────────────────────────────
export function getCachedBoards() {
    return db.prepare("SELECT id, name, url FROM trello_boards ORDER BY name").all() as any[];
}

export function getCachedLists(boardId: string) {
    return db.prepare("SELECT id, board_id, name FROM trello_lists WHERE board_id = ? ORDER BY pos").all(boardId) as any[];
}

export function getCachedCards(boardId?: string) {
    if (boardId) {
        return db.prepare(`
      SELECT c.id, c.name, c.desc, c.due, c.due_complete, c.labels, c.url, l.name as list_name
      FROM trello_cards c
      JOIN trello_lists l ON c.list_id = l.id
      WHERE c.board_id = ?
      ORDER BY l.pos, c.pos
    `).all(boardId) as any[];
    }
    return db.prepare(`
    SELECT c.id, c.name, c.desc, c.due, c.due_complete, c.labels, c.url, l.name as list_name, b.name as board_name
    FROM trello_cards c
    JOIN trello_lists l ON c.list_id = l.id
    JOIN trello_boards b ON c.board_id = b.id
    ORDER BY b.name, l.pos, c.pos
  `).all() as any[];
}

export function getCachedCardsByList(boardId: string) {
    const lists = getCachedLists(boardId);
    const result: { listName: string; cards: any[] }[] = [];

    const cardsByList = db.prepare(`
    SELECT id, name, desc, due, due_complete, labels, url, attachment_count
    FROM trello_cards
    WHERE list_id = ?
    ORDER BY pos
  `);

    for (const list of lists) {
        const cards = cardsByList.all(list.id) as any[];
        result.push({ listName: list.name, cards });
    }
    return result;
}

export function getLastSyncTime(): string | null {
    const row = db.prepare("SELECT MAX(synced_at) as last_sync FROM trello_boards").get() as any;
    return row?.last_sync || null;
}
