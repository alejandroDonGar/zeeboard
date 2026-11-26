import { locale, t } from "./i18n";
import { isPrivate } from "./privacy";
import {
  appSettings,
  getCommissions,
  getStagesByTemplate,
  getStageImagesByCommission,
  type Commission,
  type CommissionStageImage,
  type TemplateStage,
} from "./database";

export const loadStageImagesForCommissions = (data: Commission[]): Promise<Record<number, CommissionStageImage[]>> =>
  getStageImagesByCommission(data.map((commission) => commission.id));

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
  // "Completed" means closed: a cancelled commission leaves the board, the slots, the reminders and the iPad too
  return (
    Boolean(commission.cancelled_at) ||
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
  const withReceived = payments.filter((payment): payment is typeof payment & { received: number } => payment.received !== null);
  const received = round2(withReceived.reduce((sum, payment) => sum + payment.received, 0));
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
  const withHours = entries.filter((entry): entry is { net: number; hours: number } => entry.hours !== null && entry.hours > 0);
  const hours = withHours.reduce((sum, entry) => sum + entry.hours, 0);

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

  return `${rounded.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${currency || "EUR"}`;
}

/** Hours and other plain numbers in the app's language (not Windows'), up to 2 decimals: 10.25 / 10,25 */
export function formatNumber(value: number): string {
  return value.toLocaleString(locale, { maximumFractionDigits: 2 });
}

/** Local date as "2026-10-06" (toISOString uses UTC and can be off by a day). */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Commissions not finished yet (the ones that take a slot). */
export async function loadOpenCommissions(): Promise<Commission[]> {
  const commissions = await getCommissions();
  const templateIds = [...new Set(commissions.map((c) => c.template_id).filter((id): id is number => id !== null))];
  const stages = await getStagesByTemplate(templateIds);

  return commissions.filter((commission) => !isCommissionCompleted(commission, stages));
}

/** Hours tracked with the timer: the total and per stage. The running entry counts until `now`. */
export function trackedHours(
  entries: { stage_id: number | null; started_at: string; ended_at: string | null }[],
  now: Date,
): { total: number; byStage: Record<number, number> } {
  const byStage: Record<number, number> = {};
  let total = 0;

  for (const entry of entries) {
    const hours = ((entry.ended_at ? new Date(entry.ended_at) : now).getTime() - new Date(entry.started_at).getTime()) / 3600000;
    total += hours;
    if (entry.stage_id !== null) byStage[entry.stage_id] = round2((byStage[entry.stage_id] ?? 0) + hours);
  }

  return { total: round2(total), byStage };
}

/**
 * Commissions and their payments in the default currency, for any total: another currency is multiplied by the rate typed
 * on the commission; one without a rate is left out (counted in `excluded`), never added as if it were the same money.
 */
export function inDefaultCurrency<
  C extends { id: number; currency?: string | null; price: number | null; exchange_rate?: number | null },
  P extends { commission_id: number; amount: number; received: number | null },
>(commissions: C[], payments: P[], currency: string): { commissions: C[]; payments: P[]; excluded: number } {
  const rates = new Map<number, number>();

  for (const commission of commissions) {
    if (!commission.currency || commission.currency === currency) rates.set(commission.id, 1);
    else if (commission.exchange_rate) rates.set(commission.id, commission.exchange_rate);
  }

  const convert = (value: number, rate: number) => (rate === 1 ? value : round2(value * rate));

  return {
    commissions: commissions
      .filter((commission) => rates.has(commission.id))
      .map((commission) => {
        const rate = rates.get(commission.id)!;
        return { ...commission, currency, price: commission.price === null ? null : convert(commission.price, rate) };
      }),
    payments: payments
      .filter((payment) => rates.has(payment.commission_id))
      .map((payment) => {
        const rate = rates.get(payment.commission_id)!;
        return { ...payment, amount: convert(payment.amount, rate), received: payment.received === null ? null : convert(payment.received, rate) };
      }),
    excluded: commissions.length - rates.size,
  };
}

/**
 * Days it usually takes to deliver each type, from accepting to delivering (delivered ones, cancelled left out): an estimate
 * for a new request. ponytail: a plain average of past ones, which already includes the queue each had; weight recent ones if
 * your pace changes a lot.
 */
export function typicalDays(commissions: Commission[], stages: Record<number, TemplateStage[]>): Record<number, number> {
  const byTemplate: Record<number, number[]> = {};

  for (const commission of commissions) {
    if (commission.template_id === null || commission.cancelled_at || !isCommissionCompleted(commission, stages)) continue;
    const days = (new Date(`${deliveryDay(commission)}T12:00:00`).getTime() - new Date(commission.created_at).getTime()) / 86400000;
    (byTemplate[commission.template_id] ??= []).push(days);
  }

  return Object.fromEntries(
    Object.entries(byTemplate).map(([id, days]) => [id, Math.round(days.reduce((sum, value) => sum + value, 0) / days.length)]),
  );
}

/** A message to paste to the client: {client}, {title}, {stage} and {remaining} are filled in; anything else stays as written. */
export function fillMessage(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => fields[name] ?? match);
}

export type MessageKind = "stage" | "payment" | "delivery" | "decline";

/** The text each template starts with (translated), until you write your own in Settings → Messages */
export const DEFAULT_MESSAGES: Record<MessageKind, string> = {
  stage: "Hi {client}! {stage} of your {title} is ready. Any changes before I continue?",
  payment: "Hi {client}! Whenever you can, {remaining} is left for {title}. Thank you!",
  delivery: "Hi {client}! Your {title} is finished. Thank you so much!",
  decline: "Hi {client}! Thank you for your request. I can't take it right now, sorry.",
};

/** A message ready to paste: your text (or the default one) with the fields, your name and your terms link filled in */
export function clientMessage(kind: MessageKind, fields: Record<string, string>, text = appSettings()[`msg_${kind}`]): string {
  const { artist_name, tos_url } = appSettings();
  return fillMessage(text ?? t(DEFAULT_MESSAGES[kind]), { artist: artist_name ?? "", tos: tos_url ?? "", ...fields });
}
