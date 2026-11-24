import { t } from "./i18n";
/**
 * Import PayPal "Activity" (CSV): each payment is matched to a client by email
 * and proposed as a payment on their commission with a balance. Pure logic: the CSV comes in as text.
 */
import { round2, paymentSummary } from "./commissionHelpers";
import { parseCsv } from "./formImport";

export type PaypalRow = {
  txId: string;
  /** YYYY-MM-DD */
  date: string;
  currency: string;
  /** What the client paid */
  gross: number;
  /** What reached you, after fees */
  net: number;
  email: string;
};

/** "1.234,56", "1,234.56", "-6,22" or "113.78". The last separator is the decimal one. */
export function parseAmount(text: string): number | null {
  const clean = text.trim().replace(/[^\d.,-]/g, "");
  const decimal = Math.max(clean.lastIndexOf(","), clean.lastIndexOf("."));
  const normalized =
    decimal < 0 ? clean : `${clean.slice(0, decimal).replace(/[.,]/g, "")}.${clean.slice(decimal + 1)}`;
  const value = Number(normalized);

  return clean !== "" && Number.isFinite(value) ? value : null;
}

/** "04/10/2026" (day first, as Spanish PayPal exports) or "2026-10-04". */
export function parsePaypalDate(text: string): string | null {
  const iso = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dayFirst = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);

  // ponytail: if your PayPal exported month/day/year (US English), dates would come out swapped
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dayFirst ? `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}` : null;
}

/** Received payments (positive, completed) with the payer's email. */
export function parsePaypalCsv(text: string): { rows: PaypalRow[]; error?: string } {
  const [header, ...lines] = parseCsv(text);

  if (!header) {
    return { rows: [], error: t("The file is empty") };
  }

  const find = (pattern: RegExp) => header.findIndex((title) => pattern.test(title.trim()));
  const [dateC, statusC, currencyC, grossC, feeC, netC, fromC, txC] = [
    /^(date|fecha)/i,
    /^(status|estado)/i,
    /^(currency|divisa|moneda)/i,
    /^(gross|bruto)/i,
    /^(fee|tarifa|comisi)/i,
    /^(net|neto)/i,
    /from email|remitente|correo.*(remit|de )/i,
    /transaction id|transacci/i,
  ].map(find);

  if ([dateC, currencyC, grossC, fromC, txC].some((index) => index < 0)) {
    return { rows: [], error: t("This doesn't look like a PayPal activity CSV (date, currency, gross, sender email, transaction id)") };
  }

  const rows: PaypalRow[] = [];

  for (const line of lines) {
    // A short line (cells missing at the end) reads as empty cells
    const cell = (index: number) => (line[index] ?? "").trim();
    const gross = parseAmount(cell(grossC));
    const fee = feeC >= 0 ? (parseAmount(cell(feeC)) ?? 0) : 0;
    const net = netC >= 0 ? parseAmount(cell(netC)) : null;
    const date = parsePaypalDate(cell(dateC));
    const email = cell(fromC).toLowerCase();
    const txId = cell(txC);
    const status = statusC >= 0 ? cell(statusC) : "completed";

    if (gross === null || gross <= 0 || !date || !email || !txId || !/complet|hecho|liberad/i.test(status)) {
      continue;
    }

    rows.push({ txId, date, currency: cell(currencyC).toUpperCase(), gross, net: round2(net ?? gross + fee), email });
  }

  return { rows };
}

export type PaypalMatch = {
  row: PaypalRow;
  /** ready: can import · duplicate: already imported · unknown: no client with that email · nodebt: no commission with a balance */
  status: "ready" | "duplicate" | "unknown" | "nodebt";
  clientId: number | null;
  commissionId: number | null;
};

type MatchClient = { id: number; email: string | null };
type MatchCommission = { id: number; client_id: number | null; price: number | null; currency: string | null };
type MatchPayment = { commission_id: number; amount: number; received: number | null; external_id: string | null };

/**
 * Matches each payment to a client (by email) and to their commission with a balance in the same currency:
 * first the one owing exactly that amount, else the oldest. Already imported ones are skipped.
 */
export function matchPaypalRows(
  rows: PaypalRow[],
  clients: MatchClient[],
  commissions: MatchCommission[],
  payments: MatchPayment[],
): PaypalMatch[] {
  const imported = new Set(payments.map((payment) => payment.external_id).filter(Boolean));
  // what each commission still owes; drops as payments from this same file are assigned
  const remaining: Record<number, number> = Object.fromEntries(
    commissions.map((commission) => [
      commission.id,
      paymentSummary(commission.price, payments.filter((payment) => payment.commission_id === commission.id)).remaining,
    ]),
  );

  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row): PaypalMatch => {
      const none = { row, clientId: null, commissionId: null };

      if (imported.has(row.txId)) {
        return { ...none, status: "duplicate" };
      }

      const client = clients.find((item) => item.email?.trim().toLowerCase() === row.email);

      if (!client) {
        return { ...none, status: "unknown" };
      }

      const open = commissions
        .filter(
          (commission) =>
            commission.client_id === client.id &&
            remaining[commission.id] > 0 &&
            (!commission.currency || !row.currency || commission.currency.toUpperCase() === row.currency),
        )
        .sort((a, b) => a.id - b.id);
      const chosen = open.find((commission) => remaining[commission.id] === row.gross) ?? open[0];

      if (!chosen) {
        return { ...none, status: "nodebt", clientId: client.id };
      }

      remaining[chosen.id] = round2(Math.max(remaining[chosen.id] - row.gross, 0));

      return { row, status: "ready", clientId: client.id, commissionId: chosen.id };
    });
}
