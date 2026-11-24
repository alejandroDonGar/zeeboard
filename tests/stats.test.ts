// Quick check of the statistics numbers: npx tsx scripts/check-stats.ts
import assert from "node:assert";
import { changePercent, computeStats, periodRanges } from "../src/lib/stats";
import type { Commission, CommissionPayment, TemplateStage } from "../src/lib/database";

const now = new Date(2026, 9, 7); // 7 Oct 2026

// ---- Periods ----
assert.deepStrictEqual(periodRanges("year", now), {
  current: { from: "2026-01-01", to: "2026-12-31" },
  previous: { from: "2025-01-01", to: "2025-12-31" },
});
assert.deepStrictEqual(periodRanges("12m", now), {
  current: { from: "2025-10-08", to: "2026-10-07" },
  previous: { from: "2024-10-08", to: "2025-10-07" },
});
assert.strictEqual(periodRanges("all", now).previous, null);

// ---- Numbers ----
// Template 1: stages 10 > 11 (last = finished). Commission 1 and 2 are finished, 3 is open, 4 is in USD.
const stages: Record<number, TemplateStage[]> = {
  1: [
    { id: 10, template_id: 1, name: "Sketch", stage_order: 1 },
    { id: 11, template_id: 1, name: "Delivery", stage_order: 2 },
  ],
};
const commission = (id: number, extra: Partial<Commission>) =>
  ({ id, title: `c${id}`, template_id: 1, current_stage_id: 11, price: 100, currency: "EUR", created_at: "2026-01-01T10:00:00.000Z", stage_changed_at: null, delivered_at: null, hours: null, ...extra }) as Commission;
const payment = (id: number, commission_id: number, amount: number, received: number | null, paid_at: string) =>
  ({ id, commission_id, amount, received, paid_at, note: null }) as CommissionPayment;

const commissions = [
  commission(1, { delivered_at: "2026-03-10", hours: 4 }),
  commission(2, { delivered_at: "2026-08-20", price: 200, hours: 8 }),
  commission(3, { current_stage_id: 10 }),
  commission(4, { currency: "USD", delivered_at: "2026-04-01" }),
  commission(5, { delivered_at: "2025-06-01", hours: 5 }),
];
const payments = [
  payment(1, 1, 100, 90, "2026-03-05"), // net 90
  payment(2, 2, 200, null, "2026-08-25"), // net not entered: counts what was paid
  payment(3, 3, 50, 45, "2026-08-01"), // an open commission still brought money in
  payment(4, 4, 500, 500, "2026-04-02"), // other currency: left out
  payment(5, 5, 100, 100, "2025-06-02"),
];

const stats = computeStats({ commissions, payments, templates: [{ id: 1, name: "Flat" }], stages, currency: "EUR", now }, "year");

assert.strictEqual(stats.excluded, 1);
// Received = cash in the year: 90 + 200 + 45
assert.strictEqual(stats.current.received, 335);
// Delivered pieces in the year: #1 (90) and #2 (200)
assert.strictEqual(stats.current.pieces, 2);
assert.strictEqual(stats.current.avgPerPiece, 145);
// (90 + 200) / (4 + 8) hours
assert.strictEqual(stats.current.rate, 24.17);
assert.deepStrictEqual(stats.previous, { received: 100, pieces: 1, avgPerPiece: 100, rate: 20 });

assert.strictEqual(stats.months.length, 12);
assert.strictEqual(stats.months[0].key, "2026-01");
assert.strictEqual(stats.months[7].total, 245); // August: 200 + 45
assert.strictEqual(stats.months[3].total, 0, "the USD payment is not counted");

// avgDays: created 1 Jan, delivered 10 Mar (68 days) and 20 Aug (231 days)
assert.deepStrictEqual(stats.byTemplate, [{ name: "Flat", pieces: 2, net: 290, avgNet: 145, avgHours: 6, rate: 24.17, avgDays: 150 }]);

// Fees of the cash in the year (EUR only): 10 on 100 and 5 on 50 have a net; the 200 one doesn't, so it is left out of the %
assert.deepStrictEqual(stats.fees, { total: 15, percent: 10, pending: 1 });

assert.strictEqual(computeStats({ commissions, payments, templates: [], stages, currency: "EUR", now }, "all").previous, null);
assert.strictEqual(computeStats({ commissions: [], payments: [], templates: [], stages, currency: "EUR", now }, "year").current.rate, null);

// ---- Clients: top and returning share ----
// Ana has 2 commissions (returning), Dan only 1. Delivered in 2026: Ana 90 + 200, Dan 100; one piece has no client.
const withClient = (id: number, client_id: number | null, client_name: string | null, extra: Partial<Commission> = {}) =>
  commission(id, { client_id, client_name, delivered_at: "2026-05-01", ...extra });
const clientCommissions = [
  withClient(1, 1, "Ana"),
  withClient(2, 1, "Ana", { price: 200 }),
  withClient(3, 2, "Dan", { price: 100 }),
  withClient(4, null, null),
  withClient(5, 1, "Ana", { current_stage_id: 10, delivered_at: null }), // open: counts as a commission of Ana, not as income
];
const clientPayments = [payment(1, 1, 90, 90, "2026-05-02"), payment(2, 2, 200, 200, "2026-05-02"), payment(3, 3, 100, 100, "2026-05-02"), payment(4, 4, 999, 999, "2026-05-02")];
const clientStats = computeStats({ commissions: clientCommissions, payments: clientPayments, templates: [], stages, currency: "EUR", now }, "year");

assert.deepStrictEqual(clientStats.topClients, [
  { name: "Ana", pieces: 2, net: 290 },
  { name: "Dan", pieces: 1, net: 100 },
]);
// Ana (3 commissions) is returning, Dan (1) is not: 290 of 390
assert.strictEqual(clientStats.returningShare, 74);
assert.strictEqual(computeStats({ commissions: [], payments: [], templates: [], stages, currency: "EUR", now }, "year").returningShare, null);
assert.strictEqual(computeStats({ commissions: [], payments: [], templates: [], stages, currency: "EUR", now }, "year").fees.percent, null);

// ---- Requests funnel ----
const request = (status: "new" | "waitlist" | "accepted" | "declined", created_at: string) => ({ status, created_at });
const funnel = [
  request("accepted", "2026-02-10T09:00:00.000Z"),
  request("accepted", "2026-03-05T09:00:00.000Z"),
  request("declined", "2026-03-20T09:00:00.000Z"),
  request("waitlist", "2026-04-02T09:00:00.000Z"),
  request("new", "2026-10-01T09:00:00.000Z"),
  request("accepted", "2025-11-01T09:00:00.000Z"), // last year
];
const requestStats = computeStats({ commissions: [], payments: [], templates: [], stages, requests: funnel, currency: "EUR", now }, "year").requests;

assert.deepStrictEqual(
  [requestStats.received, requestStats.accepted, requestStats.declined, requestStats.waitlist, requestStats.open],
  [5, 2, 1, 1, 1],
);
// Of the decided ones (2 accepted, 1 declined)
assert.strictEqual(requestStats.rate, 67);
assert.deepStrictEqual(requestStats.months[1], { key: "2026-02", received: 1, accepted: 1 });
assert.deepStrictEqual(requestStats.months[2], { key: "2026-03", received: 2, accepted: 1 });
assert.deepStrictEqual(requestStats.months[9], { key: "2026-10", received: 1, accepted: 0 });

const allRequests = computeStats({ commissions: [], payments: [], templates: [], stages, requests: funnel, currency: "EUR", now }, "12m").requests;
assert.deepStrictEqual([allRequests.received, allRequests.rate], [6, 75]);
assert.deepStrictEqual(allRequests.months[0], { key: "2025-11", received: 1, accepted: 1 });

// No requests at all: nothing to divide
const noRequests = computeStats({ commissions: [], payments: [], templates: [], stages, currency: "EUR", now }, "year").requests;
assert.deepStrictEqual([noRequests.received, noRequests.rate], [0, null]);

// ---- Change against the previous period ----
assert.strictEqual(changePercent(112, 100), 12);
assert.strictEqual(changePercent(95, 100), -5);
assert.strictEqual(changePercent(50, 0), null);
assert.strictEqual(changePercent(null, 100), null);

console.log("stats ok");
