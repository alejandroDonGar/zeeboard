// Quick check of the PayPal importer: npx tsx scripts/check-paypal.ts
import assert from "node:assert";
import { matchPaypalRows, parseAmount, parsePaypalCsv, parsePaypalDate } from "../src/lib/paypalImport";

assert.strictEqual(parseAmount("1.234,56"), 1234.56);
assert.strictEqual(parseAmount("1,234.56"), 1234.56);
assert.strictEqual(parseAmount("-6,22"), -6.22);
assert.strictEqual(parseAmount("113.78"), 113.78);
assert.strictEqual(parseAmount("120"), 120);
assert.strictEqual(parseAmount(""), null);
assert.strictEqual(parsePaypalDate("04/10/2026"), "2026-10-04");
assert.strictEqual(parsePaypalDate("4.1.2026"), "2026-01-04");
assert.strictEqual(parsePaypalDate("2026-10-04"), "2026-10-04");

// Spanish export: decimal comma, quotes, a refund, a conversion without email and a pending one
const csv = [
  `"Fecha","Hora","Zona horaria","Nombre","Tipo","Estado","Divisa","Bruto","Tarifa","Neto","Remitente","Destinatario","Id. de transacción"`,
  `"01/10/2026","10:00:00","CET","Ana","Pago","Completado","EUR","120,00","-6,22","113,78","ana@mail.com","yo@mail.com","TX1"`,
  `"02/10/2026","10:00:00","CET","Ana","Pago","Completado","EUR","90,00","-4,75","85,25","ANA@mail.com","yo@mail.com","TX2"`,
  `"03/10/2026","10:00:00","CET","Beto","Pago","Completado","EUR","50,00","-2,00","48,00","beto@mail.com","yo@mail.com","TX3"`,
  `"04/10/2026","10:00:00","CET","Ana","Reembolso","Completado","EUR","-20,00","0,00","-20,00","ana@mail.com","yo@mail.com","TX4"`,
  `"05/10/2026","10:00:00","CET","","Conversión","Completado","USD","10,00","0,00","10,00","","","TX5"`,
  `"06/10/2026","10:00:00","CET","Ana","Pago","Pendiente","EUR","30,00","0,00","30,00","ana@mail.com","yo@mail.com","TX6"`,
].join("\n");
const { rows } = parsePaypalCsv(csv);
assert.deepStrictEqual(rows.map((row) => row.txId), ["TX1", "TX2", "TX3"]);
assert.deepStrictEqual(rows[0], { txId: "TX1", date: "2026-10-01", currency: "EUR", gross: 120, net: 113.78, email: "ana@mail.com" });
assert.strictEqual(rows[1].email, "ana@mail.com");
assert.ok(parsePaypalCsv("a,b\n1,2").error);

// Matching: Ana owes 120 (commission 1) and 90 (commission 2); the 90 payment looks for the one owing exactly 90
const clients = [{ id: 1, email: "Ana@mail.com" }, { id: 2, email: null }];
const commissions = [
  { id: 10, client_id: 1, price: 120, currency: "EUR" },
  { id: 11, client_id: 1, price: 90, currency: "EUR" },
  { id: 12, client_id: 2, price: 50, currency: "EUR" },
];
const match = matchPaypalRows(rows, clients, commissions, []);
assert.deepStrictEqual(match.map((item) => [item.status, item.commissionId]), [["ready", 10], ["ready", 11], ["unknown", null]]);

// Already imported isn't repeated, and an already paid commission doesn't come up again
const again = matchPaypalRows(rows, clients, commissions, [{ commission_id: 10, amount: 120, received: 113.78, external_id: "TX1" }]);
assert.deepStrictEqual(again.map((item) => item.status), ["duplicate", "ready", "unknown"]);
const paid = matchPaypalRows(rows.slice(0, 1), clients, [{ id: 10, client_id: 1, price: 120, currency: "EUR" }], [{ commission_id: 10, amount: 120, received: null, external_id: null }]);
assert.strictEqual(paid[0].status, "nodebt");

console.log("paypal ok");
