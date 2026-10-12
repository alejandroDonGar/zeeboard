// Checks that every database call the app makes is allowed by the Tauri capability: npx tsx scripts/check-permissions.ts
// A missing permission only fails at run time (restoring a backup was broken for that reason), never in the build.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8")) as { permissions: string[] };
const code = readFileSync(new URL("../src/lib/database.ts", import.meta.url), "utf8");

// What the code does with plugin-sql, and the permission each call needs
const calls: [RegExp, string][] = [
  [/Database\.load\(/, "sql:allow-load"],
  [/\.execute\(/, "sql:allow-execute"],
  [/\.select</, "sql:allow-select"],
  [/\bdb\.close\(/, "sql:allow-close"],
];

const missing = calls.filter(([pattern, permission]) => pattern.test(code) && !capability.permissions.includes(permission)).map(([, permission]) => permission);

assert.deepStrictEqual(missing, [], `the app calls the database in ways its capability does not allow: ${missing.join(", ")}`);

console.log("permissions ok");
