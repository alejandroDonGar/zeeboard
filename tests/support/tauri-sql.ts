// Stand-in for @tauri-apps/plugin-sql in the tests: the same SQLite engine (node:sqlite), in memory, with the plugin's
// execute/select/close shape. database.ts then runs its real SQL without Tauri.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// The plugin turns booleans and undefined into SQL values itself; node:sqlite does not
const toSql = (params: unknown[] = []) =>
  params.map((value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value)) as SQLInputValue[];

export function memoryDatabase() {
  const db = new DatabaseSync(":memory:");
  return {
    async execute(sql: string, params?: unknown[]) {
      const result = db.prepare(sql).run(...toSql(params));
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      return db.prepare(sql).all(...toSql(params)) as T;
    },
    async close() {
      db.close();
    },
  };
}
