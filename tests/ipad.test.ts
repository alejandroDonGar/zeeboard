// Quick check of the iPad link helpers: npx tsx scripts/check-ipad.ts
import assert from "node:assert";
import { ipadLink, isTailscale, latestOfAlternative, sortAddresses } from "../src/lib/ipadLink";
import type { CommissionStageImage } from "../src/lib/database";

// Tailscale is 100.64.0.0/10: 100.64 … 100.127 only
assert.strictEqual(isTailscale("100.101.102.103"), true);
assert.strictEqual(isTailscale("100.64.0.1"), true);
assert.strictEqual(isTailscale("100.127.255.254"), true);
assert.strictEqual(isTailscale("100.63.0.1"), false);
assert.strictEqual(isTailscale("100.128.0.1"), false);
assert.strictEqual(isTailscale("192.168.1.34"), false);

// The Tailscale address goes first, the rest keep their order
assert.deepStrictEqual(sortAddresses(["192.168.1.34", "100.101.102.103", "10.0.0.5"]), ["100.101.102.103", "192.168.1.34", "10.0.0.5"]);
assert.deepStrictEqual(sortAddresses([]), []);

assert.strictEqual(ipadLink("100.101.102.103", 8787, "abc"), "http://100.101.102.103:8787/?k=abc");

// A new version goes on top of the newest version of the chosen alternative, of that stage only
const image = (id: number, stage_id: number, alt: number, version: number) => ({ id, stage_id, alt, version }) as CommissionStageImage;
const images = [image(1, 10, 1, 1), image(3, 10, 1, 2), image(2, 10, 2, 1), image(4, 11, 1, 1)];
assert.strictEqual(latestOfAlternative(images, 10, 1)?.id, 3);
assert.strictEqual(latestOfAlternative(images, 10, 2)?.id, 2);
assert.strictEqual(latestOfAlternative(images, 11, 1)?.id, 4);
// The alternative was deleted meanwhile
assert.strictEqual(latestOfAlternative(images, 10, 3), undefined);

console.log("ipad ok");
