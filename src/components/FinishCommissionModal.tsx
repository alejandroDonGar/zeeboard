import { useState } from "react";
import { isoDay, parsePrice } from "../lib/commissionHelpers";
import { pickImagePaths } from "../lib/images";
import { t } from "../lib/i18n";
import { useEscape } from "../lib/useEscape";

export type FinishDetails = { deliveredAt: string; hours: number | null; notes: string; imagePaths: string[] };

const label = "mb-1.5 block text-xs font-bold text-muted";
const field = "rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-ink";

/** Final details of a piece. Hours and notes come prefilled when a finished commission is finished again. */
function FinishCommissionModal({
  title,
  hours: previousHours,
  notes: previousNotes,
  isSaving,
  onConfirm,
  onCancel,
}: {
  title: string;
  hours: number | null;
  notes: string | null;
  isSaving: boolean;
  onConfirm: (details: FinishDetails) => void;
  onCancel: () => void;
}) {
  const [deliveredAt, setDeliveredAt] = useState(isoDay(new Date()));
  const [hours, setHours] = useState(previousHours === null ? "" : String(previousHours));
  const [notes, setNotes] = useState(previousNotes ?? "");
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    try {
      onConfirm({ deliveredAt, hours: parsePrice(hours), notes: notes.trim(), imagePaths });
    } catch {
      setError(t("Enter the hours as a number, like 7,5"));
    }
  }

  useEscape(onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={t("Mark as finished")} className="w-[480px] glass-heavy rounded-3xl p-6">
        <p className="text-xs font-bold text-muted">{t("Mark as finished")}</p>
        <h3 className="mt-2 text-2xl font-black text-ink">{title}</h3>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <label>
            <span className={label}>{t("Delivery date")}</span>
            <input type="date" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className={`${field} w-full`} />
          </label>

          <label>
            <span className={label}>{t("Hours spent")}</span>
            <input
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              placeholder="7,5"
              inputMode="decimal"
              data-private
              className={`${field} w-full`}
            />
          </label>
        </div>

        <div className="mt-4">
          <span className={label}>{t("Final image")}</span>
          <button
            type="button"
            onClick={async () => setImagePaths([...imagePaths, ...(await pickImagePaths())])}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold transition hover:border-ink"
          >
            {imagePaths.length === 0 ? t("Add final image") : t("{n} selected · add more", { n: imagePaths.length })}
          </button>
        </div>

        <label className="mt-4 block">
          <span className={label}>{t("Final notes")}</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("Link to the post, how it went…")}
            rows={3}
            className={`${field} w-full resize-none`}
          />
        </label>

        {error && <p className="mt-3 text-sm text-tone-bad">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-2xl border border-line-strong px-4 py-2 font-semibold">
            {t("Cancel")}
          </button>
          <button
            onClick={confirm}
            disabled={isSaving || deliveredAt === ""}
            className="rounded-2xl bg-primary px-4 py-2 font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-70"
          >
            {t(isSaving ? "Saving..." : "Mark as finished")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FinishCommissionModal;
