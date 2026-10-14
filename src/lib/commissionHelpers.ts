import { t } from "./i18n";
import { isPrivate } from "./privacy";
import {
  getCommissions,
  getTemplateStages,
  getCommissionStageImages,
  type Commission,
  type CommissionStageImage,
  type TemplateStage,
} from "./database";

export async function loadStageImagesForCommissions(
  data: Commission[],
): Promise<Record<number, CommissionStageImage[]>> {
  const entries = await Promise.all(
    data.map(async (commission) => {
      const images = await getCommissionStageImages(commission.id);
      return [commission.id, images] as const;
    }),
  );

  return Object.fromEntries(entries);
}

/** One stage's images grouped by alternative; each has its versions, oldest first (the last one is the current). */
export function groupAlternatives(images: CommissionStageImage[]): { alt: number; versions: CommissionStageImage[] }[] {
  const groups = new Map<number, CommissionStageImage[]>();

  for (const image of images) {
    groups.set(image.alt, [...(groups.get(image.alt) ?? []), image]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([alt, versions]) => ({ alt, versions: versions.sort((a, b) => a.version - b.version || a.id - b.id) }));
}

export function getCommissionCompletionPercentage(
  commission: Commission,
  templateStagesByTemplateId: Record<number, TemplateStage[]>,
): number {
  if (!commission.template_id || !commission.current_stage_id) {
    return 0;
  }

  const stages = templateStagesByTemplateId[commission.template_id] ?? [];

  if (stages.length === 0) {
    return 0;
  }

  const stageIndex = stages.findIndex(
    (stage) => stage.id === commission.current_stage_id,
  );

  if (stageIndex === -1) {
    return 0;
  }

  return Math.round(((stageIndex + 1) / stages.length) * 100);
}

export function isCommissionCompleted(
  commission: Commission,
  templateStagesByTemplateId: Record<number, TemplateStage[]>,
): boolean {
  return (
    getCommissionCompletionPercentage(commission, templateStagesByTemplateId) === 100
  );
}

export function getDeadlineStatus(deadline: string | null) {
  if (!deadline) {
    return null;
  }

  const deadlineDate = new Date(`${deadline}T00:00:00`);

  if (Number.isNaN(deadlineDate.getTime())) {
    return null;
  }

  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  const daysLeft = Math.round(
    (deadlineDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysLeft < 0) {
    return {
      label: t(daysLeft === -1 ? "{n} day overdue" : "{n} days overdue", { n: Math.abs(daysLeft) }),
      short: t("{n}d late", { n: Math.abs(daysLeft) }),
      className: "chip chip-solid chip-bad",
    };
  }

  if (daysLeft === 0) {
    return {
      label: t("Due today"),
      short: t("Due today"),
      className: "chip chip-solid chip-bad",
    };
  }

  if (daysLeft <= 7) {
    return {
      label: t(daysLeft === 1 ? "{n} day left" : "{n} days left", { n: daysLeft }),
      short: t("{n}d", { n: daysLeft }),
      className: "chip chip-warn",
    };
  }

  return {
    label: t("{n} days left", { n: daysLeft }),
    short: t("{n}d", { n: daysLeft }),
    className: "chip",
  };
}
export type PaymentStatus = "unpaid" | "partial" | "paid";

export type PaymentSummary = {
  /** What clients have paid towards the price (tips aside) */
  paid: number;
  /** Tips: extra money on top of the price */
  tips: number;
  /** What reached you, from payments where you entered it */
  received: number;
  /** What the platform kept, from those same payments */
  fees: number;
  /** What's left to collect of the price */
  remaining: number;
  /** Payments whose received amount isn't entered yet */
  pendingReceived: number;
  status: PaymentStatus;
};

/** Rounds to cents without floating-point error (149.985 → 149.99, not 149.98) */
export const round2 = (value: number) => Math.round(Number((value * 100).toPrecision(12))) / 100;

/** Payment status of a commission from its payments: used by every screen. */
export function paymentSummary(
  price: number | null,
  payments: { amount: number; received: number | null; tip?: number }[],
): PaymentSummary {
  const paid = round2(payments.reduce((sum, payment) => sum + (payment.tip ? 0 : payment.amount), 0));
  const tips = round2(payments.reduce((sum, payment) => sum + (payment.tip ? payment.amount : 0), 0));
  const withReceived = payments.filter((payment) => payment.received !== null);
  const received = round2(withReceived.reduce((sum, payment) => sum + (payment.received ?? 0), 0));
  const fees = round2(withReceived.reduce((sum, payment) => sum + payment.amount, 0) - received);
  const remaining = round2(Math.max((price ?? 0) - paid, 0));

  const status: PaymentStatus =
    paid > 0 && (price === null || remaining === 0) ? "paid" : paid > 0 ? "partial" : "unpaid";

  return { paid, tips, received, fees, remaining, pendingReceived: payments.length - withReceived.length, status };
}

/** What reached you: net of fees where the net is entered, what the client paid where it isn't yet. */
export function netIncome(summary: PaymentSummary): number {
  return round2(summary.paid + summary.tips - summary.fees);
}

/** Euros per hour over the entries that have hours (total income / total hours, so long pieces weigh more). */
export function ratePerHour(entries: { net: number; hours: number | null }[]): number | null {
  const withHours = entries.filter((entry) => entry.hours !== null && entry.hours > 0);
  const hours = withHours.reduce((sum, entry) => sum + (entry.hours ?? 0), 0);

  return hours > 0 ? round2(withHours.reduce((sum, entry) => sum + entry.net, 0) / hours) : null;
}

/** Day (YYYY-MM-DD) it was delivered: the date typed when marking it finished, else when it reached its last stage. */
export function deliveryDay(commission: Commission): string {
  if (commission.delivered_at) {
    return commission.delivered_at;
  }

  return commission.stage_changed_at ? isoDay(new Date(commission.stage_changed_at)) : commission.created_at.slice(0, 10);
}

export const PAYMENT_STATUS_STYLE: Record<PaymentStatus, { label: string; className: string }> = {
  unpaid: { label: t("Unpaid"), className: "chip chip-bad" },
  partial: { label: t("Partial"), className: "chip chip-warn" },
  paid: { label: t("Paid"), className: "chip chip-ok" },
};

// ponytail: your handle is hardcoded (same on all your networks); move to Settings if it ever changes
const ARTIST_HANDLE = "@AverageZebraBoy";

/** Short invoice text: "Rendered, 2 characters (Ana, Beto) - @AverageZebraBoy". */
export function invoiceDescription(templateName: string | null, characterNames: string[]): string {
  const count = characterNames.length;
  const characters = count ? `${count} ${count === 1 ? "character" : "characters"} (${characterNames.join(", ")})` : "";
  const detail = [templateName, characters].filter(Boolean).join(", ");

  return detail ? `${detail} - ${ARTIST_HANDLE}` : ARTIST_HANDLE;
}

/** Full Colour at 160 with 2 characters and rate 0.5: 160 + 50% of 160 = 240 (rate comes from Settings) */
export function calculateCommissionPrice(basePrice: number, characterCount: number, extraCharacterRate: number): number {
  const extraCharacters = Math.max(characterCount, 1) - 1;
  return round2(basePrice * (1 + extraCharacterRate * extraCharacters));
}

/** Characters a price is for: the number asked for (or typed), never fewer than the ones linked, at least 1 */
export function effectiveCharacterCount(asked: number, linked: number): number {
  return Math.max(1, Math.floor(asked) || 1, linked);
}

/** Number of a correction pin on its image (1, 2, 3… in the order they were added); null when it has no pin */
export function pinNumber(
  corrections: { id: number; image_id: number | null }[],
  correction: { id: number; image_id: number | null },
): number | null {
  if (correction.image_id === null) {
    return null;
  }

  return corrections.filter((other) => other.image_id === correction.image_id && other.id <= correction.id).length;
}

/** The corrections still pending as a numbered list to paste to the client: "1. Make the nose bigger" */
export function pendingCorrectionsText(corrections: { text: string; done_at: string | null }[]): string {
  return corrections
    .filter((correction) => correction.done_at === null)
    .map((correction, index) => `${index + 1}. ${correction.text}`)
    .join("\n");
}

/** What a payment nets after the platform fee: amount − (amount × % + fixed) */
export function receivedAfterFees(amount: number, platform: { percent: number; fixed: number }): number {
  return round2(Math.max(amount - (amount * platform.percent) / 100 - platform.fixed, 0));
}

/** Parses a typed price: accepts "186,84", "186.84" or "200". Empty = no price. */
export function parsePrice(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".");

  if (clean === "") {
    return null;
  }

  const value = Number(clean);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`"${text}" isn't a valid price. Use numbers like 186,84`);
  }

  return round2(value);
}

/** "200 EUR", "186,84 EUR": decimals only when present, in the system format. */
export function formatMoney(amount: number, currency?: string | null): string {
  if (isPrivate()) {
    return "•••";
  }

  const rounded = round2(amount);
  const decimals = Number.isInteger(rounded) ? 0 : 2;

  return `${rounded.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${currency || "EUR"}`;
}

/** Local date as "2026-10-06" (toISOString uses UTC and can be off by a day). */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Commissions not finished yet (the ones that take a slot). */
export async function loadOpenCommissions(): Promise<Commission[]> {
  const commissions = await getCommissions();
  const templateIds = [...new Set(commissions.map((c) => c.template_id).filter((id): id is number => id !== null))];
  const stages = Object.fromEntries(
    await Promise.all(templateIds.map(async (id) => [id, await getTemplateStages(id)] as const)),
  );

  return commissions.filter((commission) => !isCommissionCompleted(commission, stages));
}
