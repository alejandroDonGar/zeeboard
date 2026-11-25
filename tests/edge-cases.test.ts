// Real-world inputs the main tests don't cover: short CSV rows, missing values, ties.
import { afterEach, describe, expect, test, vi } from "vitest";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { computeAttention, notifyNew } from "../src/lib/reminders";

vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn() }));
import { normalizeHandle, parseResponses } from "../src/lib/formImport";
import { latestOfAlternative } from "../src/lib/ipadLink";
import { search } from "../src/lib/search";
import { matchPaypalRows, parsePaypalCsv, parsePaypalDate } from "../src/lib/paypalImport";
import { buildCommissionsCsv, buildPaymentsCsv, buildQuarterlyCsv } from "../src/lib/export";
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

describe("PayPal activity CSV", () => {
  test("an empty file says so", () => {
    expect(parsePaypalCsv("").error).toBeTruthy();
  });

  test("without status, fee or net columns, the gross is what reached you", () => {
    const csv = "Date,Currency,Gross,From Email Address,Transaction ID\n04/10/2026,eur,\"120,00\",Ana@Example.com,TX1";
    expect(parsePaypalCsv(csv).rows).toEqual([{ txId: "TX1", date: "2026-10-04", currency: "EUR", gross: 120, net: 120, email: "ana@example.com" }]);
  });

  test("short lines, unreadable dates or amounts, refunds and pending payments are skipped", () => {
    const header = "Date,Status,Currency,Gross,Fee,Net,From Email Address,Transaction ID";
    const csv = [
      header,
      "04/10/2026,Completed,EUR",
      "someday,Completed,EUR,120,-4,116,ana@example.com,TX1",
      "04/10/2026,Completed,EUR,-120,0,-120,ana@example.com,TX2",
      "04/10/2026,Pending,EUR,120,-4,116,ana@example.com,TX3",
      "04/10/2026,Completed,EUR,120,n/a,,ana@example.com,TX4",
    ].join("\n");
    // The last one: fee unreadable counts as 0, net missing is computed
    expect(parsePaypalCsv(csv).rows).toEqual([{ txId: "TX4", date: "2026-10-04", currency: "EUR", gross: 120, net: 120, email: "ana@example.com" }]);
    expect(parsePaypalDate("tomorrow")).toBeNull();
  });

  test("a commission or a payment without a currency matches any currency", () => {
    const row = { txId: "TX1", date: "2026-10-04", currency: "", gross: 50, net: 48, email: "ana@example.com" };
    const [match] = matchPaypalRows([row], [{ id: 1, email: "ana@example.com" }], [{ id: 10, client_id: 1, price: 100, currency: null }], []);
    expect(match).toMatchObject({ status: "ready", commissionId: 10 });
  });
});

describe("reminders", () => {
  const options = { promise_max_days: 60, reminders_enabled: true, reminder_days_before: 3, stalled_enabled: true, stalled_days: 21 };
  const now = new Date(2026, 9, 6, 12);

  test("with no recorded activity, a commission counts as idle since it was accepted", () => {
    const old = { id: 1, title: "Old", created_at: new Date(2026, 8, 1, 10).toISOString(), deadline: "2026-12-31" };
    expect(computeAttention([old], {}, options, now).map((item) => [item.kind, item.days])).toEqual([["stalled", 35]]);
  });

  test("among late ones, the latest goes first", () => {
    const late = (id: number, deadline: string) => ({ id, title: `C${id}`, created_at: new Date(2026, 9, 1).toISOString(), deadline });
    const items = computeAttention([late(1, "2026-10-04"), late(2, "2026-10-01")], {}, options, now);
    expect(items.map((item) => item.commission.id)).toEqual([2, 1]);
  });
});

describe("Windows notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(sendNotification).mockClear();
  });
  const item = (key: string) => ({ key, text: `Alert ${key}` }) as Parameters<typeof notifyNew>[0][number];
  const storage = (broken = false) => {
    const data: Record<string, string> = {};
    const fail = () => {
      throw new Error("storage disabled");
    };
    vi.stubGlobal("localStorage", {
      getItem: broken ? fail : (key: string) => data[key] ?? null,
      setItem: broken ? fail : (key: string, value: string) => void (data[key] = value),
    });
  };

  test("each alert is sent once", () => {
    storage();
    expect(notifyNew([item("a"), item("b")])).toBe(2);
    expect(vi.mocked(sendNotification).mock.calls.map(([options]) => (options as { body: string }).body)).toEqual(["Alert a", "Alert b"]);
    expect(notifyNew([item("a"), item("b")])).toBe(0);
  });

  test("more than three at once become one summary", () => {
    storage();
    expect(notifyNew(["a", "b", "c", "d"].map(item))).toBe(4);
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledWith({ title: "ZeeBoard", body: "4 commissions need your attention" });
  });

  test("without storage it still alerts (better to repeat than to miss one)", () => {
    storage(true);
    expect(notifyNew([item("a")])).toBe(1);
    expect(notifyNew([item("a")])).toBe(1);
  });
});

describe("CSV export", () => {
  const queued = {
    id: 1, title: "Queued", client_name: null, platform: null, template_id: null, current_stage_id: null, price: null,
    currency: null, created_at: "2026-11-01T10:00:00.000Z", deadline: null,
  } as Commission;
  const orphan = { id: 9, commission_id: 99, amount: 20, received: null, paid_at: "2026-11-02", note: null } as CommissionPayment;
  const data = { commissions: [queued], payments: [orphan], templates: [], stages: {} };

  test("a commission in the queue, without a template, price or currency, still exports", () => {
    const [, row] = buildCommissionsCsv(data).split("\r\n");
    expect(row).toBe("Queued;;;;;Queue;;EUR;0,00;;;Unpaid;2026-11-01;");
  });

  test("a cancelled commission exports as cancelled", () => {
    const [, row] = buildCommissionsCsv({ ...data, commissions: [{ ...queued, cancelled_at: "2026-11-20T10:00:00.000Z" }] }).split("\r\n");
    expect(row.split(";")[5]).toBe("Cancelled");
  });

  test("a commission at the last stage of its template exports as finished", () => {
    const stages = { 1: [{ id: 10, template_id: 1, name: "Delivery", stage_order: 1 }] };
    const finished = { ...queued, template_id: 1, current_stage_id: 10 };
    const [, row] = buildCommissionsCsv({ ...data, commissions: [finished], stages }).split("\r\n");
    expect(row.split(";").slice(4, 6)).toEqual(["Delivery", "Finished"]);
  });

  test("a payment whose commission is gone exports with empty title and in euros", () => {
    expect(buildPaymentsCsv(data).split("\r\n")[1]).toBe("2026-11-02;;;EUR;20,00;;;");
    expect(buildQuarterlyCsv(data).split("\r\n")[1]).toMatch(/^2026.*4;EUR;1;20,00;0,00;0,00;1$/);
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

  test("a cancelled commission is not a delivered piece, but the deposit it left still counts as income", () => {
    const cancelled = delivered(1, { cancelled_at: "2026-05-01T10:00:00.000Z" });
    const stats = computeStats({ commissions: [cancelled], payments: [paid(1, 1)], templates: [], stages, currency: "EUR", now }, "year");
    expect(stats.current.pieces).toBe(0);
    expect(stats.current.received).toBe(100);
  });

  test("clients without a profile are grouped by name, and count as returning", () => {
    const commissions = [delivered(1, { client_name: "Bea" }), delivered(2, { client_name: "Bea" })];
    const stats = computeStats({ commissions, payments: [paid(1, 1), paid(2, 2)], templates: [], stages, currency: "EUR", now }, "year");
    expect(stats.topClients).toEqual([{ name: "Bea", pieces: 2, net: 200 }]);
    expect(stats.returningShare).toBe(100);
  });
});
