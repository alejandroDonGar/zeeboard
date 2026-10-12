import { useState } from "react";
import { t } from "../lib/i18n";
import { useDialog } from "../lib/useDialog";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { formatMoney } from "../lib/commissionHelpers";
import { getAllPayments, getClients, getCommissions, importPayments, type Client, type Commission } from "../lib/database";
import { matchPaypalRows, parsePaypalCsv, type PaypalMatch } from "../lib/paypalImport";
import { hide } from "../lib/privacy";

export type PaypalPreview = { matches: PaypalMatch[]; clients: Client[]; commissions: Commission[] };

/** Picks the PayPal activity CSV and matches it to your clients and commissions; null if cancelled. */
export async function pickPaypalFile(): Promise<PaypalPreview | null> {
  const file = await open({ title: t("Choose the PayPal activity CSV"), filters: [{ name: "CSV", extensions: ["csv"] }] });

  if (typeof file !== "string") {
    return null;
  }

  const { rows, error } = parsePaypalCsv(await invoke<string>("read_text_file", { path: file }));

  if (error) {
    throw new Error(error);
  }

  const [clients, commissions, payments] = await Promise.all([getClients(), getCommissions(), getAllPayments()]);

  return { matches: matchPaypalRows(rows, clients, commissions, payments), clients, commissions };
}

const STATUS_TEXT: Record<PaypalMatch["status"], string> = {
  ready: "",
  duplicate: t("Already imported"),
  unknown: t("No client with this email"),
  nodebt: t("This client has nothing left to pay"),
};

function PaypalImport({ preview, onClose }: { preview: PaypalPreview; onClose: () => void }) {
  const { matches, clients, commissions } = preview;
  // the commission chosen for each payment (editable before importing)
  const [choice, setChoice] = useState<Record<string, number>>(
    Object.fromEntries(matches.filter((item) => item.commissionId).map((item) => [item.row.txId, item.commissionId!])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = matches.filter((item) => item.status === "ready");
  const clientName = (id: number | null) => clients.find((client) => client.id === id)?.name ?? "";

  async function handleImport() {
    try {
      setSaving(true);
      await importPayments(
        ready.map(({ row }) => ({
          commissionId: choice[row.txId],
          amount: row.gross,
          received: row.net,
          paidAt: row.date,
          externalId: row.txId,
        })),
      );
      onClose();
      // screens load their payments on open; reload so they show the import
      window.location.reload();
    } catch (importError) {
      console.error(importError);
      setError(t("Could not import: {error}", { error: String(importError) }));
      setSaving(false);
    }
  }

  const dialogRef = useDialog(saving ? undefined : onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("PayPal")} className="flex max-h-[80vh] w-[720px] flex-col glass-heavy rounded-3xl p-6">
        <p className="text-xs font-bold text-muted">{t("PayPal")}</p>
        <h3 className="mt-2 text-2xl font-black text-ink">
          {t("{ready} of {total} payments ready", { ready: ready.length, total: matches.length })}
        </h3>

        <div className="mt-4 min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {matches.length === 0 && <p className="p-4 text-sm text-muted">{t("No incoming payments found in this file.")}</p>}

          {matches.map((item) => (
            <div key={item.row.txId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-20 shrink-0 text-muted">{item.row.date}</span>
              <span className="w-24 shrink-0 font-semibold">{formatMoney(item.row.gross, item.row.currency)}</span>
              <span className="min-w-0 flex-1 truncate" data-private>
                {item.clientId ? hide(clientName(item.clientId)) : hide(item.row.email)}
              </span>

              {item.status === "ready" ? (
                <select
                  value={choice[item.row.txId]}
                  onChange={(event) => setChoice({ ...choice, [item.row.txId]: Number(event.target.value) })}
                  className="w-52 shrink-0 rounded-md border border-line-strong bg-paper px-2 py-1"
                >
                  {commissions
                    .filter((commission) => commission.client_id === item.clientId)
                    .map((commission) => (
                      <option key={commission.id} value={commission.id}>
                        {hide(commission.title)}
                      </option>
                    ))}
                </select>
              ) : (
                <span className="w-52 shrink-0 text-faint">{STATUS_TEXT[item.status]}</span>
              )}
            </div>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-tone-bad">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-md border border-line-strong px-4 py-2 font-semibold">
            {t("Cancel")}
          </button>
          <button
            onClick={handleImport}
            disabled={saving || ready.length === 0}
            className="rounded-md bg-primary px-4 py-2 font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t("Importing…") : t("Import {n}", { n: ready.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PaypalImport;
