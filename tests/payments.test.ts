// Quick check of payments and prices: npx tsx scripts/check-payments.ts
import assert from "node:assert";
import { calculateCommissionPrice, deliveryDay, effectiveCharacterCount, pendingCorrectionsText, pinNumber, formatMoney, groupAlternatives, invoiceDescription, netIncome, paymentSummary, ratePerHour, receivedAfterFees } from "../src/lib/commissionHelpers";
import type { Commission, CommissionStageImage } from "../src/lib/database";
import { HIDDEN, hide, setPrivate } from "../src/lib/privacy";

// PayPal: the client pays 200, you receive 186.84
let s = paymentSummary(200, [{ amount: 200, received: 186.84 }]);
assert.deepStrictEqual([s.status, s.paid, s.received, s.fees, s.remaining], ["paid", 200, 186.84, 13.16, 0]);

// Half upfront, received not entered yet
s = paymentSummary(240, [{ amount: 120, received: null }]);
assert.deepStrictEqual([s.status, s.remaining, s.pendingReceived, s.fees], ["partial", 120, 1, 0]);

// No payments
assert.strictEqual(paymentSummary(160, []).status, "unpaid");

// A tip doesn't pay the price, but its money and its fee count as income
s = paymentSummary(200, [{ amount: 100, received: 96.75 }, { amount: 20, received: 19.07, tip: 1 }]);
assert.deepStrictEqual([s.status, s.paid, s.tips, s.remaining, s.received, s.fees], ["partial", 100, 20, 100, 115.82, 4.18]);
assert.strictEqual(netIncome(s), 115.82);

// Decimals that don't add up exactly in floating point
s = paymentSummary(0.3, [{ amount: 0.1, received: 0.1 }, { amount: 0.2, received: 0.2 }]);
assert.deepStrictEqual([s.status, s.paid, s.fees], ["paid", 0.3, 0]);

console.log("payments ok");

// Automatic price: base for the first character, +50% per extra
assert.strictEqual(calculateCommissionPrice(160, 1, 0.5), 160);
assert.strictEqual(calculateCommissionPrice(160, 2, 0.5), 240);
assert.strictEqual(calculateCommissionPrice(160, 3, 0.5), 320);
assert.strictEqual(calculateCommissionPrice(160, 0, 0.5), 160);
assert.strictEqual(calculateCommissionPrice(99.99, 2, 0.5), 149.99);
// Fee changed in Settings
assert.strictEqual(calculateCommissionPrice(160, 2, 0.6), 256);
// Characters the price is for: the asked number wins unless more are linked (2 asked, 1 profile: still 2)
assert.strictEqual(effectiveCharacterCount(2, 1), 2);
assert.strictEqual(effectiveCharacterCount(2, 3), 3);
assert.strictEqual(effectiveCharacterCount(0, 0), 1);
assert.strictEqual(effectiveCharacterCount(Number.NaN, 2), 2);
assert.strictEqual(calculateCommissionPrice(110, effectiveCharacterCount(2, 1), 0.5), 165);
console.log("prices ok");

// Correction pins: numbered per image in the order they were added; plain corrections have no number
const pinned = [
  { id: 1, image_id: 10 },
  { id: 2, image_id: null },
  { id: 3, image_id: 10 },
  { id: 4, image_id: 11 },
];
assert.deepStrictEqual(pinned.map((correction) => pinNumber(pinned, correction)), [1, null, 2, 1]);
console.log("pins ok");

// Corrections to paste: only the pending ones, numbered again from 1
assert.strictEqual(
  pendingCorrectionsText([
    { text: "Bigger nose", done_at: null },
    { text: "Fix the ear", done_at: "2026-10-10T10:00:00.000Z" },
    { text: "Brighter eyes", done_at: null },
  ]),
  "1. Bigger nose\n2. Brighter eyes",
);
assert.strictEqual(pendingCorrectionsText([{ text: "x", done_at: "2026-10-10" }]), "");
console.log("corrections text ok");

// Platform fee: 3.4% + 0.35 on 200 → 192.85; never negative
assert.strictEqual(receivedAfterFees(200, { percent: 3.4, fixed: 0.35 }), 192.85);
assert.strictEqual(receivedAfterFees(200, { percent: 0, fixed: 0 }), 200);
assert.strictEqual(receivedAfterFees(0.2, { percent: 3.4, fixed: 0.35 }), 0);
console.log("fees ok");

// Private mode: amounts and names hidden, and everything returns when turned off
assert.notStrictEqual(formatMoney(200, "EUR"), "•••");
setPrivate(true);
assert.strictEqual(formatMoney(200, "EUR"), "•••");
assert.strictEqual(hide("Kai"), HIDDEN);
setPrivate(false);
assert.strictEqual(hide("Kai"), "Kai");
assert.notStrictEqual(formatMoney(200, "EUR"), "•••");
console.log("private ok");

// Invoice description
assert.strictEqual(invoiceDescription("Rendered", ["Ana", "Beto"]), "Rendered, 2 characters (Ana, Beto) - @AverageZebraBoy");
assert.strictEqual(invoiceDescription("Sketch", ["Ana"]), "Sketch, 1 character (Ana) - @AverageZebraBoy");
assert.strictEqual(invoiceDescription(null, []), "@AverageZebraBoy");
console.log("description ok");

// ---- Hourly rate ----
// Net: where the received amount is entered it counts, otherwise what the client paid
assert.strictEqual(netIncome(paymentSummary(200, [{ amount: 200, received: 186.84 }])), 186.84);
assert.strictEqual(netIncome(paymentSummary(240, [{ amount: 120, received: 111 }, { amount: 120, received: null }])), 231);

// Total income / total hours; entries without hours are ignored
assert.strictEqual(ratePerHour([{ net: 100, hours: 4 }, { net: 200, hours: 4 }]), 37.5);
assert.strictEqual(ratePerHour([{ net: 100, hours: 4 }, { net: 999, hours: null }, { net: 50, hours: 0 }]), 25);
assert.strictEqual(ratePerHour([{ net: 100, hours: null }]), null);
assert.strictEqual(ratePerHour([]), null);

// Delivery day: the typed date, else when it reached the last stage, else when it was created
const base = { created_at: "2026-05-01T10:00:00.000Z", stage_changed_at: null, delivered_at: null } as Commission;
assert.strictEqual(deliveryDay({ ...base, delivered_at: "2026-07-20" }), "2026-07-20");
assert.strictEqual(deliveryDay({ ...base, stage_changed_at: "2026-06-15T12:00:00.000Z" }), "2026-06-15");
assert.strictEqual(deliveryDay(base), "2026-05-01");

console.log("hourly rate ok");

// ---- Alternatives and versions of a stage's images ----
const image = (id: number, alt: number, version: number) => ({ id, alt, version }) as CommissionStageImage;
// Alt 1 (with glasses) was retouched twice, Alt 2 (without) once; ids come in upload order, not by alternative
const groups = groupAlternatives([image(1, 1, 1), image(2, 2, 1), image(3, 1, 2), image(4, 1, 3), image(5, 2, 2)]);
assert.deepStrictEqual(groups.map((group) => [group.alt, group.versions.map((version) => version.id)]), [
  [1, [1, 3, 4]],
  [2, [2, 5]],
]);
assert.strictEqual(groups[0].versions[groups[0].versions.length - 1].version, 3, "the last one is the current version");
assert.deepStrictEqual(groupAlternatives([]), []);

console.log("versions ok");
