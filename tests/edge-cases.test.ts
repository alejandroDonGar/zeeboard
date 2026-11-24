// Real-world inputs the main tests don't cover: short CSV rows, missing values, ties.
import { describe, expect, test } from "vitest";
import { normalizeHandle, parseResponses } from "../src/lib/formImport";
import { latestOfAlternative } from "../src/lib/ipadLink";
import { search } from "../src/lib/search";
import { computeStats } from "../src/lib/stats";
import type { Commission, CommissionPayment, CommissionStageImage, TemplateStage } from "../src/lib/database";

describe("form responses", () => {
  const templates = [{ id: 1, name: "Bust" }];

  test("a row shorter than the header (Google leaves the last empty cells out) still imports", () => {
    const csv = [
      "Timestamp,Handle,Type of commission,Email,Tag when posting,References,How many characters",
      "2026/10/04 4:59:22 p. m. CET,Telegram @fox_demo",
    ].join("\n");

    expect(parseResponses(csv, templates).requests).toMatchObject([
      { name: "fox_demo", platform: "Telegram", template_id: null, characters: 1, email: null, tag_platform: null, details: null },
    ]);
  });

  test("a timestamp it can't read becomes the moment of the import", () => {
    const csv = "Timestamp,Handle,Type of commission\nsometime,Telegram @fox_demo,Bust";
    const [request] = parseResponses(csv, templates).requests;
    expect(Number.isNaN(Date.parse(request.created_at))).toBe(false);
    expect(request.template_id).toBe(1);
  });

  test("rows without a contact are skipped; a timestamp after the contact column may be missing", () => {
    const csv = ["Handle,Type of commission,Timestamp", "", "Telegram @fox_demo"].join("\n");
    const requests = parseResponses(csv, templates).requests;
    expect(requests.map((request) => request.contact)).toEqual(["@fox_demo"]);
    expect(Number.isNaN(Date.parse(requests[0].created_at))).toBe(false);

    // A row cut before the contact column
    expect(parseResponses("Timestamp,Handle,Type of commission\n2026/10/04 4:59:22 p. m. CET", templates).requests).toEqual([]);
  });

  test("an empty handle compares as empty", () => {
    expect(normalizeHandle(null)).toBe("");
    expect(normalizeHandle(undefined)).toBe("");
  });
});

test("two versions with the same number: the one saved last is the current one", () => {
  const image = (id: number, version: number) => ({ id, stage_id: 10, alt: 1, version }) as CommissionStageImage;
  expect(latestOfAlternative([image(7, 2), image(5, 2), image(3, 1)], 10, 1)?.id).toBe(7);
});

test("search: an entry without a first field is still found, after the ones that start with the query", () => {
  const entries = [{ fields: [null, "Ana's bust"] }, { fields: ["Ana"] }, { fields: [null, "Ana's sticker"] }];
  expect(search("ana", entries, (entry) => entry.fields, 10)[0]).toEqual({ fields: ["Ana"] });
});

describe("statistics", () => {
  const stages: Record<number, TemplateStage[]> = {
    1: [
      { id: 10, template_id: 1, name: "Sketch", stage_order: 1 },
      { id: 11, template_id: 1, name: "Delivery", stage_order: 2 },
    ],
  };
  const delivered = (id: number, extra: Partial<Commission>) =>
    ({ id, title: `c${id}`, template_id: 1, current_stage_id: 11, price: 100, currency: "EUR", created_at: "2026-01-01T10:00:00.000Z",
      stage_changed_at: null, delivered_at: "2026-05-01", hours: null, client_id: null, client_name: null, ...extra }) as Commission;
  const paid = (id: number, commission_id: number) =>
    ({ id, commission_id, amount: 100, received: 100, paid_at: "2026-05-02", note: null }) as CommissionPayment;
  const now = new Date(2026, 9, 7);

  test("a commission without a currency counts in the default one", () => {
    const stats = computeStats({ commissions: [delivered(1, { currency: null })], payments: [paid(1, 1)], templates: [], stages, currency: "EUR", now }, "year");
    expect(stats.excluded).toBe(0);
    expect(stats.current.received).toBe(100);
  });

  test("clients without a profile are grouped by name, and count as returning", () => {
    const commissions = [delivered(1, { client_name: "Bea" }), delivered(2, { client_name: "Bea" })];
    const stats = computeStats({ commissions, payments: [paid(1, 1), paid(2, 2)], templates: [], stages, currency: "EUR", now }, "year");
    expect(stats.topClients).toEqual([{ name: "Bea", pieces: 2, net: 200 }]);
    expect(stats.returningShare).toBe(100);
  });
});
