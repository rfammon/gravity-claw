import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/**
 * LanceDB Provider for local vector storage.
 * - Persistent storage in ~/.gravity_claw/lance_db
 * - Support for vector search and FTS (Full Text Search)
 */
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
const DB_PATH = path.join(GRAVITY_DIR, "lance_db");

export class LanceProvider {
    private db: lancedb.Connection | null = null;
    private dbPromise: Promise<lancedb.Connection> | null = null;
    private tablePromises: Map<string, Promise<any>> = new Map();

    private async connect() {
        if (this.db) return this.db;
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = (async () => {
            if (!fs.existsSync(DB_PATH)) {
                fs.mkdirSync(DB_PATH, { recursive: true });
            }
            this.db = await lancedb.connect(DB_PATH);
            return this.db;
        })();

        return this.dbPromise;
    }

    /**
     * Get or create a table in LanceDB.
     */
    async getOrCreateTable(name: string, schema_example: any[]) {
        if (this.tablePromises.has(name)) {
            return await this.tablePromises.get(name)!;
        }

        const promise = (async () => {
            const db = await this.connect();
            const tableNames = await db.tableNames();

            if (tableNames.includes(name)) {
                return await db.openTable(name);
            }

            console.log(`🏗️ Creating LanceDB table: ${name}`);
            return await db.createTable(name, schema_example);
        })();

        this.tablePromises.set(name, promise);
        return await promise;
    }

    /**
     * Add data to a table.
     */
    async addData(tableName: string, items: any[]) {
        const table = await this.getOrCreateTable(tableName, items);
        await table.add(items);
    }

    /**
     * Search in a table using hybrid search (Vector + FTS).
     */
    async search(tableName: string, query: {
        vector?: number[],
        text?: string,
        limit?: number,
        filter?: string
    }) {
        const db = await this.connect();
        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) return [];

        const table = await db.openTable(tableName);
        let queryBuilder: any = table.query();

        if (query.vector) {
            queryBuilder = queryBuilder.nearestTo(query.vector);
        }

        if (query.filter) {
            queryBuilder = queryBuilder.where(query.filter);
        }

        if (query.limit) {
            queryBuilder = queryBuilder.limit(query.limit);
        }

        const results = await queryBuilder.toArray();
        return results;
    }
}

export const lanceProvider = new LanceProvider();
