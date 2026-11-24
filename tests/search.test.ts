// Quick check of the global search: npx tsx scripts/check-search.ts
import assert from "node:assert";
import { matches, search } from "../src/lib/search";

assert.ok(matches("andre", ["Andrea", "@andy"]));
assert.ok(matches("ANDRÉA", ["andrea"]));
assert.ok(matches("flat andrea", ["Flat Colour", "Andrea"]));
assert.ok(!matches("flat bob", ["Flat Colour", "Andrea"]));
assert.ok(matches("", ["anything"]));

const clients = [{ name: "Ana" }, { name: "Banana" }, { name: "Andrea" }, { name: "Zoe" }];
assert.deepStrictEqual(search("an", clients, (client) => [client.name], 10).map((client) => client.name), ["Ana", "Andrea", "Banana"]);
assert.deepStrictEqual(search("an", clients, (client) => [client.name], 2).map((client) => client.name), ["Ana", "Andrea"]);

console.log("search ok");
