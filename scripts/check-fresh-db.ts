// Starts an empty database with the real statements of initializeDatabase, in order: npx tsx scripts/check-fresh-db.ts
// (optional: a path to another copy of database.ts, to check it). It fails if a statement that is not allowed to fail does,
// or if a column the app needs is missing: that is what a first install, or a new computer without a backup, gets.
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(process.argv[2] ?? new URL("../src/lib/database.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("export async function initializeDatabase()");
const body = source.slice(start, source.indexOf("\n}\n", start));

// database.execute(`SQL`) with an optional .catch(...) that swallows its errors
const statements = [...body.matchAll(/database\.execute\(\s*`([^`]*)`\s*\)(\s*\.catch)?/g)]
  .map(([, sql, swallowed]) => ({ sql, swallowed: Boolean(swallowed) }))
  .filter(({ sql }) => !sql.includes("${") && !sql.includes("?"));

const db = new DatabaseSync(":memory:");
const failures: string[] = [];

for (const { sql, swallowed } of statements) {
  try {
    db.exec(sql);
  } catch (error) {
    if (!swallowed) failures.push(`${String(error)} <- ${sql.trim().replace(/\s+/g, " ").slice(0, 90)}`);
  }
}

assert.deepStrictEqual(failures, [], `statements that failed on an empty database:\n${failures.join("\n")}`);

const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
const needed: Record<string, string[]> = {
  clients: ["platform", "handle", "avatar_url", "tag_platform", "tag_handle"],
  commissions: ["platform", "currency", "stage_changed_at", "delivered_at", "hours", "final_notes", "character_count"],
  commission_payments: ["external_id"],
  commission_stage_images: ["alt", "version"],
  commission_corrections: ["image_id", "x", "y", "done_at"],
  commission_requests: ["external_id", "email", "tag_platform", "tag_handle"],
  templates: ["base_price", "revisions_included"],
};

for (const [table, wanted] of Object.entries(needed)) {
  const have = columns(table);
  assert.deepStrictEqual(wanted.filter((column) => !have.includes(column)), [], `${table} is missing columns on a fresh database`);
}

// Every column the code writes to must exist in a fresh database (INSERT lists and UPDATE ... SET assignments, in all of src/)
const files = readdirSync(new URL("../src/lib/", import.meta.url)).filter((name) => name.endsWith(".ts"));
const missing: string[] = [];
let checked = 0;

for (const name of files) {
  const text = readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8");
  const writes = [
    ...[...text.matchAll(/INSERT(?: OR \w+)? INTO (\w+)\s*\(([^)]*)\)/g)].map(([, table, list]) => [table, list.split(",").map((c) => c.trim())] as const),
    ...[...text.matchAll(/UPDATE (\w+)\s+SET\s+([^;`]*?)\s+WHERE/gs)].map(
      ([, table, sets]) => [table, [...sets.matchAll(/(\w+)\s*=/g)].map((m) => m[1])] as const,
    ),
  ];

  for (const [table, written] of writes) {
    const have = columns(table);
    if (have.length === 0) continue; // not a table of this database (e.g. text in a comment)
    for (const column of written) {
      checked += 1;
      if (column && !have.includes(column)) missing.push(`${name}: ${table}.${column}`);
    }
  }
}

assert.deepStrictEqual(missing, [], `columns written by the code that a fresh database does not have:\n${missing.join("\n")}`);

assert.ok(checked > 100, `only ${checked} written columns were checked: the pattern is probably not matching`);

console.log(`fresh database ok (${statements.length} statements, ${checked} written columns checked)`);
