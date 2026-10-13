import { useEffect, useState } from "react";
import { locale, t } from "../lib/i18n";
import {
  addPayment,
  deletePayment,
  updatePaymentReceived,
  getPaymentPlatforms,
  type Commission,
  type PaymentPlatform,
  type CommissionPayment,
} from "../lib/database";
import { formatMoney, parsePrice, paymentSummary, receivedAfterFees, PAYMENT_STATUS_STYLE } from "../lib/commissionHelpers";
import { undoToast } from "../lib/undo";
import { useToast } from "../context/ToastContext";
import Money from "./Money";

const today = () => new Date().toISOString().slice(0, 10);

function parsePriceOrNull(text: string): number | null {
  try {
    return parsePrice(text);
  } catch {
    return null;
  }
}
const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

/** Payments block of the detail view: price, paid, received and platform fee. */
function CommissionPayments({
  commission,
  payments,
  onChange,
}: {
  commission: Commission;
  payments: CommissionPayment[];
  onChange: () => Promise<void>;
}) {
  const summary = paymentSummary(commission.price, payments);
  const currency = commission.currency;
  const { showToast } = useToast();

  // Client paid defaults to the remaining balance
  const [amount, setAmount] = useState("");
  const [received, setReceived] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [note, setNote] = useState("");
  const [platforms, setPlatforms] = useState<PaymentPlatform[]>([]);
  const [platformId, setPlatformId] = useState<number | null>(null);

  useEffect(() => {
    getPaymentPlatforms().then(setPlatforms).catch(console.error);
  }, []);

  const platform = platforms.find((item) => item.id === platformId) ?? null;
  // What the client paid (or the remainder) minus the chosen platform's fee
  const clientPaidDraft = amount === "" ? summary.remaining : parsePriceOrNull(amount);
  const suggestedReceived =
    platform && clientPaidDraft ? receivedAfterFees(clientPaidDraft, platform) : null;
  const [open, setOpen] = useState(false);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      await onChange();
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : t("Payment error: {error}", { error: String(error) }), "error");
    }
  }

  function handleAdd() {
    run(async () => {
      const clientPaid = parsePrice(amount === "" ? String(summary.remaining) : amount);

      if (!clientPaid) {
        throw new Error(t("Enter what the client paid"));
      }

      // Without a typed "received", use the fee-based estimate (if any)
      await addPayment(commission.id, clientPaid, parsePrice(received) ?? suggestedReceived, paidAt, note);
      setAmount("");
      setReceived("");
      setNote("");
      setPaidAt(today());
    });
  }

  const status = PAYMENT_STATUS_STYLE[summary.status];
  const field = "min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-ink";
  const paidShare = commission.price ? Math.min(100, (summary.paid / commission.price) * 100) : summary.paid > 0 ? 100 : 0;

  return (
    <div className="shrink-0">
      <div className="mb-2 flex items-center gap-2">
        <span className={status.className}>{status.label}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="ml-auto text-xs font-medium text-faint transition hover:text-ink"
        >
          {t("Payments")}
          {payments.length > 0 ? ` · ${payments.length}` : ""} {open ? "▴" : "▾"}
        </button>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2 text-[22px] font-semibold">
        <Money amount={summary.paid} currency={currency} />
        <span className="text-xs font-medium text-faint">
          {commission.price !== null ? t("of {amount}", { amount: formatMoney(commission.price, currency) }) : t("No price")}
        </span>
      </p>

      <div className="my-2.5 h-1.5 overflow-hidden rounded-sm bg-line" role="presentation">
        <div className="h-full bg-tone-ok" style={{ width: `${paidShare}%` }} />
      </div>

      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-faint">
        <span className={summary.remaining > 0 ? "font-semibold text-tone-warn" : ""}>
          {summary.remaining > 0 ? t("{amount} left", { amount: formatMoney(summary.remaining, currency) }) : ""}
        </span>
        <span>
          {t("Received")} <b className="text-ink">{formatMoney(summary.received, currency)}</b>
          {summary.pendingReceived > 0 && ` · ${t("{n} not entered", { n: summary.pendingReceived })}`}
          {summary.fees > 0 && ` · ${t("Fees {amount}", { amount: formatMoney(summary.fees, currency) })}`}
        </span>
      </div>

      {open && (
        <div className="mt-3 text-sm">
          <div className="divide-y divide-line border-y border-line">
            <div className="grid grid-cols-[minmax(0,1.1fr)_1fr_1fr_24px] gap-2 py-1.5 text-xs text-faint">
              <span>{t("Date")}</span>
              <span>{t("Client paid")}</span>
              <span>{t("You received")}</span>
              <span />
            </div>

            {payments.map((payment) => (
              <div key={payment.id} className="group grid grid-cols-[minmax(0,1.1fr)_1fr_1fr_24px] items-center gap-x-2 py-1.5">
                <span className="text-xs">{dateFormatter.format(new Date(`${payment.paid_at}T00:00:00`))}</span>
                <span className="font-semibold">{formatMoney(payment.amount, currency)}</span>

                {/* Received is entered when it arrives: Enter or blur */}
                <input
                  defaultValue={payment.received !== null ? String(payment.received).replace(".", ",") : ""}
                  placeholder={t("Not yet")}
                  inputMode="decimal"
                  data-private
                  onBlur={(event) => {
                    if (event.target.value !== (payment.received !== null ? String(payment.received).replace(".", ",") : "")) {
                      run(() => updatePaymentReceived(payment.id, parsePrice(event.target.value)));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className={`${field} border-transparent bg-transparent hover:border-line`}
                />

                <button
                  type="button"
                  title={t("Remove payment")}
                  onClick={() => run(async () => undoToast(showToast, "Payment removed.", await deletePayment(payment.id)))}
                  className="rounded-sm text-faint opacity-0 transition group-hover:opacity-100 hover:bg-tone-bad/10 hover:text-tone-bad focus-visible:opacity-100"
                >
                  ×
                </button>

                {payment.note && <span className="col-span-full truncate text-xs text-muted">{payment.note}</span>}
              </div>
            ))}
          </div>

          {/* New payment: Enter adds it */}
          <div
            className="mt-3 grid grid-cols-2 gap-2"
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAdd();
            }}
          >
            <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} aria-label={t("Date")} className={field} />
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={summary.remaining > 0 ? String(summary.remaining).replace(".", ",") : "0"}
              aria-label={t("Client paid")}
              inputMode="decimal"
              data-private
              className={field}
            />
            <input
              value={received}
              onChange={(event) => setReceived(event.target.value)}
              placeholder={suggestedReceived !== null ? String(suggestedReceived).replace(".", ",") : t("Later")}
              aria-label={t("You received")}
              title={platform ? `${platform.name}: ${platform.percent}% + ${platform.fixed}` : undefined}
              inputMode="decimal"
              data-private
              className={field}
            />
            {platforms.length > 0 ? (
              <select
                value={platformId ?? ""}
                onChange={(event) => {
                  const next = platforms.find((item) => item.id === Number(event.target.value)) ?? null;
                  // The note takes the platform name if empty or still the previous one
                  if (note === "" || note === platform?.name) setNote(next?.name ?? "");
                  setPlatformId(next?.id ?? null);
                }}
                className={field}
              >
                <option value="">{t("No fees")}</option>
                {platforms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <span />
            )}
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("Note: PayPal, deposit…")} aria-label={t("Note: PayPal, deposit…")} className={field} />
            <button type="button" onClick={handleAdd} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover">
              {t("Add payment")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommissionPayments;
