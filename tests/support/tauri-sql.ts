// Stand-in for @tauri-apps/plugin-sql in the tests: the same SQLite engine (node:sqlite), in memory, with the plugin's
// execute/select/close shape. database.ts then runs its real SQL without Tauri.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// The plugin turns booleans and undefined into SQL values itself; node:sqlite does not
const toSql = (params: unknown[] = []) =>
  params.map((value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value)) as SQLInputValue[];

// On globalThis: vi.resetModules() loads this module again, and the "file" has to survive that
const store = globalThis as { zeeboardTestDb?: DatabaseSync; zeeboardStatements?: number };

/** How many statements the app has run since the last reset (to check what opening the app costs) */
export const statementCount = () => store.zeeboardStatements ?? 0;
export const resetStatementCount = () => void (store.zeeboardStatements = 0);

/** A new empty "file": call it before each test. Until the next call, closing and loading again keeps the data. */
export function resetDatabase() {
  store.zeeboardTestDb = new DatabaseSync(":memory:");
}

/** The "file" itself, to prepare data the way an older version of the app left it */
export function rawDatabase(): DatabaseSync {
  return (store.zeeboardTestDb ??= new DatabaseSync(":memory:"));
}

export function loadDatabase() {
  const db = (store.zeeboardTestDb ??= new DatabaseSync(":memory:"));
  return {
    async execute(sql: string, params?: unknown[]) {
      store.zeeboardStatements = statementCount() + 1;
      const result = db.prepare(sql).run(...toSql(params));
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      store.zeeboardStatements = statementCount() + 1;
      return db.prepare(sql).all(...toSql(params)) as T;
    },
    // Like closing a file: the data stays for the next load
    async close() {},
  };
}
