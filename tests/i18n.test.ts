// Checks the Spanish dictionary against every t("…") call: npx tsx scripts/check-i18n.ts
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { es } from "../src/lib/es";

const files: string[] = [];
const walk = (dir: string) =>
  readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(name)) files.push(path);
  });
walk("src");

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
const keysInCode = new Set<string>();

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    keysInCode.add(JSON.parse(`"${match[1]}"`));
  }
}

const missing = [...keysInCode].filter((key) => !(key in es));
assert.deepStrictEqual(missing, [], `Missing in es.ts:\n${missing.join("\n")}`);

for (const [key, value] of Object.entries(es)) {
  assert.strictEqual(placeholders(key), placeholders(value), `Placeholders differ: ${key}`);
}

console.log(`i18n ok (${keysInCode.size} texts used, ${Object.keys(es).length} in the dictionary)`);
