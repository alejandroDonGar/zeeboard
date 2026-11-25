// Numbers for the Statistics screen. Pure: the page loads the data and only paints what comes out of here.
import {
  deliveryDay,
  isCommissionCompleted,
  isoDay,
  netIncome,
  paymentSummary,
  ratePerHour,
  round2,
  inDefaultCurrency,
} from "./commissionHelpers";
import type { Commission, CommissionPayment, RequestStatus, TemplateStage } from "./database";

export type Period = "year" | "12m" | "all";

/** Inclusive days, YYYY-MM-DD */
export type Range = { from: string; to: string };

export type Summary = { received: number; pieces: number; avgPerPiece: number | null; rate: number | null };

export type TemplateRow = {
  name: string;
  pieces: number;
  net: number;
  avgNet: number;
  avgHours: number | null;
  rate: number | null;
  /** Average days from creating the commission to delivering it */
  avgDays: number | null;
};

export type ClientRow = { name: string; pieces: number; net: number };

export type Stats = {
  /** Commissions left out because they are in another currency (they are never added together) */
  excluded: number;
  current: Summary;
  /** The same length of time right before; null for "all" */
  previous: Summary | null;
  /** 12 months of cash received: the year for "year", the last 12 months otherwise */
  months: { key: string; total: number }[];
  byTemplate: TemplateRow[];
  /** The 5 clients that brought in the most from what was delivered in the period */
  topClients: ClientRow[];
  /** % of that income that comes from clients with 2 or more commissions; null with no clients to measure */
  returningShare: number | null;
  /** Cash in the period: what the platforms kept, as a % of what clients paid (only payments with the net entered) */
  fees: { total: number; percent: number | null; pending: number };
  /** Requests that came in during the period. Ones removed from the list are gone, so they don't count. */
  requests: {
    received: number;
    accepted: number;
    declined: number;
    waitlist: number;
    /** Not answered yet */
    open: number;
    /** accepted / (accepted + declined): of the ones already decided; null when none is */
    rate: number | null;
    months: { key: string; received: number; accepted: number }[];
  };
};

export function periodRanges(period: Period, now: Date): { current: Range; previous: Range | null } {
  if (period === "all") {
    return { current: { from: "0000-01-01", to: "9999-12-31" }, previous: null };
  }

  const year = now.getFullYear();

  if (period === "year") {
    return {
      current: { from: `${year}-01-01`, to: `${year}-12-31` },
      previous: { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
    };
  }

  // Last 12 months, today included
  const from = new Date(year - 1, now.getMonth(), now.getDate() + 1);
  const previousFrom = new Date(year - 2, now.getMonth(), now.getDate() + 1);

  return {
    current: { from: isoDay(from), to: isoDay(now) },
    previous: { from: isoDay(previousFrom), to: isoDay(new Date(from.getTime() - 86400000)) },
  };
}

const inRange = (day: string, range: Range) => day >= range.from && day <= range.to;

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000));

/** What one payment brought in: the net where it is entered, else what the client paid */
const paymentNet = (payment: CommissionPayment) => payment.received ?? payment.amount;

export function computeStats(
  input: {
    commissions: Commission[];
    payments: CommissionPayment[];
    templates: { id: number; name: string }[];
    stages: Record<number, TemplateStage[]>;
    requests?: { status: RequestStatus; created_at: string }[];
    /** Default currency: commissions without one count as this */
    currency: string;
    now: Date;
  },
  period: Period,
): Stats {
  const { current, previous } = periodRanges(period, input.now);

  // Everything in the default currency (other currencies by their typed rate; without one, left out)
  const money = inDefaultCurrency(input.commissions, input.payments, input.currency);
  const included = money.commissions;
  const payments = money.payments;

  const piecesIn = (range: Range) =>
    included
      .filter((commission) => !commission.cancelled_at && isCommissionCompleted(commission, input.stages) && inRange(deliveryDay(commission), range))
      .map((commission) => ({
        commission,
        net: netIncome(paymentSummary(commission.price, payments.filter((payment) => payment.commission_id === commission.id))),
      }));

  const summary = (range: Range): Summary => {
    const pieces = piecesIn(range);
    const total = round2(pieces.reduce((sum, piece) => sum + piece.net, 0));

    return {
      received: round2(payments.filter((payment) => inRange(payment.paid_at, range)).reduce((sum, payment) => sum + paymentNet(payment), 0)),
      pieces: pieces.length,
      avgPerPiece: pieces.length > 0 ? round2(total / pieces.length) : null,
      rate: ratePerHour(pieces.map((piece) => ({ net: piece.net, hours: piece.commission.hours }))),
    };
  };

  // 12 month buckets
  const start = period === "year" ? new Date(input.now.getFullYear(), 0, 1) : new Date(input.now.getFullYear(), input.now.getMonth() - 11, 1);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

    return {
      key,
      total: round2(payments.filter((payment) => payment.paid_at.startsWith(key)).reduce((sum, payment) => sum + paymentNet(payment), 0)),
    };
  });

  const byTemplate = new Map<string, { net: number; hours: number[]; days: number[]; entries: { net: number; hours: number | null }[] }>();
  const delivered = piecesIn(current);

  for (const { commission, net } of delivered) {
    const name = input.templates.find((template) => template.id === commission.template_id)?.name ?? "";
    const row = byTemplate.get(name) ?? { net: 0, hours: [], days: [], entries: [] };

    row.net += net;
    row.days.push(daysBetween(commission.created_at.slice(0, 10), deliveryDay(commission)));
    row.entries.push({ net, hours: commission.hours });
    if (commission.hours !== null && commission.hours > 0) row.hours.push(commission.hours);
    byTemplate.set(name, row);
  }

  // Clients: by id when there is one, else by name
  const clientKey = (commission: Commission) =>
    commission.client_id !== null ? `id:${commission.client_id}` : commission.client_name ? `name:${commission.client_name}` : null;
  const commissionsPerClient = new Map<string, number>();

  for (const commission of included) {
    const key = clientKey(commission);
    if (key) commissionsPerClient.set(key, (commissionsPerClient.get(key) ?? 0) + 1);
  }

  const perClient = new Map<string, ClientRow>();

  for (const { commission, net } of delivered) {
    const key = clientKey(commission);
    if (!key) continue;
    const row = perClient.get(key) ?? { name: commission.client_name ?? "", pieces: 0, net: 0 };

    row.pieces += 1;
    row.net = round2(row.net + net);
    perClient.set(key, row);
  }

  const clientTotal = [...perClient.values()].reduce((sum, row) => sum + row.net, 0);
  const returningTotal = [...perClient.entries()]
    // Every delivered client is in commissionsPerClient (delivered ones are among the included)
    .filter(([key]) => Number(commissionsPerClient.get(key)) >= 2)
    .reduce((sum, [, row]) => sum + row.net, 0);

  // Fees of the cash received in the period
  const periodPayments = payments.filter((payment) => inRange(payment.paid_at, current));
  const withNet = periodPayments.filter((payment): payment is CommissionPayment & { received: number } => payment.received !== null);
  const gross = withNet.reduce((sum, payment) => sum + payment.amount, 0);
  const feesTotal = round2(gross - withNet.reduce((sum, payment) => sum + payment.received, 0));

  // Requests by the day they came in
  const requests = input.requests ?? [];
  const requestsIn = (range: Range) => requests.filter((request) => inRange(request.created_at.slice(0, 10), range));
  const count = (list: typeof requests, status: RequestStatus) => list.filter((request) => request.status === status).length;
  const inPeriod = requestsIn(current);
  const accepted = count(inPeriod, "accepted");
  const declined = count(inPeriod, "declined");

  return {
    excluded: money.excluded,
    current: summary(current),
    previous: previous ? summary(previous) : null,
    months,
    byTemplate: [...byTemplate.entries()]
      .map(([name, row]) => ({
        name,
        pieces: row.entries.length,
        net: round2(row.net),
        avgNet: round2(row.net / row.entries.length),
        avgHours: row.hours.length > 0 ? round2(row.hours.reduce((sum, hours) => sum + hours, 0) / row.hours.length) : null,
        rate: ratePerHour(row.entries),
        avgDays: Math.round(row.days.reduce((sum, days) => sum + days, 0) / row.days.length),
      }))
      .sort((a, b) => b.net - a.net),
    topClients: [...perClient.values()].sort((a, b) => b.net - a.net).slice(0, 5),
    returningShare: clientTotal > 0 ? Math.round((returningTotal / clientTotal) * 100) : null,
    fees: {
      total: feesTotal,
      percent: gross > 0 ? Math.round((feesTotal / gross) * 1000) / 10 : null,
      pending: periodPayments.length - withNet.length,
    },
    requests: {
      received: inPeriod.length,
      accepted,
      declined,
      waitlist: count(inPeriod, "waitlist"),
      open: count(inPeriod, "new"),
      rate: accepted + declined > 0 ? Math.round((accepted / (accepted + declined)) * 100) : null,
      months: months.map(({ key }) => {
        const inMonth = requests.filter((request) => request.created_at.startsWith(key));
        return { key, received: inMonth.length, accepted: count(inMonth, "accepted") };
      }),
    },
  };
}

/** "+12 %" / "-5 %" against the previous period; null when there is nothing to compare */
export function changePercent(now: number | null, before: number | null): number | null {
  return now !== null && before !== null && before > 0 ? Math.round(((now - before) / before) * 100) : null;
}
