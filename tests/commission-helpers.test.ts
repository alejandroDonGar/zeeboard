// What every screen shows about a commission: deadline chip, progress, prices typed by hand, money and alternatives.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  formatMoney,
  getCommissionCompletionPercentage,
  getDeadlineStatus,
  groupAlternatives,
  isCommissionCompleted,
  netIncome,
  parsePrice,
  paymentSummary,
  ratePerHour,
  trackedHours,
} from "../src/lib/commissionHelpers";
import type { Commission, CommissionStageImage, TemplateStage } from "../src/lib/database";

afterEach(() => vi.useRealTimers());

describe("deadline chip", () => {
  const today = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${iso}T15:30:00`));
  };

  test("no deadline, or one that isn't a date, shows nothing", () => {
    expect(getDeadlineStatus(null)).toBeNull();
    expect(getDeadlineStatus("tomorrow")).toBeNull();
  });

  test("late, due today, this week and later each look different", () => {
    today("2026-11-20");
    expect(getDeadlineStatus("2026-11-19")).toEqual({ label: "1 day overdue", short: "1d late", className: "chip chip-solid chip-bad" });
    expect(getDeadlineStatus("2026-11-17")?.label).toBe("3 days overdue");
    expect(getDeadlineStatus("2026-11-20")).toEqual({ label: "Due today", short: "Due today", className: "chip chip-solid chip-bad" });
    expect(getDeadlineStatus("2026-11-21")).toEqual({ label: "1 day left", short: "1d", className: "chip chip-warn" });
    expect(getDeadlineStatus("2026-11-27")?.label).toBe("7 days left");
    expect(getDeadlineStatus("2026-11-28")).toEqual({ label: "8 days left", short: "8d", className: "chip" });
  });
});

describe("price typed by hand", () => {
  test("comma or dot decimals, spaces, and rounding to cents", () => {
    expect(parsePrice("186,84")).toBe(186.84);
    expect(parsePrice(" 1 200.5 ")).toBe(1200.5);
    expect(parsePrice("10.005")).toBe(10.01);
  });

  test("empty means no price; text or negatives are refused with the typed value", () => {
    expect(parsePrice("   ")).toBeNull();
    expect(() => parsePrice("abc")).toThrow('"abc"');
    expect(() => parsePrice("-5")).toThrow();
  });

  test("money shows decimals only when there are some, and euros when the currency is missing", () => {
    expect(formatMoney(200, null)).toMatch(/^200 EUR$/);
    expect(formatMoney(186.84, "USD")).toMatch(/^186[.,]84 USD$/);
  });
});

describe("progress", () => {
  const stages: Record<number, TemplateStage[]> = {
    1: [
      { id: 10, template_id: 1, name: "Sketch", stage_order: 1 },
      { id: 11, template_id: 1, name: "Delivery", stage_order: 2 },
    ],
    2: [],
  };
  const at = (template_id: number | null, current_stage_id: number | null) => ({ template_id, current_stage_id }) as Commission;

  test("halfway through two stages is 50 %; the last stage is finished", () => {
    expect(getCommissionCompletionPercentage(at(1, 10), stages)).toBe(50);
    expect(isCommissionCompleted(at(1, 11), stages)).toBe(true);
  });

  test("a cancelled commission is closed wherever it was", () => {
    expect(isCommissionCompleted({ ...at(1, 10), cancelled_at: "2026-11-20T10:00:00.000Z" }, stages)).toBe(true);
  });

  test("no template, no stage, a template without stages or a stage from elsewhere count as 0 %", () => {
    expect(getCommissionCompletionPercentage(at(null, 10), stages)).toBe(0);
    expect(getCommissionCompletionPercentage(at(1, null), stages)).toBe(0);
    expect(getCommissionCompletionPercentage(at(2, 10), stages)).toBe(0);
    expect(getCommissionCompletionPercentage(at(3, 10), stages)).toBe(0);
    expect(getCommissionCompletionPercentage(at(1, 99), stages)).toBe(0);
  });
});

describe("money", () => {
  test("payments without the received amount don't count as fees, and are counted as pending", () => {
    expect(paymentSummary(100, [{ amount: 60, received: 57 }, { amount: 40, received: null }])).toMatchObject({
      paid: 100, received: 57, fees: 3, pendingReceived: 1, status: "paid",
    });
  });

  test("a refund takes the money back: paid goes down, what is left to collect goes up, a kept fee is a loss", () => {
    const summary = paymentSummary(100, [{ amount: 100, received: 96 }, { amount: -100, received: -100 }]);
    expect(summary).toMatchObject({ paid: 0, remaining: 100, received: -4, fees: 4, status: "unpaid" });
    expect(netIncome(summary)).toBe(-4);
  });

  test("the rate per hour ignores entries without hours, and is unknown with none", () => {
    expect(ratePerHour([{ net: 100, hours: 4 }, { net: 50, hours: null }, { net: 30, hours: 0 }])).toBe(25);
    expect(ratePerHour([{ net: 100, hours: null }])).toBeNull();
  });
});

test("tracked time: the total and each stage's share, with the running entry counted until now", () => {
  const entries = [
    { stage_id: 1, started_at: "2026-11-25T10:00:00.000Z", ended_at: "2026-11-25T11:30:00.000Z" },
    { stage_id: 2, started_at: "2026-11-25T12:00:00.000Z", ended_at: null },
    { stage_id: 1, started_at: "2026-11-25T09:00:00.000Z", ended_at: "2026-11-25T09:15:00.000Z" },
  ];
  expect(trackedHours(entries, new Date("2026-11-25T12:15:00.000Z"))).toEqual({ total: 2, byStage: { 1: 1.75, 2: 0.25 } });
  expect(trackedHours([], new Date())).toEqual({ total: 0, byStage: {} });
});

test("versions uploaded in the same second keep the order they were saved in", () => {
  const image = (id: number, alt: number, version: number) => ({ id, alt, version }) as CommissionStageImage;
  const groups = groupAlternatives([image(3, 2, 1), image(2, 1, 1), image(1, 1, 1)]);
  expect(groups.map((group) => [group.alt, group.versions.map((version) => version.id)])).toEqual([[1, [1, 2]], [2, [3]]]);
});
