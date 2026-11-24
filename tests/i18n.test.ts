// Checks the Spanish dictionary against every t("…") call
import { test } from "vitest";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { es } from "../src/lib/es";

test("i18n", async () => {
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

  // No dead translations: every key appears as a literal somewhere (t("…") or a list of labels that goes through t)
  const code = files.filter((file) => !file.endsWith("es.ts")).map((file) => readFileSync(file, "utf8")).join("\n");
  const unused = Object.keys(es).filter((key) => ![JSON.stringify(key), `'${key}'`, "`" + key + "`"].some((quoted) => code.includes(quoted)));
  assert.deepStrictEqual(unused, [], `Unused in es.ts:\n${unused.join("\n")}`);
});
