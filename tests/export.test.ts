// Quick check of the CSV export: npx tsx scripts/check-export.ts
import assert from "node:assert";
import { buildCommissionsCsv, buildPaymentsCsv, buildQuarterlyCsv, quarterOf, toCsv } from "../src/lib/export";

// Escaping: separator, quotes and line breaks go in quotes; formulas are marked as text
assert.strictEqual(
  toCsv(["a", "b"], [['Kai; "el" bueno', "línea\n2"], ["=SUM(A1)", "+34 600"]]),
  'a;b\r\n"Kai; ""el"" bueno";"línea\n2"\r\n\'=SUM(A1);\'+34 600\r\n',
);
// Numbers with decimal comma and empty values left blank
assert.strictEqual(toCsv(["x"], [[186.84], [200], [null]]), "x\r\n186,84\r\n200,00\r\n\r\n");

assert.strictEqual(quarterOf("2026-01-01"), "2026-Q1");
assert.strictEqual(quarterOf("2026-03-31"), "2026-Q1");
assert.strictEqual(quarterOf("2026-04-01"), "2026-Q2");
assert.strictEqual(quarterOf("2026-12-31"), "2026-Q4");

const created = new Date(2026, 6, 17, 10).toISOString();
const commission = (id: number, currency: string, price: number) =>
  ({ id, title: `C${id}`, client_name: `Client ${id}`, platform: "Bluesky", template_id: 1, current_stage_id: 11, price, currency, deadline: null, created_at: created }) as never;
const payment = (id: number, commission_id: number, amount: number, received: number | null, paid_at: string) =>
  ({ id, commission_id, amount, received, paid_at, note: null }) as never;

const data = {
  commissions: [commission(1, "EUR", 200), commission(2, "USD", 100)],
  payments: [
    payment(1, 1, 120, 113.78, "2026-09-30"), // Q3
    payment(2, 1, 80, null, "2026-10-02"), //  Q4, no "received"
    payment(3, 1, 100, 96.5, "2026-10-05"), // Q4
    payment(4, 2, 100, 95, "2026-10-03"), //   Q4 but in dollars: not mixed with euros
  ],
  templates: [{ id: 1, name: "Full Colour" }],
  stages: { 1: [{ id: 11, name: "Sketch" }, { id: 12, name: "Finished" }] } as never,
};

const quarterly = buildQuarterlyCsv(data).trim().split("\r\n");
assert.strictEqual(quarterly[0], "Quarter;Currency;Payments;Client paid;Received;Fees;Payments without 'received'");
assert.deepStrictEqual(quarterly.slice(1), [
  "2026-Q3;EUR;1;120,00;113,78;6,22;0",
  "2026-Q4;EUR;2;180,00;96,50;3,50;1", // the fee of a payment without "received" isn't invented
  "2026-Q4;USD;1;100,00;95,00;5,00;0",
]);

const payments = buildPaymentsCsv(data).trim().split("\r\n");
assert.strictEqual(payments.length, 5);
assert.strictEqual(payments[1], "2026-09-30;C1;Client 1;EUR;120,00;113,78;6,22;");
assert.strictEqual(payments[2], "2026-10-02;C1;Client 1;EUR;80,00;;;"); // without received, no fee either

const commissions = buildCommissionsCsv(data).trim().split("\r\n");
assert.strictEqual(commissions.length, 3);
assert.match(commissions[1], /^C1;Client 1;Bluesky;Full Colour;Sketch;In progress;200,00;EUR;300,00;/);

console.log("export ok");
