// Quick check of the trash helpers: npx tsx scripts/check-trash.ts
import assert from "node:assert";
import { imagePathsOf, insertStatement, KINDS, planRestore, type Existing, type Snapshot } from "../src/lib/trash";

const set = (...ids: number[]) => new Set(ids);
const everything: Existing = { clients: set(3), templates: set(2), tags: set(1, 9), commissions: set(7), client_characters: set(11, 12) };
const nothing: Existing = { clients: set(), templates: set(), tags: set(), commissions: set(), client_characters: set() };
const tables = (plan: [string, Record<string, unknown>][]) => plan.map(([table]) => table);

// ---- Commission: everything still exists, nothing changes ----
const commission: Snapshot = {
  commissions: [{ id: 7, title: "Sketch", client_id: 3, template_id: 2, current_stage_id: 5 }],
  commission_tags: [{ commission_id: 7, tag_id: 1 }, { commission_id: 7, tag_id: 9 }],
  commission_payments: [{ id: 4, commission_id: 7, amount: 40 }],
  commission_stage_images: [{ id: 1, commission_id: 7, image_data_url: "images/a.webp" }],
  commission_characters: [{ commission_id: 7, character_id: 11 }, { commission_id: 7, character_id: 12 }],
};
let plan = planRestore("commission", commission, everything);
assert.deepStrictEqual(plan.map(([, row]) => row), Object.values(commission).flat());

// Client, template, one tag and one character were deleted since: unlinked or skipped, rest comes back
plan = planRestore("commission", commission, { ...nothing, tags: set(1), client_characters: set(12) });
const [first] = plan[0];
assert.strictEqual(first, "commissions");
assert.deepStrictEqual(
  [plan[0][1].client_id, plan[0][1].template_id, plan[0][1].current_stage_id, plan[0][1].title],
  [null, null, null, "Sketch"],
);
assert.deepStrictEqual(plan.filter(([t]) => t === "commission_tags").map(([, r]) => r.tag_id), [1]);
assert.deepStrictEqual(plan.filter(([t]) => t === "commission_characters").map(([, r]) => r.character_id), [12]);
assert.strictEqual(commission.commissions[0].client_id, 3, "the stored snapshot is not mutated");

// ---- Client: characters, references and links come back; unlinked commissions are linked again ----
const client: Snapshot = {
  clients: [{ id: 3, name: "Ana", avatar_url: "images/ana.webp" }],
  client_characters: [{ id: 11, client_id: 3, name: "Kuro" }],
  character_references: [{ id: 1, character_id: 11, image_data_url: "images/kuro.webp" }],
  commission_characters: [{ commission_id: 7, character_id: 11 }, { commission_id: 99, character_id: 11 }],
  client_links: [{ id: 7, client_id: 3 }, { id: 99, client_id: 3 }],
};
plan = planRestore("client", client, { ...nothing, commissions: set(7) });
assert.deepStrictEqual(tables(plan), ["clients", "client_characters", "character_references", "commission_characters", "client_links"]);
assert.deepStrictEqual(plan[3][1], { commission_id: 7, character_id: 11 }, "link to the commission deleted since is dropped");
assert.deepStrictEqual(plan[4][1], { id: 7, client_id: 3 });
assert.deepStrictEqual(insertStatement("client_links", { id: 7, client_id: 3 }), [
  "UPDATE commissions SET client_id = ? WHERE id = ? AND client_id IS NULL;",
  [3, 7],
]);
assert.deepStrictEqual(imagePathsOf(client), ["images/kuro.webp", "images/ana.webp"]);
assert.deepStrictEqual(imagePathsOf({ clients: [{ id: 1, avatar_url: "https://x/y.png" }, { id: 2, avatar_url: null }] }), []);

// ---- Character whose client was deleted meanwhile cannot come back ----
const character: Snapshot = {
  client_characters: [{ id: 11, client_id: 3, name: "Kuro" }],
  character_references: [{ id: 1, character_id: 11, image_data_url: "images/kuro.webp" }],
  commission_characters: [],
};
assert.deepStrictEqual(planRestore("character", character, nothing), []);
assert.deepStrictEqual(tables(planRestore("character", character, { ...nothing, clients: set(3) })), ["client_characters", "character_references"]);

// ---- Simple kinds ----
assert.deepStrictEqual(planRestore("tag", { tags: [{ id: 5, name: "Sketch" }], commission_tags: [{ commission_id: 7, tag_id: 5 }, { commission_id: 8, tag_id: 5 }] }, { ...nothing, commissions: set(7) }).map(([t, r]) => [t, r.commission_id ?? r.id]), [["tags", 5], ["commission_tags", 7]]);
assert.deepStrictEqual(planRestore("payment", { commission_payments: [{ id: 4, commission_id: 7, amount: 40 }] }, nothing), [], "a payment needs its commission");
assert.strictEqual(planRestore("template", { templates: [{ id: 2, name: "Flat" }], template_stages: [{ id: 1, template_id: 2 }] }, nothing).length, 2);
const [, request] = planRestore("request", { commission_requests: [{ id: 1, name: "Ana", template_id: 2, commission_id: 7 }] }, nothing)[0];
assert.deepStrictEqual([request.template_id, request.commission_id], [null, null]);

// ---- Titles shown in the trash ----
assert.strictEqual(KINDS.payment.title({ amount: 40, paid_at: "2026-10-01" }), "40 · 2026-10-01");
assert.strictEqual(KINDS.correction.title({ text: "x".repeat(100) }).length, 60);

// ---- SQL built from the stored columns ----
assert.deepStrictEqual(insertStatement("commission_tags", { commission_id: 7, tag_id: 1 }), [
  "INSERT OR REPLACE INTO commission_tags (commission_id, tag_id) VALUES (?, ?);",
  [7, 1],
]);
assert.deepStrictEqual(imagePathsOf(commission), ["images/a.webp"]);
assert.deepStrictEqual(imagePathsOf({ commissions: [] }), []);

console.log("trash ok");
